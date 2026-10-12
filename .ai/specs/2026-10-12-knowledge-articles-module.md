# Knowledge Articles Module (Knowledge Base)

> **Status:** Draft · **Date:** 2026-10-12 · **Module:** `knowledge_articles` (`apps/mercato/src/modules/knowledge_articles`, `@app`)
> **Parent:** [`2026-10-12-travel-ticket-triage-demo.md`](2026-10-12-travel-ticket-triage-demo.md)

## TLDR

**Key Points:**
- A Knowledge Base of **service processes** structured as **category → subcategory → topic** (topic = article). Each article carries a procedure, the checks to perform, the recommended actions, an automation level and a reply template.
- It is the single source of "how we handle X". The triage classifier uses the taxonomy to classify; the resolution advisor uses the article to recommend and draft.

**Scope:** 2 entities, a taxonomy tree UI, an article editor, `search.ts` (fulltext + vector), 3 AI read tools, citable procedure steps, English demo content.

**Out of scope:** a multi-step editorial approval before publishing, document import (PDF → article), per-article ACL.

## Overview

The OTRS case requires that "recommendations come from processes in the KB" and that the KB has the structure *category → subcategory → topic*. The scenario's priority and routing rules also depend on the topic: room wishes and complaints are `manual_only`, while a refund is `assisted`. Placing that policy **in the KB content** rather than in agent prompts lets a business user change behaviour without a deploy. It is also how Acme 1 swaps in its own processes.

> **Market reference:** Zendesk Guide / Freshdesk Solutions use category → folder → article. ServiceNow KB adds structured fields for "applies to" and resolution steps. We adopt the 3-level tree plus structured action and check fields. We reject community features (votes, comments) and multi-version approval.

## Problem Statement

There is no searchable KB. `documents` disables search (per-record sharing) and needs a collab sidecar. `content` is static legal pages. Agent skills are repo-authored, not tenant-editable content.

## Proposed Solution

### Design decisions

| Decision | Rationale |
|---|---|
| Two levels in `knowledge_categories` (`parent_id`, `level`) + articles as topics | A fixed 3-level shape matches the brief, and validation is simple (an article must hang on a subcategory). |
| Stable dotted `key` (`payments.refunds.overpayment_refund`) on categories and articles | Agents and the process reference topics by key across tenants and seeds. A UUID would differ per tenant. |
| Structured `recommended_actions[].actionKey` reference **command ids** as plain strings | The KB stays AI-agnostic and module-agnostic. It names actions; the orchestrator decides whether it may run them (`allowedActions`). |
| `automation_level` on the article: `assisted` \| `manual_only` | This is the business switch for "the scope of automation depends on the type of case". |
| A search fallback (ILIKE over title/summary/keywords) when no search driver is configured | Demo reliability: the agent must find the article even without Meilisearch or pgvector. |

## Architecture

```
knowledge_articles/
  index.ts acl.ts setup.ts events.ts search.ts ai-tools.ts
  data/{entities,validators}.ts
  commands/{categories,articles}.ts
  lib/{taxonomy.ts, articleSearch.ts}
  api/{categories,articles}/route.ts (makeCrudRoute)  api/taxonomy/route.ts
  backend/knowledge/{page.tsx (tree + list), articles/[id]/page.tsx, articles/create/page.tsx}
  i18n/en.json
```

Events: `knowledge_articles.article.created` / `.updated` / `.published`, `knowledge_articles.category.updated`.

## Data Models

### KnowledgeCategory (`knowledge_categories`)
- `id`, `organization_id`, `tenant_id`, timestamps, `deleted_at`
- `parent_id` uuid nullable (same module); `level` enum `category | subcategory` (subcategory requires a parent of level `category`)
- `key` varchar(120), unique `(organization_id, key)`; `name` varchar; `description` text nullable; `position` int; `is_active` bool

