import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'tickets.ticket.created', label: 'Ticket Created', entity: 'ticket', category: 'crud', clientBroadcast: true },
  { id: 'tickets.ticket.updated', label: 'Ticket Updated', entity: 'ticket', category: 'crud', clientBroadcast: true, broadcastCoalescing: true },
  { id: 'tickets.ticket.deleted', label: 'Ticket Deleted', entity: 'ticket', category: 'crud', clientBroadcast: true },
  { id: 'tickets.ticket.classified', label: 'Ticket Classified', entity: 'ticket', category: 'lifecycle' },
  { id: 'tickets.ticket.status_changed', label: 'Ticket Status Changed', entity: 'ticket', category: 'lifecycle' },
  { id: 'tickets.ticket.manual_review_flagged', label: 'Ticket Flagged for Manual Review', entity: 'ticket', category: 'lifecycle' },
  { id: 'tickets.article.received', label: 'Ticket Article Received', entity: 'article', category: 'lifecycle', clientBroadcast: true },
  { id: 'tickets.reply.sent', label: 'Ticket Reply Sent', entity: 'reply', category: 'lifecycle', clientBroadcast: true },
  { id: 'tickets.reply_draft.saved', label: 'Ticket Reply Draft Saved', entity: 'reply_draft', category: 'lifecycle' },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'tickets',
  events,
})

export const emitTicketsEvent = eventsConfig.emit

export type TicketsEventId = typeof events[number]['id']

export default eventsConfig
