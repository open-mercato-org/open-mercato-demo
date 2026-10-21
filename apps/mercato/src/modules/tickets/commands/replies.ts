import { randomUUID } from 'crypto'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveDefaultEmailFromAddress } from '@open-mercato/shared/lib/email/config'
import { Ticket, TicketArticle, TicketReplyDraft } from '../data/entities'
import { TICKET_RESOURCE_KIND, type ArticleDeliveryStatus, type TicketStatus } from '../data/constants'
import { replySendSchema, type ReplySendInput } from '../data/validators'
import { resolveTransitionPath } from '../lib/stateMachine'
import { appendTicketNumberToken, buildReplySubject } from '../lib/threadMatcher'
import { deliverTicketReply } from '../lib/delivery'
import { emitTicketsEvent } from '../events'
import {
  actorUserId,
  emitStatusChanged,
  emitTicketCrud,
  parseCommandInput,
  requireTicket,
  resolveEm,
  resolveScope,
  ticketEmitOptions,
  ticketEventPayload,
  type TicketScope,
} from './shared'

export type ReplySendResult = {
  ticketId: string
  articleId: string
  draftId: string | null
  deliveryStatus: ArticleDeliveryStatus
  alreadySent: boolean
  status: TicketStatus
}

type PreparedSend = {
  ticket: Ticket
  article: TicketArticle | null
  existingArticleId: string | null
  draftId: string | null
  fromStatus: TicketStatus
  toStatus: TicketStatus
}

export function resolveReplyTargetStatus(current: TicketStatus, resolveAfterSend: boolean): TicketStatus {
  const target: TicketStatus = resolveAfterSend ? 'resolved' : 'pending_customer'
  const path = resolveTransitionPath(current, target)
  if (path === null) throw new CrudHttpError(409, { error: 'tickets.errors.invalidTransition', from: current, to: target })
  return target
}

export function buildOutboundMessageId(articleId: string): string {
  return `<${articleId}.tickets@open-mercato.local>`
}

async function findLatestInboundMessageId(
  em: EntityManager,
  ticketId: string,
  scope: TicketScope,
): Promise<string | null> {
  const articles = await findWithDecryption(
    em,
    TicketArticle,
    { ticketId, tenantId: scope.tenantId, organizationId: scope.organizationId, direction: 'inbound', deletedAt: null },
    { orderBy: { createdAt: 'desc' }, limit: 1 },
    scope,
  )
  return articles[0]?.messageId ?? null
}

