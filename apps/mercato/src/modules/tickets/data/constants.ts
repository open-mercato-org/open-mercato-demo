export const TICKET_STATUSES = [
  'new',
  'open',
  'pending_customer',
  'pending_internal',
  'resolved',
  'closed',
] as const

export type TicketStatus = (typeof TICKET_STATUSES)[number]

export const TICKET_STATUS_TRANSITIONS: Record<TicketStatus, readonly TicketStatus[]> = {
  new: ['open', 'resolved'],
  open: ['pending_customer', 'pending_internal', 'resolved'],
  pending_customer: ['open'],
  pending_internal: ['open'],
  resolved: ['open', 'closed'],
  closed: [],
}

export const TICKET_PRIORITIES = ['low', 'normal', 'high', 'urgent'] as const

export type TicketPriority = (typeof TICKET_PRIORITIES)[number]

export const TICKET_PRIORITY_RANK: Record<TicketPriority, number> = {
  low: 1,
  normal: 2,
  high: 3,
  urgent: 4,
}

export const TICKET_CHANNELS = ['email', 'manual', 'api'] as const

export type TicketChannel = (typeof TICKET_CHANNELS)[number]

export const ARTICLE_DIRECTIONS = ['inbound', 'outbound', 'internal_note'] as const

export type ArticleDirection = (typeof ARTICLE_DIRECTIONS)[number]

export const ARTICLE_DELIVERY_STATUSES = ['received', 'queued', 'sent', 'simulated', 'failed'] as const

export type ArticleDeliveryStatus = (typeof ARTICLE_DELIVERY_STATUSES)[number]

export const DRAFT_STATUSES = ['draft', 'sent', 'discarded'] as const

export type DraftStatus = (typeof DRAFT_STATUSES)[number]

export const CLASSIFICATION_SOURCES = ['manual', 'workflow'] as const

export type ClassificationSource = (typeof CLASSIFICATION_SOURCES)[number]

export const DEFAULT_QUEUE_KEY = 'general'

export const TICKET_QUEUE_DICTIONARY_KEY = 'tickets.queue'

export const TICKET_NUMBER_PREFIX = 'TCK'

export const TICKET_ENTITY_ID = 'tickets:ticket'
export const TICKET_ARTICLE_ENTITY_ID = 'tickets:ticket_article'
export const TICKET_REPLY_DRAFT_ENTITY_ID = 'tickets:ticket_reply_draft'

export const TICKET_RESOURCE_KIND = 'tickets.ticket'
export const TICKET_ARTICLE_RESOURCE_KIND = 'tickets.ticket_article'
export const TICKET_REPLY_DRAFT_RESOURCE_KIND = 'tickets.ticket_reply_draft'

export const TICKET_SUBJECT_MAX_LENGTH = 500
export const TICKET_BODY_MAX_LENGTH = 100_000
