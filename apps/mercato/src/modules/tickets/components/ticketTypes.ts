import type { StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import type { TicketPriority, TicketStatus } from '../data/constants'

export type TicketRow = {
  id: string
  number: string | null
  subject: string | null
  channel: string | null
  queueKey: string | null
  status: TicketStatus | null
  priority: TicketPriority | null
  priorityReason: string | null
  requesterEmail: string | null
  requesterName: string | null
  customerPersonId: string | null
  reservationId: string | null
  reservationNumberSnapshot: string | null
  categoryKey: string | null
  subcategoryKey: string | null
  topicKey: string | null
  categoryPathSnapshot: string | null
  summary: string | null
  needsManualReview: boolean
  manualReviewReasonCode: string | null
  manualReviewReason: string | null
  classifiedAt: string | null
  classificationSource: string | null
  assigneeUserId: string | null
  lastInboundAt: string | null
  lastOutboundAt: string | null
  createdAt: string | null
  updatedAt: string | null
} & Record<string, unknown>

export type TicketArticleRow = {
  id: string
  ticketId: string
  direction: 'inbound' | 'outbound' | 'internal_note'
  fromEmail: string | null
  toEmail: string | null
  subject: string | null
  bodyText: string
  bodyHtml: string | null
  messageId: string | null
  inReplyTo: string | null
  authorUserId: string | null
  deliveryStatus: string
  sentAt: string | null
  createdAt: string | null
}

export type TicketDraftRow = {
  id: string
  ticketId: string
  subject: string | null
  body: string
  status: string
  sourceType: string | null
  sourceRef: string | null
  createdByUserId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type TicketQueueOption = {
  value: string
  label: string
  color: string | null
}

export type PriorityBadgeStyle = {
  variant: StatusBadgeVariant
  appearance?: 'stroke'
}

export const PRIORITY_BADGE_STYLES: Record<TicketPriority, PriorityBadgeStyle> = {
  urgent: { variant: 'error' },
  high: { variant: 'warning' },
  normal: { variant: 'neutral' },
  low: { variant: 'neutral', appearance: 'stroke' },
}

export const STATUS_BADGE_VARIANTS: Record<TicketStatus, StatusBadgeVariant> = {
  new: 'info',
  open: 'info',
  pending_customer: 'neutral',
  pending_internal: 'warning',
  resolved: 'success',
  closed: 'neutral',
}

export const TICKET_LIST_PATH = '/backend/tickets'

export function ticketDetailPath(id: string): string {
  return `/backend/tickets/${encodeURIComponent(id)}`
}

export function ticketApiPath(id: string, suffix?: string): string {
  const base = `/api/tickets/tickets/${encodeURIComponent(id)}`
  return suffix ? `${base}/${suffix}` : base
}