async function prepareSend(
  em: EntityManager,
  input: ReplySendInput,
  scope: TicketScope,
  authorUserId: string | null,
): Promise<PreparedSend> {
  return em.transactional(async (tem) => {
    const ticket = await findOneWithDecryption(
      tem,
      Ticket,
      { id: input.ticketId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
      scope,
    )
    if (!ticket) throw new CrudHttpError(404, { error: 'tickets.errors.notFound' })
    let draft: TicketReplyDraft | null = null
    if (input.draftId) {
      draft = await findOneWithDecryption(
        tem,
        TicketReplyDraft,
        { id: input.draftId, ticketId: ticket.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      )
      if (!draft) throw new CrudHttpError(404, { error: 'tickets.errors.draftNotFound' })
      if (draft.status === 'sent' && draft.sentArticleId) {
        return {
          ticket,
          article: null,
          existingArticleId: draft.sentArticleId,
          draftId: draft.id,
          fromStatus: ticket.status,
          toStatus: ticket.status,
        }
      }
      if (draft.status !== 'draft') throw new CrudHttpError(409, { error: 'tickets.errors.draftNotEditable' })
    }
    if (ticket.status === 'closed') throw new CrudHttpError(409, { error: 'tickets.errors.ticketClosed' })
    const fromStatus = ticket.status
    const toStatus = resolveReplyTargetStatus(fromStatus, input.resolveAfterSend === true)
    const body = (input.body ?? draft?.body ?? '').trim()
    if (!body) throw new CrudHttpError(400, { error: 'tickets.errors.replyBodyRequired' })
    const requestedSubject = input.subject ?? draft?.subject ?? null
    const subject = requestedSubject && requestedSubject.trim()
      ? appendTicketNumberToken(requestedSubject, ticket.number)
      : buildReplySubject(ticket.subject, ticket.number)
    const inReplyTo = await findLatestInboundMessageId(tem, ticket.id, scope)
    const now = new Date()
    const articleId = randomUUID()
    const article = tem.create(TicketArticle, {
      id: articleId,
      tenantId: ticket.tenantId,
      organizationId: ticket.organizationId,
      ticketId: ticket.id,
      direction: 'outbound',
      fromEmail: resolveDefaultEmailFromAddress() ?? null,
      toEmail: ticket.requesterEmail,
      subject,
      bodyText: body,
      bodyHtml: null,
      messageId: buildOutboundMessageId(articleId),
      inReplyTo,
      authorUserId,
      sourceInboxEmailId: null,
      deliveryStatus: 'queued',
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    })
    tem.persist(article)
    if (draft) {
      draft.status = 'sent'
      draft.sentArticleId = articleId
      draft.updatedAt = now
    }
    ticket.status = toStatus
    ticket.lastOutboundAt = now
    ticket.updatedAt = now
    await tem.flush()
    return { ticket, article, existingArticleId: null, draftId: draft?.id ?? null, fromStatus, toStatus }
  })
}

async function loadArticle(em: EntityManager, articleId: string, scope: TicketScope): Promise<TicketArticle | null> {
  return findOneWithDecryption(
    em,
    TicketArticle,
    { id: articleId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    scope,
  )
}

const sendReplyCommand: CommandHandler<unknown, ReplySendResult> = {
  id: 'tickets.reply.send',
  isUndoable: false,
  async execute(rawInput, ctx) {
    const parsed = parseCommandInput(replySendSchema, rawInput)
    const scope = resolveScope(ctx, parsed)
    const em = resolveEm(ctx)
    await requireTicket(em, parsed.ticketId, scope)
    const prepared = await prepareSend(em, parsed, scope, actorUserId(ctx))
    const { ticket } = prepared
    if (!prepared.article) {
      const existing = prepared.existingArticleId ? await loadArticle(resolveEm(ctx), prepared.existingArticleId, scope) : null
      return {
        ticketId: ticket.id,
        articleId: prepared.existingArticleId ?? '',
        draftId: prepared.draftId,
        deliveryStatus: existing?.deliveryStatus ?? 'queued',
        alreadySent: true,
        status: ticket.status,
      }
    }
    const article = prepared.article
    const delivery = await deliverTicketReply({
      to: ticket.requesterEmail,
      subject: article.subject ?? ticket.subject,
      text: article.bodyText,
      tenantId: ticket.tenantId,
      organizationId: ticket.organizationId,
    })
    const deliveryEm = resolveEm(ctx)
    const stored = await loadArticle(deliveryEm, article.id, scope)
    if (stored) {
      await withAtomicFlush(deliveryEm, [
        () => {
          stored.deliveryStatus = delivery.status
          stored.sentAt = delivery.sentAt
          stored.updatedAt = new Date()
        },
      ], { transaction: true, label: 'tickets.reply.send.delivery' })
    }
    await emitTicketCrud(ctx, 'updated', ticket)
    await emitTicketsEvent('tickets.reply.sent', {
      ...ticketEventPayload(ticket),
      articleId: article.id,
      draftId: prepared.draftId,
      deliveryStatus: delivery.status,
    }, ticketEmitOptions(ticket))
    await emitStatusChanged(ticket, prepared.fromStatus, prepared.toStatus)
    return {
      ticketId: ticket.id,
      articleId: article.id,
      draftId: prepared.draftId,
      deliveryStatus: delivery.status,
      alreadySent: false,
      status: ticket.status,
    }
  },
  buildLog: ({ result }) => ({
    actionLabel: 'tickets.audit.reply.send',
    resourceKind: TICKET_RESOURCE_KIND,
    resourceId: result.ticketId,
    relatedResourceKind: 'tickets.ticket_article',
    relatedResourceId: result.articleId || null,
    context: { deliveryStatus: result.deliveryStatus, alreadySent: result.alreadySent, draftId: result.draftId },
  }),
}

registerCommand(sendReplyCommand)
