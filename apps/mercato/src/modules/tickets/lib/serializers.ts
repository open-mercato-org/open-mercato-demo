import { z } from 'zod'
import type { TicketArticle, TicketReplyDraft } from '../data/entities'

export const ticketArticleDtoSchema = z.object({
  id: z.string().uuid(),
  ticketId: z.string().uuid(),
  direction: z.string(),
  fromEmail: z.string().nullable(),
  toEmail: z.string().nullable(),
  subject: z.string().nullable(),
  bodyText: z.string(),
  bodyHtml: z.string().nullable(),
  messageId: z.string().nullable(),
  inReplyTo: z.string().nullable(),
  authorUserId: z.string().uuid().nullable(),
  sourceInboxEmailId: z.string().uuid().nullable(),
  deliveryStatus: z.string(),
  sentAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export type TicketArticleDto = z.infer<typeof ticketArticleDtoSchema>

export const ticketDraftDtoSchema = z.object({
  id: z.string().uuid(),
  ticketId: z.string().uuid(),
  subject: z.string().nullable(),
  body: z.string(),
  status: z.string(),
  sourceType: z.string().nullable(),
  sourceRef: z.string().nullable(),
  createdByUserId: z.string().uuid().nullable(),
  sentArticleId: z.string().uuid().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
})

export type TicketDraftDto = z.infer<typeof ticketDraftDtoSchema>

export function toIsoString(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  return null
}

export function serializeArticle(article: TicketArticle): TicketArticleDto {
  return {
    id: article.id,
    ticketId: article.ticketId,
    direction: article.direction,
    fromEmail: article.fromEmail ?? null,
    toEmail: article.toEmail ?? null,
    subject: article.subject ?? null,
    bodyText: article.bodyText,
    bodyHtml: article.bodyHtml ?? null,
    messageId: article.messageId ?? null,
    inReplyTo: article.inReplyTo ?? null,
    authorUserId: article.authorUserId ?? null,
    sourceInboxEmailId: article.sourceInboxEmailId ?? null,
    deliveryStatus: article.deliveryStatus,
    sentAt: toIsoString(article.sentAt),
    createdAt: toIsoString(article.createdAt),
    updatedAt: toIsoString(article.updatedAt),
  }
}

export function serializeDraft(draft: TicketReplyDraft): TicketDraftDto {
  return {
    id: draft.id,
    ticketId: draft.ticketId,
    subject: draft.subject ?? null,
    body: draft.body,
    status: draft.status,
    sourceType: draft.sourceType ?? null,
    sourceRef: draft.sourceRef ?? null,
    createdByUserId: draft.createdByUserId ?? null,
    sentArticleId: draft.sentArticleId ?? null,
    createdAt: toIsoString(draft.createdAt),
    updatedAt: toIsoString(draft.updatedAt),
  }
}

function readString(record: Record<string, unknown>, snakeKey: string, camelKey: string): string | null {
  const value = record[snakeKey] ?? record[camelKey]
  return typeof value === 'string' ? value : null
}

function readBoolean(record: Record<string, unknown>, snakeKey: string, camelKey: string): boolean {
  const value = record[snakeKey] ?? record[camelKey]
  return value === true || value === 'true' || value === 't'
}

export const ticketListItemSchema = z.object({
  id: z.string().uuid().nullable(),
  number: z.string().nullable(),
  subject: z.string().nullable(),
  channel: z.string().nullable(),
  queueKey: z.string().nullable(),
  status: z.string().nullable(),
  priority: z.string().nullable(),
  priorityReason: z.string().nullable(),
  requesterEmail: z.string().nullable(),
  requesterName: z.string().nullable(),
  customerPersonId: z.string().nullable(),
  reservationId: z.string().nullable(),
  reservationNumberSnapshot: z.string().nullable(),
  categoryKey: z.string().nullable(),
  subcategoryKey: z.string().nullable(),
  topicKey: z.string().nullable(),
  categoryPathSnapshot: z.string().nullable(),
  summary: z.string().nullable(),
  needsManualReview: z.boolean(),
  manualReviewReasonCode: z.string().nullable(),
  manualReviewReason: z.string().nullable(),
  classifiedAt: z.string().nullable(),
  classificationSource: z.string().nullable(),
  assigneeUserId: z.string().nullable(),
  lastInboundAt: z.string().nullable(),
  lastOutboundAt: z.string().nullable(),
  createdAt: z.string().nullable(),
  updatedAt: z.string().nullable(),
}).passthrough()

export type TicketListItem = z.infer<typeof ticketListItemSchema>

export function transformTicketListItem(item: unknown): unknown {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return item
  const record = item as Record<string, unknown>
  const extras: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(record)) {
    if (key.startsWith('_') || key.startsWith('cf_') || key.startsWith('cf:')) extras[key] = value
  }
  return {
    ...extras,
    id: readString(record, 'id', 'id'),
    number: readString(record, 'number', 'number'),
    subject: readString(record, 'subject', 'subject'),
    channel: readString(record, 'channel', 'channel'),
    queueKey: readString(record, 'queue_key', 'queueKey'),
    status: readString(record, 'status', 'status'),
    priority: readString(record, 'priority', 'priority'),
    priorityReason: readString(record, 'priority_reason', 'priorityReason'),
    requesterEmail: readString(record, 'requester_email', 'requesterEmail'),
    requesterName: readString(record, 'requester_name', 'requesterName'),
    customerPersonId: readString(record, 'customer_person_id', 'customerPersonId'),
    reservationId: readString(record, 'reservation_id', 'reservationId'),
    reservationNumberSnapshot: readString(record, 'reservation_number_snapshot', 'reservationNumberSnapshot'),
    categoryKey: readString(record, 'category_key', 'categoryKey'),
    subcategoryKey: readString(record, 'subcategory_key', 'subcategoryKey'),
    topicKey: readString(record, 'topic_key', 'topicKey'),
    categoryPathSnapshot: readString(record, 'category_path_snapshot', 'categoryPathSnapshot'),
    summary: readString(record, 'summary', 'summary'),
    needsManualReview: readBoolean(record, 'needs_manual_review', 'needsManualReview'),
    manualReviewReasonCode: readString(record, 'manual_review_reason_code', 'manualReviewReasonCode'),
    manualReviewReason: readString(record, 'manual_review_reason', 'manualReviewReason'),
    classifiedAt: toIsoString(record.classified_at ?? record.classifiedAt),
    classificationSource: readString(record, 'classification_source', 'classificationSource'),
    assigneeUserId: readString(record, 'assignee_user_id', 'assigneeUserId'),
    lastInboundAt: toIsoString(record.last_inbound_at ?? record.lastInboundAt),
    lastOutboundAt: toIsoString(record.last_outbound_at ?? record.lastOutboundAt),
    createdAt: toIsoString(record.created_at ?? record.createdAt),
    updatedAt: toIsoString(record.updated_at ?? record.updatedAt),
  }
}
