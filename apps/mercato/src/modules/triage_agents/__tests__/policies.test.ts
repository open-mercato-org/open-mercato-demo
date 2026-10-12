/** @jest-environment node */
import { computePriority } from '../lib/priorityPolicy'
import { decideRoute, type RouteArticlePolicy, type RouteIdentification } from '../lib/routePolicy'

const assisted = (key: string, version = 1): RouteArticlePolicy => ({
  key,
  version,
  automationLevel: 'assisted',
  manualReason: null,
  targetQueueKey: null,
  priorityFloor: null,
})

const manualOnly = (key: string, manualReason: string, targetQueueKey: string | null = null, priorityFloor: string | null = null): RouteArticlePolicy => ({
  key,
  version: 1,
  automationLevel: 'manual_only',
  manualReason,
  targetQueueKey,
  priorityFloor,
})

const identified = (match: string, days: number | null): RouteIdentification & { days: number | null } => ({
  customer: { personId: '00000000-0000-4000-8000-000000000001', match: 'confirmed' },
  reservation: { reservationId: '00000000-0000-4000-8000-000000000002', bookingNumber: 'ABC123', match, candidates: [] },
  uncertainty: [],
  days,
})

const COMPLAINT = manualOnly('complaints.service.hotel_service_complaint', 'Complaints are handled by the complaints team.', 'complaints', 'normal')

type PersonaCase = {
  persona: string
  identification: RouteIdentification & { days: number | null }
  topicKey: string
  article: RouteArticlePolicy
  confidence: number
  urgencySignal: 'none' | 'raise_one'
  expected: { priority: string; reason: string; route: string; reasonCode: string | null; targetQueueKey: string | null }
}

const PERSONAS: PersonaCase[] = [
  {
    persona: 'Anna Carter — overpayment ABC123',
    identification: identified('explicit_number_verified', 3),
    topicKey: 'payments.refunds.overpayment_refund',
    article: assisted('payments.refunds.overpayment_refund', 3),
    confidence: 0.92,
    urgencySignal: 'none',
    expected: { priority: 'high', reason: 'high – departure in 3 days', route: 'assisted', reasonCode: null, targetQueueKey: null },
  },
  {
    persona: 'Peter Brooks — payment booked',
    identification: identified('single_reservation', 40),
    topicKey: 'payments.incoming.payment_confirmation',
    article: assisted('payments.incoming.payment_confirmation'),
    confidence: 0.88,
    urgencySignal: 'none',
    expected: { priority: 'low', reason: 'low – departure in 40 days', route: 'assisted', reasonCode: null, targetQueueKey: null },
  },
  {
    persona: 'Maria Lopez — payment not booked',
    identification: identified('single_reservation', 12),
    topicKey: 'payments.incoming.payment_confirmation',
    article: assisted('payments.incoming.payment_confirmation'),
    confidence: 0.86,
    urgencySignal: 'none',
    expected: { priority: 'normal', reason: 'normal – departure in 12 days', route: 'assisted', reasonCode: null, targetQueueKey: null },
  },
  {
    persona: 'Emma Wilson — quiet room',
    identification: identified('inferred_from_content', 9),
    topicKey: 'booking.special_requests.room_preference',
    article: manualOnly('booking.special_requests.room_preference', 'Requests are forwarded to the hotel without a guarantee — the consultant decides.'),
    confidence: 0.9,
    urgencySignal: 'none',
    expected: {
      priority: 'normal',
      reason: 'normal – departure in 9 days',
      route: 'manual',
      reasonCode: 'topic_manual_only',
      targetQueueKey: null,
    },
  },
  {
    persona: 'Tom Walker — complaint',
    identification: identified('single_reservation', -14),
    topicKey: COMPLAINT.key,
    article: COMPLAINT,
    confidence: 0.93,
    urgencySignal: 'none',
    expected: {
      priority: 'normal',
      reason: 'normal – departure date has passed + topic minimum',
      route: 'manual',
      reasonCode: 'topic_manual_only',
      targetQueueKey: 'complaints',
    },
  },
  {
    persona: 'John Miller — ambiguous',
    identification: {
      customer: { personId: '00000000-0000-4000-8000-000000000003', match: 'confirmed' },
      reservation: {
        reservationId: null,
        bookingNumber: null,
        match: 'ambiguous',
        candidates: [
          { reservationId: 'r1', bookingNumber: 'JML501', label: 'Sicily, Italy' },
          { reservationId: 'r2', bookingNumber: 'JML502', label: 'Madeira, Portugal' },
        ],
      },
      uncertainty: [{ code: 'reservation_ambiguous', message: 'Two reservations', blocking: true }],
      days: 21,
    },
    topicKey: 'booking.changes.date_change',
    article: manualOnly('booking.changes.date_change', 'Date changes require checking supplier availability and fare conditions.'),
    confidence: 0.8,
    urgencySignal: 'none',
    expected: {
      priority: 'low',
      reason: 'low – departure in 21 days',
      route: 'manual',
      reasonCode: 'reservation_ambiguous',
      targetQueueKey: null,
    },
  },
]

