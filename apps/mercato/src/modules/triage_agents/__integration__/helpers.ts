import { randomInt, randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'
export const DEMO_IBAN = 'DE89 3704 0044 0532 0130 00'

export type TriageView = {
  ticketId: string
  stage: string
  aiMode: string | null
  reasonCode: string | null
  reason: string | null
  route: string | null
  priority: string | null
  priorityReason: string | null
  recommendedActionLabel: string | null
  draftState: string
  proposalId: string | null
  disposition: string | null
  executionId: string | null
  groundingState: string
  groundingIssues: string[]
  identification: { reservation?: { match?: string; bookingNumber?: string | null; candidates?: unknown[] } } | null
  classification: { topicKey?: string | null; source?: string | null } | null
  attempt: number
  attempts?: Array<{ attempt: number; executionId: string | null; disposition: string | null; reasonCode: string | null }>
}

export type SetupResponse = {
  processDefinitionId: string | null
  autoStart: boolean
  scriptedProviderActive: boolean
}

export type Fixtures = {
  personIds: string[]
  reservationIds: string[]
  ticketIds: string[]
  articleIds: string[]
  categoryIds: string[]
}

export function emptyFixtures(): Fixtures {
  return { personIds: [], reservationIds: [], ticketIds: [], articleIds: [], categoryIds: [] }
}

export function uniqueStamp(): string {
  return randomUUID().replaceAll('-', '').slice(0, 8)
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ'

export function uniqueBookingNumber(): string {
  const letters = Array.from({ length: 3 }, (_, index) => (index === 0 ? 'Q' : LETTERS[randomInt(LETTERS.length)])).join('')
  return `${letters}${String(randomInt(1000)).padStart(3, '0')}`
}

export function isoDateFromToday(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export async function setupTriage(request: APIRequestContext, token: string): Promise<SetupResponse | null> {
  const response = await apiRequest(request, 'POST', '/api/triage_agents/setup', { token, data: {} })
  if (response.status() === 404) return null
  const body = await readJsonSafe<SetupResponse>(response)
  expect(response.status(), `triage setup failed: ${JSON.stringify(body)}`).toBe(200)
  return body
}

type KbTopicSeed = {
  categoryKey: string
  categoryName: string
  subcategoryKey: string
  subcategoryName: string
  key: string
  title: string
  automationLevel: 'assisted' | 'manual_only'
  manualReason?: string
  targetQueueKey?: string
  priorityFloor?: 'normal'
  procedureSteps: Array<{ id: string; text: string; checkKey?: string; actionKey?: string }>
  requiredChecks: Array<{ key: string; label: string }>
  recommendedActions: Array<{ actionKey: string; label: string; requiresApproval: boolean }>
  replyTemplate?: string
}

const KB_TOPICS: KbTopicSeed[] = [
  {
    categoryKey: 'payments', categoryName: 'Payments', subcategoryKey: 'payments.refunds', subcategoryName: 'Refunds',
    key: 'payments.refunds.overpayment_refund', title: 'Overpayment refund', automationLevel: 'assisted',
    procedureSteps: [
      { id: 'S1', text: 'Verify that the requester owns the booking.', checkKey: 'owner_verified' },
      { id: 'S2', text: 'Confirm the overpayment from the payment ledger.', checkKey: 'overpayment_confirmed' },
      { id: 'S3', text: 'Confirm that a valid IBAN is provided.', checkKey: 'iban_present' },
      { id: 'S4', text: 'Request the refund for the overpaid amount only.', actionKey: 'reservations.refund.request' },
      { id: 'S5', text: 'Reply to the customer with the confirmation template.', actionKey: 'tickets.reply.send' },
    ],
    requiredChecks: [
      { key: 'owner_verified', label: 'Requester owns the booking' },
      { key: 'overpayment_confirmed', label: 'Overpayment confirmed' },
      { key: 'iban_present', label: 'Valid IBAN provided' },
    ],
    recommendedActions: [
      { actionKey: 'reservations.refund.request', label: 'Request refund of the overpaid amount', requiresApproval: true },
      { actionKey: 'tickets.reply.send', label: 'Send the confirmation reply', requiresApproval: true },
    ],
    replyTemplate: 'Dear {{customer.firstName}}, we registered your refund request of {{refund.amount}}.',
  },
  {
    categoryKey: 'payments', categoryName: 'Payments', subcategoryKey: 'payments.incoming', subcategoryName: 'Incoming payments',
    key: 'payments.incoming.payment_confirmation', title: 'Payment confirmation', automationLevel: 'assisted',
    procedureSteps: [
      { id: 'S1', text: 'Check whether the payment is booked.', checkKey: 'payment_booked' },
      { id: 'S2', text: 'Resolve the ticket.', actionKey: 'tickets.ticket.transition' },
      { id: 'S3', text: 'Reply with the confirmation template.', actionKey: 'tickets.reply.send' },
      { id: 'S4', text: 'If the payment is not visible, route to manual review.' },
    ],
    requiredChecks: [{ key: 'payment_booked', label: 'Payment booked on the reservation' }],
    recommendedActions: [
      { actionKey: 'tickets.ticket.transition', label: 'Resolve the ticket', requiresApproval: true },
      { actionKey: 'tickets.reply.send', label: 'Send the payment confirmation', requiresApproval: true },
    ],
    replyTemplate: 'Dear {{customer.firstName}}, we confirm that we have received your payment.',
  },
  {
    categoryKey: 'booking', categoryName: 'Booking', subcategoryKey: 'booking.special_requests', subcategoryName: 'Special requests',
    key: 'booking.special_requests.room_preference', title: 'Room preference', automationLevel: 'manual_only',
    manualReason: 'Requests are forwarded to the hotel without a guarantee — the consultant decides.',
    procedureSteps: [{ id: 'S1', text: 'Forward the request to the hotel.' }], requiredChecks: [], recommendedActions: [],
  },
  {
    categoryKey: 'booking', categoryName: 'Booking', subcategoryKey: 'booking.changes', subcategoryName: 'Changes',
    key: 'booking.changes.date_change', title: 'Date change', automationLevel: 'manual_only',
    manualReason: 'Date changes require checking supplier availability and fare conditions.',
    procedureSteps: [{ id: 'S1', text: 'Check the fare conditions.' }], requiredChecks: [], recommendedActions: [],
  },
  {
    categoryKey: 'complaints', categoryName: 'Complaints', subcategoryKey: 'complaints.service', subcategoryName: 'Service',
    key: 'complaints.service.hotel_service_complaint', title: 'Hotel service complaint', automationLevel: 'manual_only',
    manualReason: 'Complaints are handled by the complaints team.', targetQueueKey: 'complaints', priorityFloor: 'normal',
    procedureSteps: [{ id: 'S1', text: 'Route the complaint to the complaints queue.' }], requiredChecks: [], recommendedActions: [],
  },
]

type TaxonomyResponse = {
  items?: Array<{ id: string; key: string; subcategories?: Array<{ id: string; key: string; topics?: Array<{ key: string }> }> }>
}

async function createCategory(request: APIRequestContext, token: string, data: Record<string, unknown>, fixtures: Fixtures): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/knowledge_articles/categories', { token, data })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), `create KB category failed: ${JSON.stringify(body)}`).toBe(201)
  fixtures.categoryIds.push(body?.id as string)
  return body?.id as string
}

/**
 * The triage fixtures address the canonical topic keys, so the test makes sure each
 * one is published — creating (and later deleting) only what the tenant lacks.
 */
export async function ensureKnowledgeBase(request: APIRequestContext, token: string, fixtures: Fixtures): Promise<void> {
  const response = await apiRequest(request, 'GET', '/api/knowledge_articles/taxonomy', { token })
  expect(response.status()).toBe(200)
  const taxonomy = await readJsonSafe<TaxonomyResponse>(response)
  const categoryIds = new Map<string, string>()
  const topics = new Set<string>()
  for (const category of taxonomy?.items ?? []) {
    categoryIds.set(category.key, category.id)
    for (const subcategory of category.subcategories ?? []) {
      categoryIds.set(subcategory.key, subcategory.id)
      for (const topic of subcategory.topics ?? []) topics.add(topic.key)
    }
  }
  for (const seed of KB_TOPICS) {
    if (topics.has(seed.key)) continue
    let categoryId = categoryIds.get(seed.categoryKey)
    if (!categoryId) {
      categoryId = await createCategory(request, token, { level: 'category', key: seed.categoryKey, name: seed.categoryName }, fixtures)
      categoryIds.set(seed.categoryKey, categoryId)
    }
    let subcategoryId = categoryIds.get(seed.subcategoryKey)
    if (!subcategoryId) {
      subcategoryId = await createCategory(
        request,
        token,
        { level: 'subcategory', parentId: categoryId, key: seed.subcategoryKey, name: seed.subcategoryName },
        fixtures,
      )
      categoryIds.set(seed.subcategoryKey, subcategoryId)
    }
    const create = await apiRequest(request, 'POST', '/api/knowledge_articles/articles', {
      token,
      data: {
        categoryId: subcategoryId,
        key: seed.key,
        title: seed.title,
        summary: seed.title,
        keywords: [seed.title.toLowerCase()],
        procedureSteps: seed.procedureSteps,
        requiredChecks: seed.requiredChecks,
        recommendedActions: seed.recommendedActions,
        automationLevel: seed.automationLevel,
        manualReason: seed.manualReason ?? null,
        targetQueueKey: seed.targetQueueKey ?? null,
        priorityFloor: seed.priorityFloor ?? null,
        replyTemplate: seed.replyTemplate ?? null,
      },
    })
    const created = await readJsonSafe<{ id?: string }>(create)
    expect(create.status(), `create KB article failed: ${JSON.stringify(created)}`).toBe(201)
    fixtures.articleIds.push(created?.id as string)
    const publish = await apiRequest(request, 'POST', `/api/knowledge_articles/articles/${created?.id}/publish`, { token, data: {} })
    expect(publish.status(), `publish KB article failed: ${await publish.text()}`).toBe(200)
  }
}

export type ReservationSeed = {
  bookingNumber?: string
  departureInDays: number
  totalPrice: number
  hotelName?: string
  destination?: string
  payments?: Array<{ amount: number; status: 'booked' | 'pending' }>
}

export type Persona = { personId: string; email: string; name: string; reservations: Array<{ id: string; bookingNumber: string }> }

export async function createPersona(
  request: APIRequestContext,
  token: string,
  fixtures: Fixtures,
  label: string,
  reservations: ReservationSeed[],
): Promise<Persona> {
  const stamp = uniqueStamp()
  const email = `qa.triage.${label}.${stamp}@example.com`
  const name = `QA ${label} ${stamp}`
  const personId = await createPersonFixture(request, token, { firstName: 'QA', lastName: `${label} ${stamp}`, displayName: name, primaryEmail: email })
  fixtures.personIds.push(personId)
  const created: Persona['reservations'] = []
  for (const seed of reservations) {
    const bookingNumber = seed.bookingNumber ?? uniqueBookingNumber()
    const response = await apiRequest(request, 'POST', '/api/reservations/reservations', {
      token,
      data: {
        bookingNumber,
        customerPersonId: personId,
        customerEmail: email,
        customerName: name,
        status: 'confirmed',
        destination: seed.destination ?? 'Crete, Greece',
        hotelName: seed.hotelName ?? 'QA Hotel',
        departureDate: isoDateFromToday(seed.departureInDays),
        returnDate: isoDateFromToday(seed.departureInDays + 7),
        travelersCount: 2,
        totalPriceAmount: seed.totalPrice,
        currencyCode: 'EUR',
      },
    })
    const body = await readJsonSafe<{ id?: string }>(response)
    expect(response.status(), `create reservation failed: ${JSON.stringify(body)}`).toBe(201)
    const reservationId = body?.id as string
    fixtures.reservationIds.push(reservationId)
    for (const payment of seed.payments ?? []) {
      const paymentResponse = await apiRequest(request, 'POST', '/api/reservations/payments', {
        token,
        data: { reservationId, amount: payment.amount, status: payment.status, method: 'transfer', externalReference: `QA ${bookingNumber}` },
      })
      expect(paymentResponse.status(), `record payment failed: ${await paymentResponse.text()}`).toBe(201)
    }
    created.push({ id: reservationId, bookingNumber })
  }
  return { personId, email, name, reservations: created }
}

export async function sendEmail(
  request: APIRequestContext,
  token: string,
  fixtures: Fixtures,
  persona: Persona,
  email: { subject: string; body: string },
): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/tickets/intake/simulate', {
    token,
    data: { fromEmail: persona.email, fromName: persona.name, subject: email.subject, body: email.body },
  })
  const body = await readJsonSafe<{ ticketId?: string }>(response)
  expect([200, 201], `simulate intake failed: ${JSON.stringify(body)}`).toContain(response.status())
  fixtures.ticketIds.push(body?.ticketId as string)
  return body?.ticketId as string
}

