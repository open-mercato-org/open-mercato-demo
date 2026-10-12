# Reservations Module (Travel CRM extension)

> **Status:** Draft · **Date:** 2026-10-12 · **Module:** `reservations` (`apps/mercato/src/modules/reservations`, `@app`)
> **Parent:** [`2026-10-12-travel-ticket-triage-demo.md`](2026-10-12-travel-ticket-triage-demo.md) · **Reference module:** `customers` (CRUD), `warranty_claims` (FK-id + snapshot coupling)

## TLDR

**Key Points:**
- Adds the travel-booking part of the "CRM": **reservations** linked to a `customers` person, **payments** against a reservation, a computed **balance** (due / paid / overpayment), and **refund requests** ("Request refund").
- Customer profiles and contact history are **not** duplicated. They stay in core `customers` (`customer_people`, `customer_interactions`).

**Scope:**
- Entities `Reservation`, `ReservationPayment`, `ReservationRefund`; balance service; CRUD API + backend pages; a "Reservations" tab on the person detail page.
- Workflow-safe command `reservations.refund.request` (the approval effector).
- AI **read** tools for agents: lookup by booking number, by customer, details with balance and days-to-departure.
- Demo seeds (personas from the umbrella spec).

**Out of scope:** real payment execution (gateway refunds), pricing, inventory, supplier integrations.

## Overview

The triage agent must verify that a booking number belongs to the sender. It reads departure dates (which drive priority), checks payment status (Example 2) and computes an overpayment (Example 1). This module owns exactly those facts and the act of *requesting* a refund. Executing the money transfer is finance's job, outside this demo.

> **Market reference:** travel CRMs (e.g. Odoo Travel / Bookingkit) model a booking with a lead traveller, an itinerary, a payment schedule and refunds as separate ledger lines. We adopt the separate payment and refund ledger with a computed balance. We reject itineraries, segments and suppliers as demo noise.

## Problem Statement

Core `customers` has no booking concept. `sales_orders` carries commerce baggage (channels, catalog lines, documents) and lacks departure, hotel and traveller fields. Without a reservation and balance model, the agent can neither verify identity nor justify a refund.

## Proposed Solution

- A small, AI-agnostic module, usable by a consultant manually: list and detail of reservations, record a payment, request a refund.
- **Balance is derived, never stored**: `paidTotal = Σ payments(status=booked)`, `refundedTotal = Σ refunds(status ∈ requested|approved|executed)`, `overpayment = max(0, paidTotal − refundedTotal − totalPrice)`. A stored balance would drift; the set is small, so compute per request.
- `reservations.refund.request` validates `amount ≤ overpayment` and the IBAN checksum **inside the command**. An approved-but-wrong agent proposal therefore still cannot over-refund.

### Design decisions

| Decision | Rationale |
|---|---|
| FK `customer_person_id` + encrypted `customer_email_snapshot` | The identity check `booking ∧ sender email` must work even if the person's primary email changes later. The snapshot is the email at booking time; the tool checks both. |
| `booking_number` unique per organization, uppercase normalized | Agents extract it from free text (`abc123`, `ABC-123`); normalize by stripping non-alphanumerics and uppercasing. |
| Refund status machine `requested → approved → executed` / `rejected`, `cancelled` | "Request refund" creates `requested`; finance moves it on. Undo of `request` = `cancelled`. |

## User Stories

- **Consultant** looks up reservation ABC123 and sees departure, hotel, payments and overpayment, so they can answer without asking finance.
- **Consultant / approved agent proposal** requests a 350 EUR refund to the given account, so finance can execute it.
- **Triage agent** verifies that ABC123 belongs to `anna.carter@example.com` and reads the days to departure.

## Architecture

```
reservations/
  index.ts  acl.ts  setup.ts  di.ts  events.ts  encryption.ts  search.ts  ai-tools.ts  workflows.ts  cli.ts
  data/{entities,validators,constants}.ts
  commands/{reservations,payments,refunds}.ts
  lib/{balance.ts, bookingNumber.ts, iban.ts}
  api/{reservations,payments,refunds}/route.ts   (makeCrudRoute)
  api/reservations/[id]/balance/route.ts
  backend/reservations/{page.tsx,[id]/page.tsx,create/page.tsx}
  widgets/injection/person-reservations-tab/      → detail:customers.person:tabs
  i18n/en.json
```

### Commands & Events

| Command | Workflow-safe | Undo |
|---|---|---|
| `reservations.reservation.create` / `.update` / `.delete` | no | standard CRUD undo |
| `reservations.payment.record` | no | soft delete |
| `reservations.refund.request` | **yes** (`requiredFeatures: ['reservations.refund.request']`) | → `cancelled` |
| `reservations.refund.transition` (approve/execute/reject) | no | previous status |

