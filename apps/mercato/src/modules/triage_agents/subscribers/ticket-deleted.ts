import { cancelTriageForDeletedTicket, createProposalRejecter } from '../lib/ticketDeletion'
import { runTriageSync, type TriageSubscriberContext } from '../lib/subscriberSupport'

export const metadata = {
  event: 'tickets.ticket.deleted',
  persistent: true,
  id: 'triage_agents:ticket-deleted',
}

export type TicketDeletedPayload = { id?: unknown; ticketId?: unknown; tenantId?: unknown; organizationId?: unknown }

function readTicketId(payload: TicketDeletedPayload): string | null {
  const value = payload?.ticketId ?? payload?.id
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export default async function handle(payload: TicketDeletedPayload, ctx: TriageSubscriberContext): Promise<void> {
  const ticketId = readTicketId(payload)
  if (!ticketId) return
  await runTriageSync('ticket_deleted', payload, ctx, (em, scope) =>
    cancelTriageForDeletedTicket(em, scope, ticketId, createProposalRejecter(ctx.container ?? ctx, scope)),
  )
}
