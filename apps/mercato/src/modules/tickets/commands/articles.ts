import { randomUUID } from 'crypto'
import { registerCommand, type CommandHandler } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { TicketArticle } from '../data/entities'
import { TICKET_ARTICLE_RESOURCE_KIND } from '../data/constants'
import { addNoteSchema, receiveArticleSchema } from '../data/validators'
import { statusAfterInbound } from '../lib/stateMachine'
import { normalizeMessageId } from '../lib/threadMatcher'
import { emitTicketsEvent } from '../events'
import {
  actorUserId,
  emitStatusChanged,
  emitTicketCrud,
  extractUndoPayload,
  parseCommandInput,
  requireTicket,
  resolveEm,
  resolveScope,
  resolveUndoScope,
  ticketEmitOptions,
  ticketEventPayload,
} from './shared'

type NoteSnapshot = {
  id: string
  ticketId: string
  tenantId: string
  organizationId: string
}

type NoteUndoPayload = {
  after?: NoteSnapshot | null
}

export type AddNoteResult = { ticketId: string; articleId: string }
export type ReceiveArticleResult = { ticketId: string; articleId: string; reopened: boolean }

const addNoteCommand: CommandHandler<unknown, AddNoteResult> = {
  id: 'tickets.article.add_note',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = parseCommandInput(addNoteSchema, rawInput)
    const scope = resolveScope(ctx, parsed)
    const em = resolveEm(ctx)
    const ticket = await requireTicket(em, parsed.ticketId, scope)
    const articleId = randomUUID()
    await withAtomicFlush(em, [
      () => {
        const now = new Date()
        em.persist(em.create(TicketArticle, {
          id: articleId,
          tenantId: ticket.tenantId,
          organizationId: ticket.organizationId,
          ticketId: ticket.id,
          direction: 'internal_note',
          fromEmail: null,
          toEmail: null,
          subject: null,
          bodyText: parsed.body,
          bodyHtml: null,
          messageId: null,
          inReplyTo: null,
          authorUserId: actorUserId(ctx),
          sourceInboxEmailId: null,
          deliveryStatus: 'received',
          sentAt: null,
          createdAt: now,
          updatedAt: now,
        }))
        ticket.updatedAt = now
      },
    ], { transaction: true, label: 'tickets.article.add_note' })
    await emitTicketCrud(ctx, 'updated', ticket)
    return { ticketId: ticket.id, articleId }
  },
  buildLog: ({ result, ctx }) => {
    const scope = resolveScope(ctx, {})
    const after: NoteSnapshot = {
      id: result.articleId,
      ticketId: result.ticketId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    }
    const payload: { undo: NoteUndoPayload } = { undo: { after } }
    return {
      actionLabel: 'tickets.audit.article.addNote',
      resourceKind: TICKET_ARTICLE_RESOURCE_KIND,
      resourceId: result.articleId,
      parentResourceKind: 'tickets.ticket',
      parentResourceId: result.ticketId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      snapshotAfter: after,
      payload,
    }
  },
  async undo({ logEntry, ctx }) {
    const after = extractUndoPayload<NoteUndoPayload>(logEntry)?.after
    if (!after) return
    const scope = resolveUndoScope(ctx, after)
    const em = resolveEm(ctx)
    const article = await findOneWithDecryption(
      em,
      TicketArticle,
      { id: after.id, ticketId: after.ticketId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      {},
      scope,
    )
    if (!article) return
    await withAtomicFlush(em, [
      () => {
        article.deletedAt = new Date()
      },
    ], { transaction: true, label: 'tickets.article.add_note.undo' })
  },
}

const receiveArticleCommand: CommandHandler<unknown, ReceiveArticleResult> = {
  id: 'tickets.article.receive',
  async execute(rawInput, ctx) {
    const parsed = parseCommandInput(receiveArticleSchema, rawInput)
    const scope = resolveScope(ctx, parsed)
    const em = resolveEm(ctx)
    const ticket = await requireTicket(em, parsed.ticketId, scope)
    if (ticket.status === 'closed') {
      throw new CrudHttpError(409, { error: 'tickets.errors.ticketClosed' })
    }
    const fromStatus = ticket.status
    const toStatus = statusAfterInbound(fromStatus)
    const articleId = randomUUID()
    const article = parsed.article
    const receivedAt = article.receivedAt ?? new Date()
    await withAtomicFlush(em, [
      () => {
        const now = new Date()
        em.persist(em.create(TicketArticle, {
          id: articleId,
          tenantId: ticket.tenantId,
          organizationId: ticket.organizationId,
          ticketId: ticket.id,
          direction: 'inbound',
          fromEmail: article.fromEmail,
          toEmail: article.toEmail ?? null,
          subject: article.subject ?? null,
          bodyText: article.bodyText,
          bodyHtml: article.bodyHtml ?? null,
          messageId: normalizeMessageId(article.messageId),
          inReplyTo: normalizeMessageId(article.inReplyTo),
          authorUserId: null,
          sourceInboxEmailId: article.sourceInboxEmailId ?? null,
          deliveryStatus: 'received',
          sentAt: null,
          createdAt: receivedAt,
          updatedAt: now,
        }))
        ticket.status = toStatus
        ticket.lastInboundAt = receivedAt
        ticket.updatedAt = now
      },
    ], { transaction: true, label: 'tickets.article.receive' })
    await emitTicketCrud(ctx, 'updated', ticket)
    await emitTicketsEvent('tickets.article.received', {
      ...ticketEventPayload(ticket),
      articleId,
    }, ticketEmitOptions(ticket))
    await emitStatusChanged(ticket, fromStatus, toStatus)
    return { ticketId: ticket.id, articleId, reopened: fromStatus !== toStatus }
  },
}

registerCommand(addNoteCommand)
registerCommand(receiveArticleCommand)