/**
 * Starts triage for a ticket through the process' manual trigger. Integration runs
 * keep the ticket-created trigger off (OM_TRIAGE_AUTO_START), so this spec opts its
 * own tickets in explicitly instead of triaging every ticket other specs create.
 */
export async function startTriage(request: APIRequestContext, token: string, ticketId: string): Promise<void> {
  const response = await apiRequest(request, 'POST', `/api/triage_agents/tickets/${ticketId}/rerun`, { token, data: {} })
  expect(response.status(), `start triage failed: ${await response.text()}`).toBe(202)
}

async function readTicketUpdatedAt(request: APIRequestContext, token: string, ticketId: string): Promise<string | null> {
  const response = await apiRequest(request, 'GET', `/api/tickets/tickets?id=${ticketId}&pageSize=1`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ updatedAt?: string | null }> }>(response)
  return body?.items?.[0]?.updatedAt ?? null
}

export async function classifyManually(request: APIRequestContext, token: string, ticketId: string, data: Record<string, unknown>): Promise<void> {
  const updatedAt = await readTicketUpdatedAt(request, token, ticketId)
  const response = await apiRequest(request, 'POST', `/api/tickets/tickets/${ticketId}/classify`, {
    token,
    data: { ...data, source: 'manual' },
    headers: updatedAt ? { [OPTIMISTIC_LOCK_HEADER]: updatedAt } : undefined,
  })
  expect(response.status(), `manual classify failed: ${await response.text()}`).toBe(200)
}

