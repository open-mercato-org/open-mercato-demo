# Tickets Module (OTRS-like Helpdesk)

> **Status:** Draft · **Date:** 2026-10-12 · **Module:** `tickets` (`apps/mercato/src/modules/tickets`, `@app`)
> **Parent:** [`2026-10-12-travel-ticket-triage-demo.md`](2026-10-12-travel-ticket-triage-demo.md) · **Pattern reference:** `warranty_claims` (status machine, number sequence, email intake, FK-id + snapshot coupling)

## TLDR

**Key Points:**
- A helpdesk where **each inbound email (or thread) is a ticket**: a queue, status, priority and assignee, an **article thread** (inbound / outbound / internal note), **classification fields** (customer, reservation, KB category/subcategory/topic, summary, manual-review flag) and **reply drafts** with sending.
- It is **AI-agnostic**. Classification and drafts can be set by a consultant or by any workflow effector. The AI glue (`triage_agents`) plugs in through events, workflow-safe commands, read tools and injection spots that this module exposes.

**Scope:** entities, intake (email + simulate), status machine, queue UI, ticket detail UI with composer, events, 5 workflow-safe commands, 2 read tools, injection spots.

**Out of scope:** SLA engine, a customer portal, merge/split tickets, a live OTRS sync (a future integration provider, see umbrella Q2).

## Overview

The OTRS case describes the target: a consultant opening the queue sees *Customer / Reservation / Category / Priority / Summary / Recommended action / AI status / Draft* without opening the ticket. This module supplies the generic part: the queue, the classification, a draft that can be sent, and the manual-review flag with its reason. `triage_agents` contributes the AI-specific part (AI status, confidence, the recommendation card) by injection.

> **Market reference:** OTRS/Znuny (queue, state, priority, articles with sender type, dynamic fields), Zammad and FreeScout. We adopt queue + state + priority + articles + an internal note. We reject OTRS's ACL-per-queue model (we use feature ACL) and dynamic fields (we use typed columns + `ce.ts` custom fields).

## Problem Statement

`inbox_ops` extracts actions from email but has no queue/status/priority/assignee. `communication_channels` conversations have an assignee but no status, priority or classification. `messages` is internal mail. None of them can hold "classified ticket + draft awaiting approval".

## Proposed Solution

### Design decisions

| Decision | Rationale |
|---|---|
| Intake subscribes to `inbox_ops.email.received` (not `communication_channels.message.received`) | Same reasoning as `warranty_claims/subscribers/email-to-claim.ts`: only that event carries the sender address. The payload is only `{ emailId, tenantId, organizationId, forwardedByAddress, subject }`, so the subscriber loads the `InboxEmail` by `emailId` (`findOneWithDecryption`) for the body, `messageId`, `inReplyTo` and `references`. Scope is taken from the subscriber ctx, never from the payload. Idempotent on `message_id` (fallback `emailId`). |
| Thread matching: `In-Reply-To`/`References` → existing article `message_id`; else the `[TCK-000123]` subject token; else a new ticket | OTRS-compatible behaviour; a follow-up email appends `tickets.article.received` instead of creating a duplicate. |
| Classification is **one command** (`tickets.ticket.classify`) with an explicit `source` (`manual` \| `workflow`) | Atomic, undoable enrichment. The event `tickets.ticket.classified` carries the before/after. |
| `needs_manual_review` + `manual_review_reason` live on the ticket, not in the AI module | "Requires manual verification" is a helpdesk concept that a human can also set. AI is just one producer. |
| Drafts are separate rows (`ticket_reply_drafts`) | Several drafts, authorship (`source_type`/`source_ref`) and an edit history before sending. |
| Sending: `tickets.reply.send` → `sendEmail` from `@open-mercato/shared/lib/email/send` (delivers through the `communication_channels` system transport) | Demo safety (umbrella D4). There is no simulated transport in the platform, so `lib/delivery.ts` records `delivery_status: 'simulated'` when `OM_TICKETS_DELIVERY=simulated`, when delivery is disabled (`isEmailDeliveryDisabled`) or when no transport is configured. `sendEmail` cannot set `In-Reply-To`; the `[TCK-…]` subject token keeps threading. The outbound article is recorded either way. |
| Priority is a fixed enum `low \| normal \| high \| urgent`; queue is a dictionary | Priority drives sorting and colours (enum = stable). Queues are tenant-configurable (`dictionaries`). |

## Architecture

