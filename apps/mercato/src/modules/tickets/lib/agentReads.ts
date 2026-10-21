import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { Ticket, TicketArticle } from '../data/entities'
import { ticketStatusSchema } from '../data/validators'
import { stripQuotedHistory, trimText } from './text'
import { toIsoString } from './serializers'

export const AGENT_ARTICLE_BODY_LIMIT = 4000
export const AGENT_ARTICLE_DEFAULT_LIMIT = 10
export const AGENT_ARTICLE_MAX_LIMIT = 20
export const AGENT_LIST_MAX_LIMIT = 10

export type AgentScope = {
  tenantId: string
  organizationId: string
}

export const getTicketInputSchema = z.object({
  ticketId: z.string().uuid(),
  articleLimit: z.number().int().min(1).max(AGENT_ARTICLE_MAX_LIMIT).optional(),
})

export type GetTicketInput = z.infer<typeof getTicketInputSchema>

export const listTicketsInputSchema = z
  .object({
    customerPersonId: z.string().uuid().optional(),
    requesterEmail: z.string().trim().email().optional(),
    statuses: z.array(ticketStatusSchema).min(1).max(6).optional(),
    excludeTicketId: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(AGENT_LIST_MAX_LIMIT).optional(),
  })
  .refine((value) => Boolean(value.customerPersonId || value.requesterEmail), {
    message: 'Provide customerPersonId or requesterEmail',
    path: ['customerPersonId'],
  })

export type ListTicketsInput = z.infer<typeof listTicketsInputSchema>

export type AgentTicketSummary = {
  id: string
  number: string
  subject: string
  status: string
  priority: string
  priorityReason: string | null
  queueKey: string
  channel: string
  requesterEmail: string
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
  classificationSource: string | null
  classifiedAt: string | null
  lastInboundAt: string | null
  lastOutboundAt: string | null
  createdAt: string | null
}

export type AgentArticle = {
  id: string
  direction: string
  fromEmail: string | null
  toEmail: string | null
  subject: string | null
  body: string
  bodyTruncated: boolean
  deliveryStatus: string
  createdAt: string | null
}

export type AgentTicketDetail = {
  ticket: AgentTicketSummary
  articles: AgentArticle[]
  articleCount: number
}

export function summarizeTicket(ticket: Ticket): AgentTicketSummary {
  return {
    id: ticket.id,
    number: ticket.number,
    subject: ticket.subject,
    status: ticket.status,
    priority: ticket.priority,
    priorityReason: ticket.priorityReason ?? null,
    queueKey: ticket.queueKey,
    channel: ticket.channel,
    requesterEmail: ticket.requesterEmail,
    requesterName: ticket.requesterName ?? null,
    customerPersonId: ticket.customerPersonId ?? null,
    reservationId: ticket.reservationId ?? null,
    reservationNumberSnapshot: ticket.reservationNumberSnapshot ?? null,
    categoryKey: ticket.categoryKey ?? null,
    subcategoryKey: ticket.subcategoryKey ?? null,
    topicKey: ticket.topicKey ?? null,
    categoryPathSnapshot: ticket.categoryPathSnapshot ?? null,
    summary: ticket.summary ?? null,
    needsManualReview: ticket.needsManualReview === true,
    manualReviewReasonCode: ticket.manualReviewReasonCode ?? null,
    manualReviewReason: ticket.manualReviewReason ?? null,
    classificationSource: ticket.classificationSource ?? null,
    classifiedAt: toIsoString(ticket.classifiedAt),
    lastInboundAt: toIsoString(ticket.lastInboundAt),
    lastOutboundAt: toIsoString(ticket.lastOutboundAt),
    createdAt: toIsoString(ticket.createdAt),
  }
}

export function toAgentArticle(article: TicketArticle): AgentArticle {
  const cleaned = article.direction === 'inbound' ? stripQuotedHistory(article.bodyText ?? '') : (article.bodyText ?? '').trim()
  const trimmed = trimText(cleaned, AGENT_ARTICLE_BODY_LIMIT)
  return {
    id: article.id,
    direction: article.direction,
    fromEmail: article.fromEmail ?? null,
    toEmail: article.toEmail ?? null,
    subject: article.subject ?? null,
    body: trimmed.text,
    bodyTruncated: trimmed.truncated,
    deliveryStatus: article.deliveryStatus,
    createdAt: toIsoString(article.createdAt),
  }
}

export async function readTicketForAgent(
  em: EntityManager,
  scope: AgentScope,
  input: GetTicketInput,
): Promise<AgentTicketDetail | null> {
  const ticket = await findOneWithDecryption(
    em,
    Ticket,
    { id: input.ticketId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    scope,
  )
  if (!ticket) return null
  const limit = input.articleLimit ?? AGENT_ARTICLE_DEFAULT_LIMIT
  const newestFirst = await findWithDecryption(
    em,
    TicketArticle,
    { ticketId: ticket.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    { orderBy: { createdAt: 'desc' }, limit },
    scope,
  )
  const articleCount = await em.count(TicketArticle, {
    ticketId: ticket.id,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  })
  return {
    ticket: summarizeTicket(ticket),
    articles: [...newestFirst].reverse().map(toAgentArticle),
    articleCount,
  }
}

export async function listTicketsForAgent(
  em: EntityManager,
  scope: AgentScope,
  input: ListTicketsInput,
): Promise<AgentTicketSummary[]> {
  const ownership: Array<Record<string, unknown>> = []
  if (input.customerPersonId) ownership.push({ customerPersonId: input.customerPersonId })
  if (input.requesterEmail) ownership.push({ requesterEmailHash: { $in: lookupHashCandidates(input.requesterEmail) } })
  const where: Record<string, unknown> = {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
    $or: ownership,
  }
  if (input.statuses?.length) where.status = { $in: input.statuses }
  if (input.excludeTicketId) where.id = { $ne: input.excludeTicketId }
  const tickets = await findWithDecryption(
    em,
    Ticket,
    where,
    { orderBy: { createdAt: 'desc' }, limit: input.limit ?? AGENT_LIST_MAX_LIMIT },
    scope,
  )
  return tickets.map(summarizeTicket)
}
