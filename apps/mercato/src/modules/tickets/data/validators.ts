import { z } from 'zod'
import {
  ARTICLE_DELIVERY_STATUSES,
  ARTICLE_DIRECTIONS,
  CLASSIFICATION_SOURCES,
  DRAFT_STATUSES,
  TICKET_BODY_MAX_LENGTH,
  TICKET_CHANNELS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  TICKET_SUBJECT_MAX_LENGTH,
} from './constants'

export const ticketStatusSchema = z.enum(TICKET_STATUSES)
export const ticketPrioritySchema = z.enum(TICKET_PRIORITIES)
export const ticketChannelSchema = z.enum(TICKET_CHANNELS)
export const articleDirectionSchema = z.enum(ARTICLE_DIRECTIONS)
export const articleDeliveryStatusSchema = z.enum(ARTICLE_DELIVERY_STATUSES)
export const draftStatusSchema = z.enum(DRAFT_STATUSES)
export const classificationSourceSchema = z.enum(CLASSIFICATION_SOURCES)

const uuid = z.string().uuid()
const scopeShape = {
  tenantId: uuid.optional(),
  organizationId: uuid.optional(),
}

const subjectSchema = z.string().trim().min(1).max(TICKET_SUBJECT_MAX_LENGTH)
const bodySchema = z.string().trim().min(1).max(TICKET_BODY_MAX_LENGTH)
const emailSchema = z.string().trim().toLowerCase().email().max(320)
const keySchema = z.string().trim().min(1).max(200)
const queueKeySchema = z.string().trim().min(1).max(100)
const messageIdSchema = z.string().trim().min(1).max(998)

export const inboundArticleInputSchema = z.object({
  fromEmail: emailSchema,
  fromName: z.string().trim().max(300).nullable().optional(),
  toEmail: z.string().trim().max(320).nullable().optional(),
  subject: z.string().trim().max(TICKET_SUBJECT_MAX_LENGTH).nullable().optional(),
  bodyText: z.string().max(TICKET_BODY_MAX_LENGTH),
  bodyHtml: z.string().max(TICKET_BODY_MAX_LENGTH * 4).nullable().optional(),
  messageId: messageIdSchema.nullable().optional(),
  inReplyTo: messageIdSchema.nullable().optional(),
  sourceInboxEmailId: uuid.nullable().optional(),
  receivedAt: z.coerce.date().nullable().optional(),
})

export type InboundArticleInput = z.infer<typeof inboundArticleInputSchema>

export const ticketCreateSchema = z.object({
  ...scopeShape,
  id: uuid.optional(),
  subject: subjectSchema,
  channel: ticketChannelSchema.default('manual'),
  queueKey: queueKeySchema.optional(),
  priority: ticketPrioritySchema.optional(),
  requesterEmail: emailSchema,
  requesterName: z.string().trim().max(300).nullable().optional(),
  customerPersonId: uuid.nullable().optional(),
  reservationId: uuid.nullable().optional(),
  assigneeUserId: uuid.nullable().optional(),
  initialMessage: z.string().max(TICKET_BODY_MAX_LENGTH).nullable().optional(),
  initialArticle: inboundArticleInputSchema.nullable().optional(),
})

export type TicketCreateInput = z.input<typeof ticketCreateSchema>
export type TicketCreateParsed = z.infer<typeof ticketCreateSchema>

export const ticketUpdateSchema = z.object({
  ...scopeShape,
  id: uuid,
  subject: subjectSchema.optional(),
  queueKey: queueKeySchema.optional(),
  assigneeUserId: uuid.nullable().optional(),
})

export type TicketUpdateInput = z.infer<typeof ticketUpdateSchema>

export const ticketDeleteSchema = z.object({
  ...scopeShape,
  id: uuid,
})

export type TicketDeleteInput = z.infer<typeof ticketDeleteSchema>

export const ticketClassifySchema = z.object({
  ...scopeShape,
  id: uuid,
  customerPersonId: uuid.nullable().optional(),
  reservationId: uuid.nullable().optional(),
  reservationNumberSnapshot: z.string().trim().max(100).nullable().optional(),
  categoryKey: keySchema.nullable().optional(),
  subcategoryKey: keySchema.nullable().optional(),
  topicKey: keySchema.nullable().optional(),
  categoryPathSnapshot: z.string().trim().max(500).nullable().optional(),
  priority: ticketPrioritySchema.optional(),
  priorityReason: z.string().trim().max(200).nullable().optional(),
  summary: z.string().trim().max(10_000).nullable().optional(),
  source: classificationSourceSchema.default('manual'),
  force: z.boolean().optional(),
})

export type TicketClassifyInput = z.input<typeof ticketClassifySchema>
export type TicketClassifyParsed = z.infer<typeof ticketClassifySchema>

export const ticketFlagManualReviewSchema = z
  .object({
    ...scopeShape,
    id: uuid,
    reason: z.string().trim().min(1).max(2000).optional(),
    reasonCode: z.string().trim().min(1).max(100).optional(),
    targetQueueKey: queueKeySchema.optional(),
    clear: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.clear) return
    if (!value.reason) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reason'], message: 'tickets.errors.reasonRequired' })
    if (!value.reasonCode) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['reasonCode'], message: 'tickets.errors.reasonCodeRequired' })
  })

export type TicketFlagManualReviewInput = z.infer<typeof ticketFlagManualReviewSchema>

export const ticketTransitionSchema = z.object({
  ...scopeShape,
  id: uuid,
  to: ticketStatusSchema,
  note: z.string().trim().max(TICKET_BODY_MAX_LENGTH).optional(),
})

export type TicketTransitionInput = z.infer<typeof ticketTransitionSchema>

export const replyDraftSaveSchema = z.object({
  ...scopeShape,
  ticketId: uuid,
  draftId: uuid.optional(),
  body: bodySchema,
  subject: z.string().trim().max(TICKET_SUBJECT_MAX_LENGTH).nullable().optional(),
  sourceType: z.string().trim().min(1).max(50).nullable().optional(),
  sourceRef: z.string().trim().min(1).max(200).nullable().optional(),
  expectedUpdatedAt: z.string().min(1).optional(),
})

export type ReplyDraftSaveInput = z.infer<typeof replyDraftSaveSchema>

export const replySendSchema = z
  .object({
    ...scopeShape,
    ticketId: uuid,
    draftId: uuid.optional(),
    body: bodySchema.optional(),
    subject: z.string().trim().max(TICKET_SUBJECT_MAX_LENGTH).nullable().optional(),
    resolveAfterSend: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (!value.draftId && !value.body) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['body'], message: 'tickets.errors.replyBodyRequired' })
    }
  })

export type ReplySendInput = z.infer<typeof replySendSchema>

export const addNoteSchema = z.object({
  ...scopeShape,
  ticketId: uuid,
  body: bodySchema,
})

export type AddNoteInput = z.infer<typeof addNoteSchema>

export const receiveArticleSchema = z.object({
  ...scopeShape,
  ticketId: uuid,
  article: inboundArticleInputSchema,
})

export type ReceiveArticleInput = z.infer<typeof receiveArticleSchema>

export const simulateIntakeSchema = z.object({
  fromEmail: emailSchema,
  fromName: z.string().trim().max(300).optional(),
  subject: subjectSchema,
  body: z.string().trim().min(1).max(TICKET_BODY_MAX_LENGTH),
  inReplyTo: messageIdSchema.optional(),
  messageId: messageIdSchema.optional(),
  receivedAt: z.coerce.date().optional(),
})

export type SimulateIntakeInput = z.infer<typeof simulateIntakeSchema>