Events (`createModuleEvents`): `reservations.reservation.created`, `reservations.reservation.updated`, `reservations.payment.recorded`, `reservations.refund.requested`, `reservations.refund.status_changed`.

## Data Models

### Reservation (`reservations`)
- `id` uuid, `organization_id`, `tenant_id`, `created_at`, `updated_at`, `deleted_at`
- `booking_number` varchar(32), normalized uppercase; unique `(organization_id, booking_number)` where not deleted
- `customer_person_id` uuid (FK id → customers person)
- `customer_email_snapshot` text **encrypted** + `customer_email_hash` (deterministic hash for lookup)
- `customer_name_snapshot` text **encrypted**
- `status` enum `pending_payment | confirmed | cancelled | completed`
- `destination` varchar, `hotel_name` varchar, `room_type` varchar nullable, `board_type` varchar nullable
- `departure_date` date, `return_date` date, `travelers_count` int
- `total_price_amount` numeric(14,2), `currency_code` char(3)
- `notes` text **encrypted** nullable
- Index `(organization_id, customer_person_id)`, `(organization_id, departure_date)`

### ReservationPayment (`reservation_payments`)
- `id`, scoping, timestamps
- `reservation_id` uuid (same-module FK)
- `amount` numeric(14,2), `currency_code`
- `status` enum `pending | booked | failed`
- `method` enum `transfer | card | cash | other`
- `paid_at` timestamptz nullable, `booked_at` timestamptz nullable
- `external_reference` varchar nullable (transfer title / bank ref)

### ReservationRefund (`reservation_refunds`)
- `id`, scoping, timestamps
- `reservation_id` uuid
- `amount` numeric(14,2), `currency_code`
- `bank_account_number` text **encrypted** (IBAN, validated); `bank_account_last4` varchar(4) plaintext for display
- `reason` text **encrypted**
- `status` enum `requested | approved | executed | rejected | cancelled`
- `requested_by_user_id` uuid nullable
- `source_type` varchar nullable (e.g. `agent_proposal`), `source_ref` varchar nullable (opaque, e.g. proposal id). Generic and AI-agnostic.
- `related_ticket_id` uuid nullable (FK id, soft)

### Balance (computed DTO)
`{ totalPrice, paidTotal, pendingPaymentsTotal, refundedTotal, outstanding, overpayment, currencyCode, daysToDeparture }`. `daysToDeparture` is computed in the tenant timezone.

## API Contracts

- `GET|POST|PUT|DELETE /api/reservations/reservations` (`makeCrudRoute`). Filters: `bookingNumber`, `customerPersonId`, `departureFrom/To`, `status`, `ids`. Responses include `updatedAt`.
- `GET /api/reservations/reservations/:id/balance` → Balance DTO.
- `GET|POST /api/reservations/payments` (filter `reservationId`).
- `GET|POST /api/reservations/refunds`; `POST /api/reservations/refunds/:id/transition` `{ to, reason? }`.
- Errors: `422 refund_exceeds_overpayment`, `422 invalid_iban`, `409` optimistic lock.

### AI read tools (`ai-tools.ts`, `isMutation: false`)

| Tool id | Input | Output |
|---|---|---|
| `reservations.find_by_booking_number` | `{ bookingNumber, senderEmail? }` | `{ found, reservation?, ownerMatch: 'match' \| 'mismatch' \| 'unknown' }`. The owner check compares `senderEmail` with the person's emails **and** the snapshot. Never returns other customers' PII on mismatch, only `found:true, ownerMatch:'mismatch'`. |
| `reservations.list_for_customer` | `{ customerPersonId? , email? }` | `{ customerPersonId?, reservations: [{ id, bookingNumber, destination, hotelName, departureDate, returnDate, status, daysToDeparture }] }` (max 20) |
| `reservations.get_details` | `{ reservationId }` | reservation + payments + refunds + Balance |

All tools: `requiredFeatures: ['reservations.view']`, tenant/org scoped, reads via `findWithDecryption`. Contact history uses the existing `customers` tools. Lookup **by email** goes through this module's own `customer_email_hash` (`hashField` in `encryption.ts`, queried with `lookupHashCandidates`). `customers.primary_email` is encrypted without a hash column, so an exact-email filter there would not work under encryption, and `customers` is left unchanged.

## ACL (`acl.ts`)
`reservations.view`, `reservations.manage`, `reservations.payment.record`, `reservations.refund.request`, `reservations.refund.manage`. `setup.ts` grants view, payment.record and refund.request to the employee role, and all of them to admin.