export async function readTriage(request: APIRequestContext, token: string, ticketId: string): Promise<TriageView | null> {
  const response = await apiRequest(request, 'GET', `/api/triage_agents/tickets/${ticketId}`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ triage: TriageView | null }>(response)
  return body?.triage ?? null
}

export async function waitForTriage(
  request: APIRequestContext,
  token: string,
  ticketId: string,
  done: (triage: TriageView) => boolean,
  timeoutMs = 120_000,
): Promise<TriageView> {
  const deadline = Date.now() + timeoutMs
  let last: TriageView | null = null
  while (Date.now() < deadline) {
    last = await readTriage(request, token, ticketId)
    if (last && done(last)) return last
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  throw new Error(`[internal] triage of ${ticketId} did not settle in time; last state ${JSON.stringify(last)}`)
}

export const settled = (triage: TriageView): boolean => ['awaiting_approval', 'done', 'failed'].includes(triage.stage)

export type TicketView = {
  id: string
  status: string
  priority: string
  priorityReason: string | null
  queueKey: string | null
  topicKey: string | null
  classificationSource: string | null
  needsManualReview: boolean
  manualReviewReasonCode: string | null
}

export async function readTicket(request: APIRequestContext, token: string, ticketId: string): Promise<TicketView | null> {
  const response = await apiRequest(request, 'GET', `/api/tickets/tickets?id=${ticketId}&pageSize=1`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: TicketView[] }>(response)
  return body?.items?.[0] ?? null
}

export async function listOutboundArticles(request: APIRequestContext, token: string, ticketId: string): Promise<Array<{ bodyText: string; deliveryStatus: string }>> {
  const response = await apiRequest(request, 'GET', `/api/tickets/tickets/${ticketId}/articles`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ direction: string; bodyText: string; deliveryStatus: string }> }>(response)
  return (body?.items ?? []).filter((article) => article.direction === 'outbound')
}