```
tickets/
  index.ts acl.ts setup.ts di.ts events.ts encryption.ts search.ts ai-tools.ts workflows.ts ce.ts cli.ts
  data/{entities,validators,constants}.ts
  commands/{tickets,articles,drafts,replies}.ts
  lib/{stateMachine.ts, threadMatcher.ts, emailIntake.ts, numberGenerator.ts, delivery.ts, dictionaries.ts}
  subscribers/inbox-email-to-ticket.ts           (inbox_ops.email.received)
  api/tickets/route.ts (makeCrudRoute — status/classification NOT writable here)
  api/tickets/[id]/{classify,transition,flag-manual-review,articles,drafts,reply}/route.ts
  api/intake/simulate/route.ts
  backend/tickets/{page.tsx (queue), [id]/page.tsx (detail)}
  widgets/injection/person-tickets-tab/          → detail:customers.person:tabs
  widgets/injection/reservation-tickets-tab/     → detail:reservations.reservation:tabs (soft-optional)
  i18n/en.json
```

### Status machine (`lib/stateMachine.ts`, frozen enum)
`new → open → pending_customer | pending_internal → open → resolved → closed`, plus `new|open → resolved` and `resolved → open` (customer replies). Status changes go **only** through `tickets.ticket.transition`.

### Commands

| Command | Workflow-safe | Notes / undo |
|---|---|---|
| `tickets.ticket.create` | no | from intake or manual; emits `ticket.created` |
| `tickets.ticket.update` | no | subject, queue, assignee |
| `tickets.ticket.classify` | **yes** | `{ customerPersonId?, reservationId?, categoryKey?, subcategoryKey?, topicKey?, priority?, priorityReason?, summary?, source }`; undo restores the previous snapshot |
| `tickets.ticket.flag_manual_review` | **yes** | `{ reason, reasonCode, targetQueueKey? }`; undo clears it |
| `tickets.ticket.transition` | **yes** | `{ to, note? }`; validated by the state machine |
| `tickets.reply_draft.save` | **yes** | create/update a draft `{ body, subject?, sourceType?, sourceRef? }` |
| `tickets.reply.send` | **yes** | `{ draftId? , body?, subject? }` → outbound article + delivery; the ticket moves to `pending_customer` unless `resolveAfterSend`. **Not undoable** (external side effect); documented. |
| `tickets.article.add_note` | no | internal note |

Workflow-safe registration in `workflows.ts` with the matching `requiredFeatures`.

### Events
`tickets.ticket.created`, `tickets.ticket.updated`, `tickets.ticket.classified`, `tickets.ticket.status_changed`, `tickets.ticket.manual_review_flagged`, `tickets.article.received` (inbound on an existing ticket), `tickets.reply.sent`, `tickets.reply_draft.saved`. The `created`/`article.received`/`reply.sent` events have `clientBroadcast: true` so the queue refreshes live.

## Data Models

### Ticket (`tickets`)
- `id`, `organization_id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`
- `number` varchar(20) `TCK-000123` (sequence table `ticket_sequences` per org, as in `warranty_claims`)
- `subject` varchar(500) **encrypted**; `channel` enum `email | manual | api`
- `queue_key` varchar (dictionary `tickets.queue`: `general`, `payments`, `complaints`, `bookings`)
- `status` enum (above); `priority` enum `low | normal | high | urgent` (default `normal`); `priority_reason` varchar(200) nullable
- `requester_email` text **encrypted** + `requester_email_hash`; `requester_name` text **encrypted** nullable
- `customer_person_id` uuid nullable (FK id); `reservation_id` uuid nullable (FK id); `reservation_number_snapshot` varchar nullable
- `category_key`, `subcategory_key`, `topic_key` varchar nullable (KB stable keys); `category_path_snapshot` varchar nullable ("Payments / Refunds / Overpayment refund")
- `summary` text **encrypted** nullable
- `needs_manual_review` bool default false; `manual_review_reason_code` varchar nullable; `manual_review_reason` text nullable
- `classified_at` timestamptz nullable, `classification_source` enum `manual | workflow` nullable
- `assignee_user_id` uuid nullable; `last_inbound_at`, `last_outbound_at` timestamptz
- Indexes: `(organization_id, status, priority)`, `(organization_id, queue_key)`, `(organization_id, customer_person_id)`, `(organization_id, needs_manual_review)`

### TicketArticle (`ticket_articles`)
- `id`, scoping, timestamps
- `ticket_id` uuid; `direction` enum `inbound | outbound | internal_note`
- `from_email`, `to_email` text **encrypted**; `subject` **encrypted**; `body_text` text **encrypted**; `body_html` text **encrypted** nullable
- `message_id`, `in_reply_to` varchar nullable (unique `(organization_id, message_id)` where not null)
- `author_user_id` uuid nullable; `source_inbox_email_id` uuid nullable (FK id → inbox_ops)
- `delivery_status` enum `received | queued | sent | simulated | failed` ; `sent_at` timestamptz nullable