### KnowledgeArticle (`knowledge_articles`)
- `id`, scoping, timestamps, `deleted_at`
- `category_id` uuid (must be a `subcategory`)
- `key` varchar(160), unique per org; `title` varchar; `summary` text; `keywords` text[]
- `body` text (markdown: background / context for humans)
- `procedure_steps` jsonb `[{ id: 'S1', text, checkKey?, actionKey? }]`: the **citable** procedure. Step ids are stable within an article; the editor renumbers only on explicit reorder
- `applicability` text (when this topic applies; used by the classifier)
- `required_checks` jsonb `[{ key, label, description? }]` (e.g. `overpayment_confirmed`, `iban_present`, `owner_verified`)
- `recommended_actions` jsonb `[{ actionKey, label, requiresApproval: true, preconditions?: string[] }]`
- `automation_level` enum `assisted | manual_only`; `manual_reason` text nullable (shown when `manual_only`)
- `target_queue_key` varchar nullable (e.g. `complaints`, the routing hint for manual cases)
- `priority_floor` enum `low | normal | high | urgent` nullable (minimum priority for the topic)
- `reply_template` text nullable (markdown with `{{customer.firstName}}`, `{{reservation.bookingNumber}}`, `{{refund.amount}}` …)
- `status` enum `draft | published`; `version` int (incremented on publish)

### KnowledgeArticleVersion (`knowledge_article_versions`)
- `id`, scoping, `created_at`; `article_id`; `version` int; `snapshot` jsonb (the full published article: title, steps, checks, actions, automation level, template); `published_by_user_id`
- Unique `(article_id, version)`. Written by the `publish` command; **immutable**. Agents and citations resolve `key@version` against this table, so the decision card shows exactly the text the agent read, even after later edits.

KB content is internal process documentation, not PII, so no encryption map is needed.

## API Contracts
- CRUD `/api/knowledge_articles/categories`, `/api/knowledge_articles/articles` (`makeCrudRoute`, filters `categoryId`, `key`, `status`, `automationLevel`, `ids`, `q`; `updatedAt` in responses).
- `GET /api/knowledge_articles/taxonomy` → `[{ key, name, subcategories: [{ key, name, topics: [{ key, title, automationLevel }] }] }]` (published only unless `includeDrafts=1` and `knowledge_articles.manage`).

### AI read tools

| Tool id | Input | Output |
|---|---|---|
| `knowledge_articles.browse_taxonomy` | `{}` | the taxonomy tree with each topic's `applicability` (≤ 200 chars) |
| `knowledge_articles.search` | `{ query, categoryKey?, limit? ≤ 5 }` | `[{ key, title, path, summary, score }]`, using `search_query` over `knowledge_articles:knowledge_article`, with the ILIKE fallback |
| `knowledge_articles.get_article` | `{ key, version? }` | the published version snapshot incl. `procedure_steps`, `required_checks`, `recommended_actions`, `automation_level`, `reply_template`, `version` |

`requiredFeatures: ['knowledge_articles.view']`. The agent cites `key@version#S2` / `#check:<key>` in its output.

- `GET /api/knowledge_articles/articles/:key/versions/:version` → the version snapshot (used by the decision-card citations panel; anchors `#S2` highlight a step).
- `POST /api/knowledge_articles/articles/:id/publish` → new immutable version (`knowledge_articles.article.published`).

## Search (`search.ts`)
Entity `knowledge_articles:knowledge_article`, strategies `fulltext` + `vector`. `buildSource` = title + summary + applicability + keywords + body; `resolveUrl` → article page; `aclFeatures: ['knowledge_articles.view']`. Only `published` articles are indexed.

## ACL
`knowledge_articles.view` (employee), `knowledge_articles.manage` (admin / KB editor).

## UI/UX
- Knowledge page: left tree (category → subcategory), right `DataTable` of topics with an automation-level `StatusBadge` (`assisted` = info, `manual_only` = warning).
- Article editor (`CrudForm`): fields grouped as Content, Policy (automation level, queue, priority floor), Checks and Actions (repeatable rows), Reply template (with a placeholder legend).

## Seeds (`seedExamples`, English content)

