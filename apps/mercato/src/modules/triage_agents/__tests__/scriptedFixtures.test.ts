/** @jest-environment node */
import path from 'node:path'
import { generateText, Output, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import {
  clearScriptedLlmFixtureDirsForTests,
  createScriptedLanguageModel,
  registerScriptedLlmFixtureDirs,
} from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-adapters/scripted'
import { withScriptedLlmContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-adapters/scripted-context'
import {
  classifierResultSchema,
  contextIdentifierResultSchema,
  resolutionAdvisorResultSchema,
} from '../data/validators'
import { CLASSIFIER_AGENT_ID, CONTEXT_IDENTIFIER_AGENT_ID, RESOLUTION_ADVISOR_AGENT_ID } from '../data/constants'
import { TRIAGE_SCENARIOS, type TriageScenario } from '../lib/scenarios'
import { decideRoute } from '../lib/routePolicy'
import { verifyProposalGrounding } from '../lib/grounding'
import { toArticlePolicy } from '../lib/kbArticles'
import { normalizeProposalEnvelope, readProposalEvidence } from '@open-mercato/enterprise/modules/agent_orchestrator/data/proposalEnvelope'
import { proposalEvidenceSchema } from '@open-mercato/enterprise/modules/agent_orchestrator/data/validators'

const FIXTURES_DIR = path.join(__dirname, '..', 'agents-fixtures')
const INPUT_KEY = 'f'.repeat(64)
const TICKET_ID = '10000000-0000-4000-8000-000000000001'

type Reservation = {
  id: string
  bookingNumber: string
  customerPersonId: string
  customerName: string
  destination: string
  hotelName: string
  departureDate: string
  daysToDeparture: number
  totalPrice: number
  paid: number
  pending: number
}

function reservation(index: number, overrides: Partial<Reservation>): Reservation {
  return {
    id: `20000000-0000-4000-8000-00000000000${index}`,
    bookingNumber: `BKN10${index}`,
    customerPersonId: '30000000-0000-4000-8000-000000000001',
    customerName: 'Demo Customer',
    destination: 'Crete, Greece',
    hotelName: 'Hotel Minos Beach',
    departureDate: '2026-10-16',
    daysToDeparture: 3,
    totalPrice: 2400,
    paid: 2400,
    pending: 0,
    ...overrides,
  }
}

const WORLD: Record<string, Reservation[]> = {
  overpayment_refund: [reservation(1, { bookingNumber: 'ABC123', customerName: 'Anna Carter', paid: 2750 })],
  payment_confirmed: [reservation(2, { bookingNumber: 'XYZ789', customerName: 'Peter Brooks', daysToDeparture: 40, totalPrice: 1800, paid: 1800 })],
  payment_not_visible: [reservation(3, { bookingNumber: 'MLZ456', customerName: 'Maria Lopez', daysToDeparture: 12, totalPrice: 1350, paid: 0, pending: 1350 })],
  room_preference: [
    reservation(4, { bookingNumber: 'AUR901', hotelName: 'Hotel Aurora', destination: 'Rhodes, Greece', daysToDeparture: 9 }),
    reservation(5, { bookingNumber: 'SOL902', hotelName: 'Hotel Sol', destination: 'Mallorca, Spain', daysToDeparture: 120 }),
  ],
  hotel_complaint: [reservation(6, { bookingNumber: 'TWK310', daysToDeparture: -14 })],
  ambiguous_date_change: [
    reservation(7, { bookingNumber: 'JML501', destination: 'Sicily, Italy', daysToDeparture: 21 }),
    reservation(8, { bookingNumber: 'JML502', destination: 'Madeira, Portugal', daysToDeparture: 55 }),
  ],
}

const ARTICLES: Record<string, Record<string, unknown>> = {
  'payments.refunds.overpayment_refund': {
    title: 'Overpayment refund',
    automationLevel: 'assisted',
    procedureSteps: ['S1', 'S2', 'S3', 'S4', 'S5'].map((id) => ({ id, text: id })),
    requiredChecks: [{ key: 'owner_verified' }, { key: 'overpayment_confirmed' }, { key: 'iban_present' }],
    recommendedActions: [{ actionKey: 'reservations.refund.request' }, { actionKey: 'tickets.reply.send' }],
  },
  'payments.incoming.payment_confirmation': {
    title: 'Payment confirmation',
    automationLevel: 'assisted',
    procedureSteps: ['S1', 'S2', 'S3', 'S4'].map((id) => ({ id, text: id })),
    requiredChecks: [{ key: 'payment_booked' }],
    recommendedActions: [{ actionKey: 'tickets.ticket.transition' }, { actionKey: 'tickets.reply.send' }],
  },
  'booking.special_requests.room_preference': { title: 'Room preference', automationLevel: 'manual_only' },
  'complaints.service.hotel_service_complaint': { title: 'Hotel service complaint', automationLevel: 'manual_only', targetQueueKey: 'complaints' },
  'booking.changes.date_change': { title: 'Date change', automationLevel: 'manual_only' },
  'general.identification.unknown_booking': { title: 'Unknown booking', automationLevel: 'manual_only' },
}

function articleSnapshot(key: string): Record<string, unknown> {
  const [category, subcategory] = key.split('.')
  return {
    key,
    version: 3,
    category: { key: category, name: category[0].toUpperCase() + category.slice(1) },
    subcategory: { key: `${category}.${subcategory}`, name: subcategory.replaceAll('_', ' ') },
    procedureSteps: [],
    requiredChecks: [],
    recommendedActions: [],
    replyTemplate: null,
    ...ARTICLES[key],
  }
}

function buildTools(scenario: TriageScenario) {
  const reservations = WORLD[scenario.key]
  const dto = (entry: Reservation) => ({
    id: entry.id,
    bookingNumber: entry.bookingNumber,
    customerPersonId: entry.customerPersonId,
    customerName: entry.customerName,
    destination: entry.destination,
    hotelName: entry.hotelName,
    departureDate: entry.departureDate,
    daysToDeparture: entry.daysToDeparture,
  })
  return {
    tickets__get_ticket: tool({
      description: 'ticket',
      inputSchema: z.object({ ticketId: z.string() }),
      execute: async ({ ticketId }) =>
        JSON.stringify({
          found: true,
          ticket: { id: ticketId, number: 'TCK-000001', subject: scenario.subject, requesterEmail: scenario.fromEmail },
          articles: [{ id: 'a1', direction: 'inbound', body: scenario.body }],
          articleCount: 1,
        }),
    }),
    tickets__list_tickets: tool({ description: 'tickets', inputSchema: z.object({}).passthrough(), execute: async () => ({ items: [] }) }),
    customers__list_people: tool({ description: 'people', inputSchema: z.object({}).passthrough(), execute: async () => ({ items: [] }) }),
    reservations__find_by_booking_number: tool({
      description: 'find',
      inputSchema: z.object({ bookingNumber: z.string(), senderEmail: z.string().optional() }),
      execute: async ({ bookingNumber }) => {
        const found = reservations.find((entry) => entry.bookingNumber === bookingNumber)
        return found ? { found: true, ownerMatch: 'match', reservation: dto(found) } : { found: false, ownerMatch: 'unknown' }
      },
    }),
    reservations__list_for_customer: tool({
      description: 'list',
      inputSchema: z.object({ email: z.string().optional(), customerPersonId: z.string().optional() }),
      execute: async () => ({ customerPersonId: reservations[0].customerPersonId, reservations: reservations.map(dto) }),
    }),
    reservations__get_details: tool({
      description: 'details',
      inputSchema: z.object({ reservationId: z.string() }),
      execute: async ({ reservationId }) => {
        const entry = reservations.find((candidate) => candidate.id === reservationId) ?? reservations[0]
        return {
          found: true,
          reservation: dto(entry),
          payments: [],
          refunds: [],
          balance: {
            totalPrice: entry.totalPrice,
            paidTotal: entry.paid,
            pendingPaymentsTotal: entry.pending,
            refundedTotal: 0,
            outstanding: Math.max(entry.totalPrice - entry.paid, 0),
            overpayment: Math.max(entry.paid - entry.totalPrice, 0),
            currencyCode: 'EUR',
            daysToDeparture: entry.daysToDeparture,
          },
        }
      },
    }),
    knowledge_articles__browse_taxonomy: tool({ description: 'taxonomy', inputSchema: z.object({}).passthrough(), execute: async () => ({ categories: [] }) }),
    knowledge_articles__search: tool({ description: 'search', inputSchema: z.object({}).passthrough(), execute: async () => ({ items: [] }) }),
    knowledge_articles__get_article: tool({
      description: 'article',
      inputSchema: z.object({ key: z.string(), version: z.number().optional().nullable() }),
      execute: async ({ key }) =>
        ARTICLES[key]
          ? { found: true, key, version: 3, citation: `${key}@3`, publishedAt: '2026-10-01T00:00:00.000Z', article: articleSnapshot(key) }
          : { found: false, key, version: null },
    }),
  }
}

async function runAgent<T extends z.ZodTypeAny>(agentId: string, input: Record<string, unknown>, scenario: TriageScenario, schema: T): Promise<z.infer<T>> {
  const result = await withScriptedLlmContext({ agentId, inputKey: INPUT_KEY, input }, () =>
    generateText({
      model: createScriptedLanguageModel(),
      tools: buildTools(scenario),
      stopWhen: stepCountIs(8),
      output: Output.object({ schema }),
      prompt: JSON.stringify(input),
    }),
  )
  return (result as unknown as { output: z.infer<T> }).output
}

beforeAll(() => {
  clearScriptedLlmFixtureDirsForTests()
  registerScriptedLlmFixtureDirs([FIXTURES_DIR])
})

const EXPECTED: Record<string, { match: string; topic: string; route: string; reasonCode: string | null; options: number | null }> = {
  overpayment_refund: { match: 'explicit_number_verified', topic: 'payments.refunds.overpayment_refund', route: 'assisted', reasonCode: null, options: 1 },
  payment_confirmed: { match: 'single_reservation', topic: 'payments.incoming.payment_confirmation', route: 'assisted', reasonCode: null, options: 1 },
  payment_not_visible: { match: 'single_reservation', topic: 'payments.incoming.payment_confirmation', route: 'assisted', reasonCode: null, options: 0 },
  room_preference: { match: 'inferred_from_content', topic: 'booking.special_requests.room_preference', route: 'manual', reasonCode: 'topic_manual_only', options: null },
  hotel_complaint: { match: 'single_reservation', topic: 'complaints.service.hotel_service_complaint', route: 'manual', reasonCode: 'topic_manual_only', options: null },
  ambiguous_date_change: { match: 'ambiguous', topic: 'booking.changes.date_change', route: 'manual', reasonCode: 'reservation_ambiguous', options: null },
}

describe('scripted triage fixtures replay the six demo scenarios', () => {
  it.each(TRIAGE_SCENARIOS.map((scenario) => [scenario.key, scenario] as const))('%s', async (_key, scenario) => {
    const expected = EXPECTED[scenario.key]
    const identification = await runAgent(CONTEXT_IDENTIFIER_AGENT_ID, { ticketId: TICKET_ID }, scenario, contextIdentifierResultSchema)
    expect(identification.data.reservation.match).toBe(expected.match)

    const classification = await runAgent(CLASSIFIER_AGENT_ID, { ticketId: TICKET_ID, identification: identification.data }, scenario, classifierResultSchema)
    expect(classification.data.topicKey).toBe(expected.topic)
    expect(classification.data.topicVersion).toBe(3)

    const article = toArticlePolicy(expected.topic, 3, articleSnapshot(expected.topic))
    const route = decideRoute(identification.data, classification.data, article)
    expect(route.route).toBe(expected.route)
    expect(route.reasonCode).toBe(expected.reasonCode)
    if (expected.options === null) return

    const advice = await runAgent(
      RESOLUTION_ADVISOR_AGENT_ID,
      { ticketId: TICKET_ID, ticketNumber: 'TCK-000001', identification: identification.data, classification: classification.data },
      scenario,
      resolutionAdvisorResultSchema,
    )
    expect(advice.proposal.options).toHaveLength(expected.options)
    const reparsed = resolutionAdvisorResultSchema.parse(advice)
    const evidence = readProposalEvidence(normalizeProposalEnvelope(reparsed.proposal, 'triage'))
    expect(proposalEvidenceSchema.safeParse(reparsed.proposal.evidence).error?.issues ?? []).toEqual([])
    expect(evidence?.citations?.length).toBeGreaterThan(0)
    const verdict = await verifyProposalGrounding(advice.proposal, async (key, version) =>
      ARTICLES[key] && version === 3 ? toArticlePolicy(key, 3, articleSnapshot(key)) : null,
    )
    if (expected.options > 0) expect(verdict).toMatchObject({ state: 'verified', issues: [] })
    if (scenario.key === 'overpayment_refund') {
      const [refund, reply] = advice.proposal.options[0].actions
      expect(refund).toMatchObject({ type: 'reservations.refund.request', payload: { amount: 350, currencyCode: 'EUR', bankAccountNumber: 'DE89 3704 0044 0532 0130 00' } })
      expect(reply.type).toBe('tickets.reply.send')
    }
    if (scenario.key === 'payment_not_visible') {
      expect(advice.proposal.evidence.uncertainty[0]).toMatchObject({ code: 'payment_not_visible', blocking: true })
    }
  })
})
