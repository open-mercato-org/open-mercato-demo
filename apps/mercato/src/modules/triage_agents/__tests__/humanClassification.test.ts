/** @jest-environment node */
import {
  applyHumanClassification,
  isHumanClassified,
  loadTicketClassification,
  toClassificationState,
} from '../lib/humanClassification'
import { createRouteFunction } from '../lib/workflowFunctions'
import { projectClassification } from '../lib/projection'

jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))

const TENANT = '00000000-0000-4000-8000-0000000000aa'
const ORG = '00000000-0000-4000-8000-0000000000bb'
const TICKET = '00000000-0000-4000-8000-0000000000dd'
const HUMAN_RESERVATION = '00000000-0000-4000-8000-0000000000ee'
const scope = { tenantId: TENANT, organizationId: ORG }
const context = { workflowInstance: { id: '00000000-0000-4000-8000-0000000000cc', tenantId: TENANT, organizationId: ORG } }

const ambiguousIdentification = {
  customer: { personId: '00000000-0000-4000-8000-000000000001', match: 'confirmed' },
  reservation: {
    reservationId: null,
    bookingNumber: null,
    match: 'ambiguous',
    candidates: [
      { reservationId: HUMAN_RESERVATION, bookingNumber: 'QAB123', label: 'Crete', daysToDeparture: 20 },
      { reservationId: '00000000-0000-4000-8000-0000000000ff', bookingNumber: 'QAB456', label: 'Rhodes', daysToDeparture: 40 },
    ],
    departureDate: null,
    daysToDeparture: null,
  },
  uncertainty: [{ code: 'reservation_ambiguous', message: 'Two upcoming bookings.', blocking: true }],
  confidence: 0.5,
}

const aiClassification = {
  categoryKey: 'booking',
  subcategoryKey: 'booking.changes',
  topicKey: 'booking.changes.date_change',
  topicVersion: 2,
  summary: 'The customer wants to move the trip.',
  urgencySignal: 'none',
  confidence: 0.55,
  uncertainty: [{ code: 'topic_unclear', message: 'Could be a cancellation.', blocking: true }],
}

const paymentSnapshot = {
  title: 'Payment confirmation',
  category: { key: 'payments', name: 'Payments' },
  subcategory: { key: 'payments.incoming', name: 'Incoming payments' },
  automationLevel: 'assisted',
  procedureSteps: [{ id: 'S1', text: 'Check the payment.', checkKey: 'payment_booked' }],
  requiredChecks: [{ key: 'payment_booked', label: 'Payment booked' }],
  recommendedActions: [{ actionKey: 'tickets.reply.send', label: 'Reply' }],
}

const humanRow = {
  id: TICKET,
  classification_source: 'manual',
  customer_person_id: '00000000-0000-4000-8000-000000000001',
  reservation_id: HUMAN_RESERVATION,
  reservation_number_snapshot: 'QAB123',
  category_key: 'payments',
  subcategory_key: 'payments.incoming',
  topic_key: 'payments.incoming.payment_confirmation',
}

function containerWith(options: { ticketRows?: Array<Record<string, unknown>>; queryEngineMissing?: boolean; failQuery?: boolean }) {
  const query = jest.fn(async () => {
    if (options.failQuery) throw new Error('query failed')
    return { items: options.ticketRows ?? [], page: 1, pageSize: 1, total: (options.ticketRows ?? []).length }
  })
  const readVersion = jest.fn(async (_scope: unknown, key: string) =>
    key === 'payments.incoming.payment_confirmation' ? { key, version: 5, snapshot: paymentSnapshot } : null,
  )
  const container = {
    resolve: <T,>(name: string): T => {
      if (name === 'queryEngine' && !options.queryEngineMissing) return { query } as unknown as T
      if (name === 'knowledgeArticleVersionReader') return { readVersion } as unknown as T
      throw new Error(`[internal] ${name} not registered`)
    },
  }
  return { container, query, readVersion }
}

describe('manual classification handling', () => {
  it('reads the ticket classification through the query engine with tenant scope', async () => {
    const { container, query } = containerWith({ ticketRows: [humanRow] })
    const state = await loadTicketClassification(container, scope, TICKET)
    expect(query).toHaveBeenCalledWith(
      'tickets:ticket',
      expect.objectContaining({ tenantId: TENANT, organizationId: ORG, filters: { id: { $eq: TICKET } } }),
    )
    expect(isHumanClassified(state)).toBe(true)
    expect(state?.topicKey).toBe('payments.incoming.payment_confirmation')
  })

  it('is soft-optional: no ticket id, no query engine or a failing query yields null', async () => {
    expect(await loadTicketClassification(containerWith({ ticketRows: [humanRow] }).container, scope, null)).toBeNull()
    expect(await loadTicketClassification(containerWith({ queryEngineMissing: true }).container, scope, TICKET)).toBeNull()
    expect(await loadTicketClassification(containerWith({ failQuery: true }).container, scope, TICKET)).toBeNull()
    expect(isHumanClassified(toClassificationState({ classificationSource: 'workflow' }))).toBe(false)
  })

  it('replaces the AI values with the consultant classification', () => {
    const effective = applyHumanClassification(ambiguousIdentification, aiClassification, toClassificationState(humanRow))
    expect(effective.classification).toMatchObject({
      categoryKey: 'payments',
      subcategoryKey: 'payments.incoming',
      topicKey: 'payments.incoming.payment_confirmation',
      topicVersion: null,
      confidence: 1,
      uncertainty: [],
      source: 'manual',
      summary: aiClassification.summary,
    })
    expect(effective.identification?.reservation).toMatchObject({
      reservationId: HUMAN_RESERVATION,
      bookingNumber: 'QAB123',
      match: 'explicit_number_verified',
      candidates: [],
    })
    expect(effective.identification?.uncertainty).toEqual([])
    expect(projectClassification(effective.classification, null)).toMatchObject({ source: 'manual' })
    expect(projectClassification(aiClassification, null)).toMatchObject({ source: 'ai' })
  })

  it('route keeps the human classification and routes with it', async () => {
    const { container } = containerWith({ ticketRows: [humanRow] })
    const result = await createRouteFunction(container)(
      { ticketId: TICKET, identification: ambiguousIdentification, classification: aiClassification },
      context,
    )
    expect(result.humanClassified).toBe(true)
    expect(result.route).toBe('assisted')
    expect(result.article).toMatchObject({ key: 'payments.incoming.payment_confirmation', version: 5 })
    expect(result.classification).toMatchObject({ topicKey: 'payments.incoming.payment_confirmation', source: 'manual' })
    expect(result.classify.reservationId).toBe(HUMAN_RESERVATION)
  })

  it('route leaves AI-classified tickets untouched', async () => {
    const { container } = containerWith({ ticketRows: [{ ...humanRow, classification_source: 'workflow' }] })
    const result = await createRouteFunction(container)(
      { ticketId: TICKET, identification: ambiguousIdentification, classification: aiClassification },
      context,
    )
    expect(result.humanClassified).toBe(false)
    expect(result.classification).toEqual(aiClassification)
    expect(result.identification).toEqual(ambiguousIdentification)
    expect(result.route).toBe('manual')
  })
})
