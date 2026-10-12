/** @jest-environment node */
import {
  buildClassifyInput,
  createComputePriorityFunction,
  createRouteFunction,
  normalizeRecordStageArgs,
  resolveDaysToDeparture,
} from '../lib/workflowFunctions'
import { toArticlePolicy } from '../lib/kbArticles'

jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))

const TENANT = '00000000-0000-4000-8000-0000000000aa'
const ORG = '00000000-0000-4000-8000-0000000000bb'
const context = { workflowInstance: { id: '00000000-0000-4000-8000-0000000000cc', tenantId: TENANT, organizationId: ORG } }

const complaintSnapshot = {
  title: 'Hotel service complaint',
  category: { key: 'complaints', name: 'Complaints' },
  subcategory: { key: 'complaints.service', name: 'Service' },
  automationLevel: 'manual_only',
  manualReason: 'Complaints are handled by the complaints team.',
  targetQueueKey: 'complaints',
  priorityFloor: 'normal',
  procedureSteps: [{ id: 'S1', text: 'Route to the complaints queue.' }],
  requiredChecks: [],
  recommendedActions: [],
}

function containerWith(rows: Array<Record<string, unknown>>) {
  const execute = jest.fn(async () => rows)
  const em = { fork: () => em, getConnection: () => ({ execute }) }
  return { container: { resolve: <T,>() => em as unknown as T }, execute }
}

const tomIdentification = {
  customer: { personId: '00000000-0000-4000-8000-000000000001', match: 'confirmed' },
  reservation: {
    reservationId: '00000000-0000-4000-8000-000000000002',
    bookingNumber: 'TWK310',
    match: 'single_reservation',
    candidates: [],
    departureDate: '2026-09-28',
    daysToDeparture: -14,
  },
  uncertainty: [],
  confidence: 0.9,
}

const complaintClassification = {
  categoryKey: 'complaints',
  subcategoryKey: 'complaints.service',
  topicKey: 'complaints.service.hotel_service_complaint',
  topicVersion: 1,
  summary: 'The customer complains about a dirty room and a broken air-conditioning unit.',
  urgencySignal: 'none',
  confidence: 0.93,
  uncertainty: [],
}

describe('triage workflow functions', () => {
  it('compute_priority reads the priority floor from the article', async () => {
    const { container, execute } = containerWith([{ article_key: complaintClassification.topicKey, version: 1, snapshot: complaintSnapshot }])
    const fn = createComputePriorityFunction(container)
    const result = await fn({ identification: tomIdentification, classification: complaintClassification }, context)
    expect(result).toMatchObject({ priority: 'normal', priorityReason: 'normal – departure date has passed + topic minimum', priorityFloor: 'normal' })
    expect(execute).toHaveBeenCalledWith(expect.stringContaining('knowledge_article_versions'), [TENANT, ORG, complaintClassification.topicKey, 1])
  })

  it('route sends a manual-only topic to its queue and prepares the classify input', async () => {
    const { container } = containerWith([{ article_key: complaintClassification.topicKey, version: 1, snapshot: complaintSnapshot }])
    const fn = createRouteFunction(container)
    const result = await fn({ identification: tomIdentification, classification: complaintClassification }, context)
    expect(result.route).toBe('manual')
    expect(result.reasonCode).toBe('topic_manual_only')
    expect(result.targetQueueKey).toBe('complaints')
    expect(result.hasTargetQueue).toBe(true)
    expect(result.classify).toEqual({
      customerPersonId: tomIdentification.customer.personId,
      reservationId: tomIdentification.reservation.reservationId,
      reservationNumberSnapshot: 'TWK310',
      categoryKey: 'complaints',
      subcategoryKey: 'complaints.service',
      topicKey: complaintClassification.topicKey,
      categoryPathSnapshot: 'Complaints › Service › Hotel service complaint',
      summary: complaintClassification.summary,
    })
  })

  it('route fails over to kb_article_missing when the article cannot be read', async () => {
    const { container } = containerWith([])
    const result = await createRouteFunction(container)({ identification: tomIdentification, classification: complaintClassification }, context)
    expect(result.reasonCode).toBe('kb_article_missing')
    expect(result.classify.categoryPathSnapshot).toBeNull()
  })

  it('refuses a context without tenant scope', async () => {
    const { container } = containerWith([])
    await expect(
      createRouteFunction(container)({}, { workflowInstance: { id: 'x', tenantId: '', organizationId: '' } }),
    ).rejects.toThrow('[internal]')
  })

  it('uses the nearest upcoming departure of ambiguous candidates', () => {
    expect(
      resolveDaysToDeparture({
        reservation: { daysToDeparture: null, candidates: [{ daysToDeparture: 55 }, { daysToDeparture: 21 }, { daysToDeparture: -3 }] },
      }),
    ).toBe(21)
    expect(resolveDaysToDeparture(null)).toBeNull()
  })

  it('drops unresolved template placeholders from record_stage arguments', () => {
    expect(
      normalizeRecordStageArgs({ ticketId: 't', stage: 'done', reason: '{{context.missing}}', advice: '{"options":[]}' }),
    ).toEqual({ ticketId: 't', stage: 'done', advice: { options: [] } })
  })

  it('builds a classify input that never names an unverified reservation', () => {
    const input = buildClassifyInput(
      { customer: { personId: null, match: 'not_found' }, reservation: { reservationId: null, bookingNumber: 'ABC123', match: 'identity_mismatch' } },
      complaintClassification,
      toArticlePolicy('complaints.service.hotel_service_complaint', 1, complaintSnapshot),
    )
    expect(input.reservationId).toBeNull()
    expect(input.reservationNumberSnapshot).toBeNull()
  })
})