export async function listRefunds(request: APIRequestContext, token: string, reservationId: string): Promise<Array<{ amount: string; status: string; sourceType: string | null }>> {
  const response = await apiRequest(request, 'GET', `/api/reservations/refunds?reservationId=${reservationId}&pageSize=20`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ amount: string; status: string; sourceType: string | null }> }>(response)
  return body?.items ?? []
}

type ProposalRow = { id: string; payload: unknown; updated_at?: string; updatedAt?: string }

export async function readProposal(request: APIRequestContext, token: string, proposalId: string): Promise<{ payload: Record<string, unknown>; updatedAt: string }> {
  const response = await apiRequest(request, 'GET', `/api/agent_orchestrator/proposals?id=${proposalId}`, { token })
  expect(response.status(), `read proposal failed: ${await response.text()}`).toBe(200)
  const body = await readJsonSafe<{ items?: ProposalRow[] }>(response)
  const row = body?.items?.find((item) => item.id === proposalId)
  expect(row, 'proposal row').toBeTruthy()
  const raw = row?.payload
  const payload = (typeof raw === 'string' ? JSON.parse(raw) : raw) as Record<string, unknown>
  return { payload, updatedAt: String(row?.updated_at ?? row?.updatedAt) }
}

export async function disposeProposal(
  request: APIRequestContext,
  token: string,
  proposalId: string,
  updatedAt: string,
  data: Record<string, unknown>,
): Promise<void> {
  const response = await apiRequest(request, 'POST', `/api/agent_orchestrator/proposals/${proposalId}/dispose`, {
    token,
    data,
    headers: { [OPTIMISTIC_LOCK_HEADER]: new Date(updatedAt).toISOString() },
  })
  expect(response.status(), `dispose failed: ${await response.text()}`).toBe(200)
}