| Category | Subcategory | Topic key | Automation | Notes |
|---|---|---|---|---|
| Payments | Refunds | `payments.refunds.overpayment_refund` | assisted | steps S1 verify the requester owns the booking → S2 confirm the overpayment from the payment ledger → S3 confirm a valid IBAN is provided → S4 request the refund for the overpaid amount only → S5 reply with the confirmation template; checks `owner_verified`, `overpayment_confirmed`, `iban_present`; actions `reservations.refund.request` + `tickets.reply.send`; reply template "We confirm that we have registered your request to refund the overpayment of {{refund.amount}}…" |
| Payments | Incoming payments | `payments.incoming.payment_confirmation` | assisted | check `payment_booked`; if booked → `tickets.ticket.transition(resolved)` + reply; if not → manual (`payment_not_visible`) |
| Booking | Special requests | `booking.special_requests.room_preference` | manual_only | "Requests are forwarded to the hotel without a guarantee — the consultant decides" |
| Booking | Changes | `booking.changes.date_change` | manual_only | |
| Complaints | Service | `complaints.service.hotel_service_complaint` | manual_only | `target_queue_key: complaints`, `priority_floor: normal` |
| General | Identification | `general.identification.unknown_booking` | manual_only | fallback topic for unidentified context |

The demo's **KB-edit moment** (umbrella, D7) edits `payments.refunds.overpayment_refund` live (adds a check and a template sentence, publishes v4). No seed for v4: it is created on stage.

## Implementation Plan
- **Phase 1:** entities (incl. `knowledge_article_versions`) + migration, commands/events (incl. `publish` → immutable version), CRUD + taxonomy API, backend UI, seeds, i18n.
- **Phase 2:** `search.ts`, `ai-tools.ts` with the ILIKE fallback, tests.

### Testing
- Unit: taxonomy validation (an article on a top-level category is rejected), template placeholder parsing, search fallback.
- Integration: CRUD categories/articles, taxonomy endpoint (published only), search returns the refund article for "refund overpayment".

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| A KB editor changes `automation_level` and silently changes AI behaviour | Medium | Immutable published versions; `key@version` cited in every proposal; `article.published` event in the audit log | Low |
| An `actionKey` points to a non-existent or non-allowed command | Low | The KB does not execute; AO intersects with `allowedActions` and fails closed | Low |
| Vector search unavailable in a demo environment | Medium | ILIKE fallback | Low |

## Final Compliance Report
Plural module id ✅ · scoping ✅ · stable keys ✅ · `makeCrudRoute` ✅ · `search.ts` with `aclFeatures` ✅ · `updated_at` ✅ · i18n ✅ · no PII → no encryption map needed (documented) ✅

## Implementation Notes (as built)

- **Version endpoint:** `GET /api/knowledge_articles/articles/:id/versions/:version`. The `:id` segment accepts the article **key** or id (one dynamic segment name per level, shared with `POST /articles/:id/publish`). `:version` also accepts `latest`.
- **Extra columns:** `knowledge_article_versions.article_key` (denormalized, so `key@version` resolves without a join) and `knowledge_articles.published_at`.
- **Status semantics:** once published, the article row stays `published` and acts as the working copy. Agents and citations always read the latest immutable snapshot, so edits reach agents only on the next publish (this is exactly the demo's live v4 moment).
- **Taxonomy response:** `{ items: [...] }`. Topics also carry `status` and `version`.
- **Seeds:** one snapshot per article at its stated version. The overpayment refund article is v3; the others are v1. Seeds write through the entity manager, so they reach the search index only after a reindex; the ILIKE fallback still finds them.
- **Search:** strategies `fulltext`, `vector` and `tokens`. "Published only" is enforced in the search tool, which re-checks `status = 'published'` per hit, because the indexer still indexes `fieldPolicy` fields when `buildSource` returns null.
- **Extra events:** `category.created`, `category.deleted` and `article.deleted`. `article.published` is persistent and has `clientBroadcast`.
- **Step ids:** reordering renumbers S1…Sn; add and remove keep the existing ids. The server validates that step, check and action keys are unique and that every reference resolves.
- **Defaults:** `text[]` and `jsonb` columns have no DB default (MikroORM cannot convert one); the app supplies the values.

## Changelog
- **2026-10-12** — Initial draft.
- **2026-10-12** — Citable `procedure_steps`, immutable `knowledge_article_versions`, publish endpoint; English seed content.
- **2026-10-12** — Implementation notes from the Phase 1b build.
