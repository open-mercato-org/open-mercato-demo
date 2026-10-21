import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { TICKET_STATUS_TRANSITIONS, type TicketStatus } from '../data/constants'

export function nextStatuses(status: TicketStatus): TicketStatus[] {
  return [...(TICKET_STATUS_TRANSITIONS[status] ?? [])]
}

export function canTransition(from: TicketStatus, to: TicketStatus): boolean {
  return nextStatuses(from).includes(to)
}

export function assertTransition(from: TicketStatus, to: TicketStatus): void {
  if (canTransition(from, to)) return
  throw new CrudHttpError(400, { error: 'tickets.errors.invalidTransition', from, to })
}

export function resolveTransitionPath(from: TicketStatus, to: TicketStatus): TicketStatus[] | null {
  if (from === to) return []
  if (canTransition(from, to)) return [to]
  for (const intermediate of nextStatuses(from)) {
    if (canTransition(intermediate, to)) return [intermediate, to]
  }
  return null
}

export function isTerminalStatus(status: TicketStatus): boolean {
  return nextStatuses(status).length === 0
}

export function statusAfterInbound(status: TicketStatus): TicketStatus {
  if (status === 'pending_customer' || status === 'resolved') return 'open'
  return status
}