### TicketReplyDraft (`ticket_reply_drafts`)
- `id`, scoping, timestamps (`updated_at` → optimistic lock)
- `ticket_id`; `subject` **encrypted**; `body` text **encrypted**
- `status` enum `draft | sent | discarded`
- `source_type` varchar nullable (`manual`, `workflow`), `source_ref` varchar nullable (opaque; e.g. proposal id)
- `created_by_user_id` nullable; `sent_article_id` uuid nullable

## API Contracts
- `GET/POST/PUT/DELETE /api/tickets/tickets` (`makeCrudRoute`). Filters: `status`, `priority`, `queueKey`, `needsManualReview`, `customerPersonId`, `reservationId`, `topicKey`, `q`, `ids`. Sort default `priority desc, last_inbound_at asc`. `updatedAt` in responses. Response enrichers from other modules are allowed (the `triage_agents` `_triage` block).
- `POST /api/tickets/tickets/:id/classify` · `/transition` · `/flag-manual-review` (zod, optimistic lock header).
- `GET/POST /api/tickets/tickets/:id/articles` (POST = internal note).
- `GET/POST/PUT /api/tickets/tickets/:id/drafts`; `POST /api/tickets/tickets/:id/reply` `{ draftId? | body, subject? }`.
- `POST /api/tickets/intake/simulate` `{ fromEmail, fromName?, subject, body, inReplyTo?, receivedAt? }` → `{ ticketId, number, created: boolean }`. Feature `tickets.intake.simulate` (admin only; demo).

### AI read tools (`ai-tools.ts`)

| Tool id | Input | Output |
|---|---|---|
| `tickets.get_ticket` | `{ ticketId, articleLimit? ≤ 20 }` | ticket fields + articles (newest last; bodies trimmed to 4 000 chars, quoted history stripped) |
| `tickets.list_tickets` | `{ customerPersonId? , requesterEmail?, statuses?, limit ≤ 10 }` | the requester's recent tickets (for "contact history") |

## Injection spots (contract, ADDITIVE-ONLY)
`detail:tickets.ticket:header`, `detail:tickets.ticket:sidebar`, `detail:tickets.ticket:tabs`, `detail:tickets.ticket:composer` (above the reply editor; receives `{ ticket, drafts, reloadDrafts }`), `data-table:tickets.ticket:columns` / `:row-actions` / `:filters`.

## ACL
`tickets.view`, `tickets.manage`, `tickets.classify`, `tickets.reply`, `tickets.intake.simulate`. Employees get view/manage/classify/reply.

## UI/UX
- **Queue** (`DataTable`, live refresh via `useAppEvent('tickets.ticket.created')`): number, subject, requester/customer, reservation, category path, priority `StatusBadge` (urgent = error, high = warning, normal = neutral, low = muted), status, "manual review" indicator with reason tooltip, last inbound. Saved filters: "Mine", "Needs manual review", "Urgent".
- **Detail**: header (number, subject, status/priority badges, actions: transition, assign); main = article thread + composer (draft selector, `Cmd/Ctrl+Enter` send, Escape cancel); sidebar = Classification panel (editable by `tickets.classify` via a dialog using the KB taxonomy select, soft-optional), Customer & Reservation links (labels resolved via `tryResolve`; raw ids when the modules are absent).
- "Simulate inbound email" button on the queue (feature-gated) opens a dialog with scenario presets. Presets come from an injection (`data-table:tickets.ticket:toolbar`) owned by `triage_agents`, so `tickets` stays content-free.

## Encryption (`encryption.ts`)
`tickets`: `subject`, `requester_email`, `requester_name`, `summary`. `ticket_articles`: `from_email`, `to_email`, `subject`, `body_text`, `body_html`. `ticket_reply_drafts`: `subject`, `body`. Lookup uses `requester_email_hash`. `search.ts` indexes only `number`, `category_path_snapshot` and `reservation_number_snapshot` (no encrypted free text).

## Implementation Plan
- **Phase 1:** entities, migration, number sequence, state machine, commands/events, CRUD + action routes, queue + detail UI, i18n, dictionaries seed (queues).
- **Phase 1b:** intake subscriber + thread matcher + simulate endpoint; delivery via `communication_channels` or simulated.
- **Phase 2:** `ai-tools.ts`, `workflows.ts` registration, injection spots, person/reservation tabs.