export async function cleanupFixtures(request: APIRequestContext, token: string | null, fixtures: Fixtures): Promise<void> {
  if (!token) return
  for (const id of fixtures.ticketIds) {
    try {
      await apiRequest(request, 'DELETE', `/api/tickets/tickets?id=${encodeURIComponent(id)}`, { token })
    } catch {
      continue
    }
  }
  for (const id of fixtures.reservationIds) await deleteEntityIfExists(request, token, '/api/reservations/reservations', id)
  for (const id of fixtures.personIds) await deleteEntityIfExists(request, token, '/api/customers/people', id)
  for (const id of fixtures.articleIds) await deleteEntityIfExists(request, token, '/api/knowledge_articles/articles', id)
  for (const id of [...fixtures.categoryIds].reverse()) await deleteEntityIfExists(request, token, '/api/knowledge_articles/categories', id)
}

export const OVERPAYMENT_ARTICLE_KEY = 'payments.refunds.overpayment_refund'

export type KbArticleContent = {
  id: string
  updatedAt: string | null
  procedureSteps: Array<Record<string, unknown>>
  requiredChecks: Array<Record<string, unknown>>
}

export async function readKbArticleByKey(request: APIRequestContext, token: string, key: string): Promise<KbArticleContent> {
  const response = await apiRequest(request, 'GET', `/api/knowledge_articles/articles?key=${encodeURIComponent(key)}&pageSize=1`, { token })
  expect(response.status(), `read KB article failed: ${await response.text()}`).toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  const item = body?.items?.[0]
  expect(item, `KB article ${key}`).toBeTruthy()
  return {
    id: String(item?.id),
    updatedAt: typeof item?.updatedAt === 'string' ? item.updatedAt : null,
    procedureSteps: Array.isArray(item?.procedureSteps) ? (item.procedureSteps as Array<Record<string, unknown>>) : [],
    requiredChecks: Array.isArray(item?.requiredChecks) ? (item.requiredChecks as Array<Record<string, unknown>>) : [],
  }
}

/** Edits the article's procedure and required checks, then publishes a new version; returns its number. */
export async function publishKbArticleContent(
  request: APIRequestContext,
  token: string,
  key: string,
  content: { procedureSteps: Array<Record<string, unknown>>; requiredChecks: Array<Record<string, unknown>> },
): Promise<number> {
  const current = await readKbArticleByKey(request, token, key)
  const update = await apiRequest(request, 'PUT', '/api/knowledge_articles/articles', {
    token,
    data: { id: current.id, procedureSteps: content.procedureSteps, requiredChecks: content.requiredChecks },
    headers: current.updatedAt ? { [OPTIMISTIC_LOCK_HEADER]: current.updatedAt } : undefined,
  })
  expect(update.status(), `update KB article failed: ${await update.text()}`).toBe(200)
  const edited = await readKbArticleByKey(request, token, key)
  const publish = await apiRequest(request, 'POST', `/api/knowledge_articles/articles/${edited.id}/publish`, {
    token,
    data: {},
    headers: edited.updatedAt ? { [OPTIMISTIC_LOCK_HEADER]: edited.updatedAt } : undefined,
  })
  const published = await readJsonSafe<{ version?: number }>(publish)
  expect(publish.status(), `publish KB article failed: ${JSON.stringify(published)}`).toBe(200)
  return Number(published?.version)
}