describe('triage policies over the six demo personas', () => {
  it.each(PERSONAS)('$persona', (scenario) => {
    const priority = computePriority({
      daysToDeparture: scenario.identification.days,
      priorityFloor: scenario.article.priorityFloor,
      urgencySignal: scenario.urgencySignal,
    })
    expect(priority.priority).toBe(scenario.expected.priority)
    expect(priority.priorityReason).toBe(scenario.expected.reason)
    const route = decideRoute(
      scenario.identification,
      { topicKey: scenario.topicKey, confidence: scenario.confidence, uncertainty: [] },
      scenario.article,
    )
    expect(route.route).toBe(scenario.expected.route)
    expect(route.reasonCode).toBe(scenario.expected.reasonCode)
    expect(route.targetQueueKey).toBe(scenario.expected.targetQueueKey)
  })

  it('lists the candidates in the ambiguous reason', () => {
    const route = decideRoute(PERSONAS[5].identification, { topicKey: 'x', confidence: 0.9 }, PERSONAS[5].article)
    expect(route.reason).toContain('JML501 (Sicily, Italy)')
    expect(route.reason).toContain('JML502 (Madeira, Portugal)')
  })
})

describe('computePriority', () => {
  it.each([
    [0, 'urgent', 'urgent – departure today'],
    [1, 'urgent', 'urgent – departure tomorrow'],
    [2, 'high', 'high – departure in 2 days'],
    [14, 'normal', 'normal – departure in 14 days'],
    [15, 'low', 'low – departure in 15 days'],
    [null, 'low', 'low – no departure date'],
  ])('maps %p days to %s', (days, priority, reason) => {
    const result = computePriority({ daysToDeparture: days })
    expect(result.priority).toBe(priority)
    expect(result.priorityReason).toBe(reason)
  })

  it('raises one level on an urgency signal and caps at urgent', () => {
    expect(computePriority({ daysToDeparture: 3, urgencySignal: 'raise_one' }).priorityReason).toBe(
      'urgent – departure in 3 days + urgency stated in message',
    )
    expect(computePriority({ daysToDeparture: 0, urgencySignal: 'raise_one' }).priority).toBe('urgent')
  })

  it('applies the floor before the urgency signal', () => {
    const result = computePriority({ daysToDeparture: 40, priorityFloor: 'normal', urgencySignal: 'raise_one' })
    expect(result.priority).toBe('high')
    expect(result.priorityReason).toBe('high – departure in 40 days + topic minimum + urgency stated in message')
  })

  it('accepts numeric strings and ignores unknown floors', () => {
    expect(computePriority({ daysToDeparture: '5', priorityFloor: 'bogus' } as never).priority).toBe('normal')
  })
})

describe('decideRoute guards', () => {
  const article = assisted('payments.refunds.overpayment_refund', 3)

  it('routes an identity mismatch to manual review', () => {
    const route = decideRoute(
      { customer: { match: 'confirmed' }, reservation: { match: 'identity_mismatch', reservationId: null } },
      { confidence: 0.9 },
      article,
    )
    expect(route.reasonCode).toBe('identity_mismatch')
  })

  it('routes an unknown customer to manual review', () => {
    const route = decideRoute({ customer: { match: 'not_found' }, reservation: { match: 'not_found' } }, { confidence: 0.9 }, article)
    expect(route.reasonCode).toBe('context_not_found')
  })

  it('routes a missing article to manual review', () => {
    expect(decideRoute(identified('single_reservation', 3), { topicKey: 'x.y.z', confidence: 0.9 }, null).reasonCode).toBe('kb_article_missing')
  })

  it('routes low confidence and blocking uncertainty to manual review', () => {
    expect(decideRoute(identified('single_reservation', 3), { confidence: 0.4 }, article).reasonCode).toBe('low_confidence')
    expect(
      decideRoute(
        identified('single_reservation', 3),
        { confidence: 0.9, uncertainty: [{ code: 'x', message: 'Two topics fit', blocking: true }] },
        article,
      ),
    ).toEqual({ route: 'manual', reasonCode: 'low_confidence', reason: 'Two topics fit', targetQueueKey: null })
  })
})