## UI/UX
- Reservations list (`DataTable`): booking number, customer, destination/hotel, departure (with a "in N days" badge using the `status-warning` token when ≤ 3), status, balance chip.
- Detail: header + sections Payments, Refunds (`StatusBadge`), a Balance summary; "Request refund" dialog (`CrudForm`, IBAN field, Cmd+Enter / Escape).
- Widget on the person detail page: a "Reservations" tab.

## Encryption (`encryption.ts`)
`reservations`: `customer_email_snapshot`, `customer_name_snapshot`, `notes`. `reservation_refunds`: `bank_account_number`, `reason`. Lookup by email uses `customer_email_hash`.

## Search (`search.ts`)
Entity `reservations:reservation`. Source: booking number, destination, hotel, customer name (excluded from the vector source), `aclFeatures: ['reservations.view']`.

## Seeds
`seedExamples`: the umbrella personas. Persons are created via `customers` commands (idempotent by email). Dates are relative to today. CLI `yarn mercato reservations demo:reanchor-dates` shifts `departure_date`/`return_date` so each seeded reservation keeps its configured offset. It is called by `triage_agents demo:reset`.

## Implementation Plan

### Phase 1 — Domain
1. Entities, validators, migration + snapshot, `encryption.ts`, `acl.ts`.
2. Commands (with undo) + events; balance service with unit tests (overpayment, partial payments, refunds).
3. CRUD routes + OpenAPI; backend list/detail; person tab widget; i18n (`en`).
4. `seedExamples` + re-anchor CLI.

### Phase 2 — Agent surface
1. `ai-tools.ts` (3 read tools) with tests for the owner-mismatch privacy rule.
2. `workflows.ts`: `registerWorkflowSafeCommands([{ commandId: 'reservations.refund.request', requiredFeatures: ['reservations.refund.request'] }])`.

### Testing
- Unit: booking-number normalization, IBAN checksum, balance math, refund > overpayment rejection.
- Integration: CRUD reservations/payments/refunds; refund request + undo; balance endpoint; person tab renders; tenant isolation (another org cannot resolve ABC123).

## Risks & Impact Review

| Risk | Severity | Mitigation | Residual |
|---|---|---|---|
| Owner-mismatch lookup leaks another customer's reservation to an agent / drafted email | High | The tool returns only `ownerMatch:'mismatch'` with no PII; integration test | Low |
| Concurrent refund requests exceed the overpayment | Medium | Balance recomputed inside the command transaction with a row lock on the reservation | Low |
| Timezone off-by-one in `daysToDeparture` changes priority | Medium | Compute in the org timezone; unit tests around midnight | Low |

## Final Compliance Report
Plural module id ✅ · FK ids only to `customers` ✅ · org/tenant scoping ✅ · encryption map ✅ · `updated_at` + optimistic lock ✅ · commands with undo ✅ · zod validators ✅ · no hardcoded strings / status colors ✅

## Implementation Notes (as built)

- **Extras:**
  - a `reservations.reservation.deleted` event (CRUD delete)
  - an edit page
  - a "Record payment" dialog
  - CLI `demo:seed` next to `demo:reanchor-dates`
- **Payments** default to `booked` when recorded.
- **Timezone:** `daysToDeparture` uses the server timezone, because the platform has no per-organization timezone setting. Unit tests cover the midnight edges.
- **Seed booking numbers:** ABC123, XYZ789, MLZ456, AUR901, SOL902, TWK310, JML501, JML502. People are created through `customers.people.create`, idempotent by email.
- **AI tools:**
  - On `ownerMatch` `mismatch` or `unknown` with a sender email given, the tool returns only `{ found, ownerMatch }`.
  - Without a sender email, it returns the reservation with `ownerMatch: 'unknown'`.
  - `get_details` exposes only the IBAN's last 4 digits.
- **Injection:** the person tab targets the people-v2 page spot `detail:customers.person:tabs`. The legacy page uses `customers.person.detail:tabs` and is not targeted.
- **Dialogs:** `CrudForm` handles Enter but not Cmd/Ctrl+Enter, so each dialog adds its own handler.
- **Migration:** includes `buildEncryptionMapBackfillSql` for existing tenants.
- **DI:** services are registered with `.proxy()`, because the container runs in CLASSIC injection mode.

## Changelog
- **2026-10-12** — Initial draft.
- **2026-10-12** — English content, EUR demo amounts.
- **2026-10-12** — Email lookup via the module's own hash; no `customers` change.
- **2026-10-12** — Implementation notes from the Phase 1a build.
