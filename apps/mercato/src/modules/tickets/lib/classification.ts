import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { Ticket } from '../data/entities'
import { TICKET_PRIORITY_RANK, type TicketPriority } from '../data/constants'
import type { TicketClassifyParsed } from '../data/validators'

export type ClassificationView = {
  customerPersonId: string | null
  reservationId: string | null
  reservationNumberSnapshot: string | null
  categoryKey: string | null
  subcategoryKey: string | null
  topicKey: string | null
  categoryPathSnapshot: string | null
  priority: TicketPriority
  priorityReason: string | null
  classificationSource: string | null
}

type ClassifiableTicket = Pick<
  Ticket,
  | 'customerPersonId'
  | 'reservationId'
  | 'reservationNumberSnapshot'
  | 'categoryKey'
  | 'subcategoryKey'
  | 'topicKey'
  | 'categoryPathSnapshot'
  | 'priority'
  | 'priorityRank'
  | 'priorityReason'
  | 'summary'
  | 'classifiedAt'
  | 'classificationSource'
  | 'updatedAt'
>

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

export function assertClassificationWritable(
  current: Pick<Ticket, 'classificationSource'>,
  input: Pick<TicketClassifyParsed, 'source' | 'force'>,
): void {
  if (input.source !== 'workflow') return
  if (current.classificationSource !== 'manual') return
  if (input.force === true) return
  throw new CrudHttpError(409, { error: 'tickets.errors.manualClassificationLocked', code: 'manual_classification_locked' })
}

export function classificationView(ticket: ClassifiableTicket): ClassificationView {
  return {
    customerPersonId: ticket.customerPersonId ?? null,
    reservationId: ticket.reservationId ?? null,
    reservationNumberSnapshot: ticket.reservationNumberSnapshot ?? null,
    categoryKey: ticket.categoryKey ?? null,
    subcategoryKey: ticket.subcategoryKey ?? null,
    topicKey: ticket.topicKey ?? null,
    categoryPathSnapshot: ticket.categoryPathSnapshot ?? null,
    priority: ticket.priority,
    priorityReason: ticket.priorityReason ?? null,
    classificationSource: ticket.classificationSource ?? null,
  }
}

export function applyClassification(ticket: ClassifiableTicket, input: TicketClassifyParsed, now: Date): void {
  if (hasOwn(input, 'customerPersonId')) ticket.customerPersonId = input.customerPersonId ?? null
  if (hasOwn(input, 'reservationId')) ticket.reservationId = input.reservationId ?? null
  if (hasOwn(input, 'reservationNumberSnapshot')) ticket.reservationNumberSnapshot = input.reservationNumberSnapshot ?? null
  if (hasOwn(input, 'categoryKey')) ticket.categoryKey = input.categoryKey ?? null
  if (hasOwn(input, 'subcategoryKey')) ticket.subcategoryKey = input.subcategoryKey ?? null
  if (hasOwn(input, 'topicKey')) ticket.topicKey = input.topicKey ?? null
  if (hasOwn(input, 'categoryPathSnapshot')) ticket.categoryPathSnapshot = input.categoryPathSnapshot ?? null
  if (input.priority) {
    ticket.priority = input.priority
    ticket.priorityRank = TICKET_PRIORITY_RANK[input.priority]
  }
  if (hasOwn(input, 'priorityReason')) ticket.priorityReason = input.priorityReason ?? null
  if (hasOwn(input, 'summary')) ticket.summary = input.summary ?? null
  ticket.classifiedAt = now
  ticket.classificationSource = input.source
  ticket.updatedAt = now
}