### Testing
- Unit: state machine, thread matcher (`In-Reply-To`, subject token, new), number generator, delivery fallback.
- Integration: simulate → ticket created (+ event); follow-up email appends an article; classify + undo; flag manual review; draft save → reply send → outbound article `simulated`; optimistic-lock 409 on concurrent classify; tenant isolation.

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Duplicate tickets from re-delivered emails | Medium | Unique `message_id` + idempotent intake command | Low |
| A reply sent twice (double click / retry) | High | Draft `status` transition `draft → sent` in the same transaction; idempotency key = draftId | Low |
| A workflow classify overwrites a consultant's manual classification | Medium | The command rejects `source: workflow` when `classification_source = manual` unless `force`; optimistic lock | Low |
| Real email to a real customer from the demo | High | `simulated` delivery default when no channel is configured; `example.com` seeds | Low |

## Final Compliance Report
Plural id ✅ · FK ids only (customers, reservations, KB keys, inbox_ops) ✅ · scoping ✅ · encryption map ✅ · status via command only ✅ · undo (except the external send, documented) ✅ · `makeCrudRoute`/`CrudForm`/`DataTable` ✅ · injection spots additive ✅ · DS status tokens ✅

## Implementation Notes (as built)

- **Sorting:** a `priority_rank` column backs the "priority desc" default sort, because a text enum cannot sort by severity. The list sorts by rank, then `last_inbound_at` ascending.
- **Additive commands, events and routes:**
  - `tickets.ticket.delete` + `tickets.ticket.deleted` (CRUD DELETE)
  - `tickets.article.receive` (email follow-ups; not undoable)
  - `GET /api/tickets/queues`
  - the simulate response also returns `articleId`, `messageId` and `match`
- **Additive inputs:** `flag_manual_review` accepts `clear: true`. `classify` also accepts `reservationNumberSnapshot`, `categoryPathSnapshot` and `force`.
- **Status after `reply.send`:** it reaches `pending_customer` or `resolved` through the shortest valid path, e.g. `new → open → pending_customer`.
- **Threading:** an inbound email that matches a **closed** ticket opens a new ticket. Outbound articles get a synthetic `message_id`, so replies to simulated sends thread via `In-Reply-To`.
- **Email intake** is on by default; `OM_TICKETS_EMAIL_INTAKE=false` disables it.
- **Simulate:** the "Simulate inbound email" button is the module's own widget on `data-table:tickets.ticket:toolbar` (no presets; `triage_agents` adds presets).
- **Saved filters** (Mine, Needs manual review, Urgent) are preset buttons next to the DataTable views.
- **CRUD list cache:** with `ENABLE_CRUD_API_CACHE`, system-context commands whose `buildLog` returns no resource kind left lists stale, so every ticket write invalidates the list cache explicitly.
- **Reservation tab:** `widgets/injection/reservation-tickets-tab` targets `detail:reservations.reservation:tabs` (a spot that `reservations` now hosts) and lists tickets by `reservationId` through `GET /api/tickets/tickets`. It shares `components/LinkedTicketsList.tsx` with the person tab.
- **KB taxonomy select:** the classify dialog loads `GET /api/knowledge_articles/taxonomy` and renders cascading category → subcategory → topic selects. `categoryPathSnapshot` is built from the selected labels (`Category / Subcategory / Topic`). A key that is not in the taxonomy stays selectable and keeps the old snapshot. When the endpoint fails (module disabled, 403, 404) or returns no categories, the dialog falls back to the free-text key inputs.
- **Reservation and customer labels:** the `reservations` module owns a response enricher (`reservations.ticket-reservation`, feature `reservations.view`) that adds `_reservations.reservation = { id, bookingNumber, destination, hotelName, status, departureDate, customerPersonId, customerName }` to tickets responses. This replaces the planned `tryResolve`. The queue and the classification panel show the booking number and destination, and the panel links to the reservation. Without the enrichment (module disabled or no ACL), the UI shows the snapshot or the id with no link. The customer name still comes from `GET /api/customers/people` (`usePeopleLabels`). The reservation's `customerName` is used only when the people lookup has no label.
- **Existing tenants** need `yarn mercato auth sync-role-acls` for the new features.

## Changelog
- **2026-10-12** — Initial draft.
- **2026-10-12** — English labels and i18n.
- **2026-10-12** — Intake loads `InboxEmail` by `emailId`; delivery via `sendEmail` + the module's own `simulated` mode.
- **2026-10-12** — Implementation notes from the Phase 1c build.
- **2026-10-12** — Reservation tickets tab, KB taxonomy selects in the classify dialog, reservation labels via the `reservations` enricher.
