/** @jest-environment node */
import type { Ticket } from '../data/entities'
import { ticketClassifySchema } from '../data/validators'
import { applyClassification, assertClassificationWritable, classificationView } from '../lib/classification'

const TICKET_ID = '11111111-1111-4111-8111-111111111111'

function baseTicket(): Ticket {
  return {
    priority: 'normal',
    priorityRank: 2,
    priorityReason: null,
    customerPersonId: null,
    reservationId: null,
    reservationNumberSnapshot: null,
    categoryKey: 'old',
    subcategoryKey: null,
    topicKey: null,
    categoryPathSnapshot: null,
    summary: 'old summary',
    classifiedAt: null,
    classificationSource: null,
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  } as unknown as Ticket
}

describe('ticket classification rules', () => {
  it('lets a workflow classify an unclassified or workflow-classified ticket', () => {
    expect(() => assertClassificationWritable({ classificationSource: null }, { source: 'workflow' })).not.toThrow()
    expect(() => assertClassificationWritable({ classificationSource: 'workflow' }, { source: 'workflow' })).not.toThrow()
  })

  it('blocks a workflow from overwriting a manual classification unless forced', () => {
    expect(() => assertClassificationWritable({ classificationSource: 'manual' }, { source: 'workflow' })).toThrow()
    expect(() => assertClassificationWritable({ classificationSource: 'manual' }, { source: 'workflow', force: true })).not.toThrow()
    expect(() => assertClassificationWritable({ classificationSource: 'manual' }, { source: 'manual' })).not.toThrow()
  })

  it('applies only the provided keys and records source + rank', () => {
    const ticket = baseTicket()
    const now = new Date('2026-10-12T10:00:00Z')
    const input = ticketClassifySchema.parse({
      id: TICKET_ID,
      topicKey: 'payments.refunds.overpayment_refund',
      priority: 'high',
      priorityReason: 'departure in 3 days',
      summary: null,
      source: 'workflow',
    })
    applyClassification(ticket, input, now)
    expect(ticket.topicKey).toBe('payments.refunds.overpayment_refund')
    expect(ticket.categoryKey).toBe('old')
    expect(ticket.summary).toBeNull()
    expect(ticket.priority).toBe('high')
    expect(ticket.priorityRank).toBe(3)
    expect(ticket.classificationSource).toBe('workflow')
    expect(ticket.classifiedAt).toBe(now)
    expect(classificationView(ticket)).toEqual(expect.objectContaining({
      topicKey: 'payments.refunds.overpayment_refund',
      priority: 'high',
      classificationSource: 'workflow',
    }))
  })

  it('defaults the classification source to manual', () => {
    expect(ticketClassifySchema.parse({ id: TICKET_ID }).source).toBe('manual')
  })
})
