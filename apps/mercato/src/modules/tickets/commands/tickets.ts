import { randomUUID } from 'crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { Ticket, TicketArticle } from '../data/entities'
import { DEFAULT_QUEUE_KEY, type TicketPriority, type TicketStatus } from '../data/constants'
import {
  ticketClassifySchema,
  ticketCreateSchema,
  ticketDeleteSchema,
  ticketFlagManualReviewSchema,
  ticketTransitionSchema,
  ticketUpdateSchema,
  type TicketClassifyParsed,
  type TicketCreateParsed,
} from '../data/validators'
import { TicketNumberGenerator } from '../lib/numberGenerator'
import { assertTransition } from '../lib/stateMachine'
import { normalizeMessageId } from '../lib/threadMatcher'
import { emitTicketsEvent } from '../events'
import {
  actorUserId,
  applyTicketSnapshot,
  buildTicketLog,
  computeRequesterEmailHash,
  emitStatusChanged,
  emitTicketCrud,
  emitTicketUndoCrud,
  enforceOptimisticLock,
  extractUndoPayload,
  loadTicket,
  loadTicketSnapshot,
  parseCommandInput,
  priorityRank,
  requireTicket,
  resolveEm,
  resolveScope,
  resolveUndoScope,
  ticketEmitOptions,
  ticketEventPayload,
  type TicketSnapshot,
  type TicketUndoPayload,
} from './shared'

export type TicketCreateResult = { ticketId: string; number: string; articleId: string | null }
export type TicketMutationResult = { ticketId: string }

function hasOwn(input: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(input, key)
}

function resolveNumberGenerator(ctx: CommandRuntimeContext): TicketNumberGenerator {
  try {
    return ctx.container.resolve('ticketNumberGenerator') as TicketNumberGenerator
  } catch {
    return new TicketNumberGenerator(ctx.container.resolve('em') as EntityManager)
  }
}

async function restoreTicketFromSnapshot(
  ctx: CommandRuntimeContext,
  snapshot: TicketSnapshot,
  label: string,
): Promise<Ticket | null> {
  const scope = resolveUndoScope(ctx, snapshot)
  const em = resolveEm(ctx)
  const ticket = await loadTicket(em, snapshot.id, scope, { includeDeleted: true })
  if (!ticket) return null
  await withAtomicFlush(em, [() => applyTicketSnapshot(ticket, snapshot)], { transaction: true, label })
  return ticket
}

function buildInitialArticle(
  em: EntityManager,
  ticket: Ticket,
  parsed: TicketCreateParsed,
  now: Date,
  authorUserId: string | null,
): TicketArticle | null {
  const article = parsed.initialArticle
  if (article) {
    const entity = em.create(TicketArticle, {
      id: randomUUID(),
      tenantId: ticket.tenantId,
      organizationId: ticket.organizationId,
      ticketId: ticket.id,
      direction: 'inbound',
      fromEmail: article.fromEmail,
      toEmail: article.toEmail ?? null,
      subject: article.subject ?? parsed.subject,
      bodyText: article.bodyText,
      bodyHtml: article.bodyHtml ?? null,
      messageId: normalizeMessageId(article.messageId),
      inReplyTo: normalizeMessageId(article.inReplyTo),
      authorUserId: null,
      sourceInboxEmailId: article.sourceInboxEmailId ?? null,
      deliveryStatus: 'received',
      sentAt: null,
      createdAt: article.receivedAt ?? now,
      updatedAt: now,
    })
    em.persist(entity)
    return entity
  }
  if (parsed.initialMessage && parsed.initialMessage.trim()) {
    const entity = em.create(TicketArticle, {
      id: randomUUID(),
      tenantId: ticket.tenantId,
      organizationId: ticket.organizationId,
      ticketId: ticket.id,
      direction: 'inbound',
      fromEmail: parsed.requesterEmail,
      toEmail: null,
      subject: parsed.subject,
      bodyText: parsed.initialMessage.trim(),
      bodyHtml: null,
      messageId: null,
      inReplyTo: null,
      authorUserId,
      sourceInboxEmailId: null,
      deliveryStatus: 'received',
      sentAt: null,
      createdAt: now,
      updatedAt: now,
    })
    em.persist(entity)
    return entity
  }
  return null
}

const createTicketCommand: CommandHandler<unknown, TicketCreateResult> = {
  id: 'tickets.ticket.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = parseCommandInput(ticketCreateSchema, rawInput)
    const scope = resolveScope(ctx, parsed)
    const { number } = await resolveNumberGenerator(ctx).generate(scope)
    const em = resolveEm(ctx)
    const now = new Date()
    const priority: TicketPriority = parsed.priority ?? 'normal'
    const ticket = em.create(Ticket, {
      id: parsed.id ?? randomUUID(),
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      number,
      subject: parsed.subject,
      channel: parsed.channel,
      queueKey: parsed.queueKey ?? DEFAULT_QUEUE_KEY,
      status: 'new',
      priority,
      priorityRank: priorityRank(priority),
      priorityReason: null,
      requesterEmail: parsed.requesterEmail,
      requesterEmailHash: computeRequesterEmailHash(parsed.requesterEmail),
      requesterName: parsed.requesterName ?? parsed.initialArticle?.fromName ?? null,
      customerPersonId: parsed.customerPersonId ?? null,
      reservationId: parsed.reservationId ?? null,
      needsManualReview: false,
      assigneeUserId: parsed.assigneeUserId ?? null,
      lastInboundAt: null,
      lastOutboundAt: null,
      createdAt: now,
      updatedAt: now,
    })
    let article: TicketArticle | null = null
    await withAtomicFlush(em, [
      () => {
        em.persist(ticket)
        article = buildInitialArticle(em, ticket, parsed, now, actorUserId(ctx))
        if (article) ticket.lastInboundAt = article.createdAt
      },
    ], { transaction: true, label: 'tickets.ticket.create' })
    await emitTicketCrud(ctx, 'created', ticket)
    const createdArticle = article as TicketArticle | null
    return { ticketId: ticket.id, number: ticket.number, articleId: createdArticle ? createdArticle.id : null }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const parsed = parseCommandInput(ticketCreateSchema, rawInput)
    return loadTicketSnapshot(ctx, result.ticketId, resolveScope(ctx, parsed))
  },
  buildLog: ({ result, snapshots }) => buildTicketLog('tickets.audit.ticket.create', result.ticketId, snapshots),
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<TicketUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const scope = resolveUndoScope(ctx, after)
    const em = resolveEm(ctx)
    const ticket = await loadTicket(em, after.id, scope)
    if (!ticket) return
    const now = new Date()
    await withAtomicFlush(em, [
      async () => {
        ticket.deletedAt = now
        ticket.updatedAt = now
        await em.nativeUpdate(
          TicketArticle,
          { ticketId: ticket.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
          { deletedAt: now },
        )
      },
    ], { transaction: true, label: 'tickets.ticket.create.undo' })
    await emitTicketUndoCrud(ctx, 'deleted', ticket)
  },
}

const updateTicketCommand: CommandHandler<unknown, TicketMutationResult> = {
  id: 'tickets.ticket.update',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = parseCommandInput(ticketUpdateSchema, rawInput)
    return { before: await loadTicketSnapshot(ctx, parsed.id, resolveScope(ctx, parsed)) }
  },
  async execute(rawInput, ctx) {
    const parsed = parseCommandInput(ticketUpdateSchema, rawInput)
    const scope = resolveScope(ctx, parsed)
    const em = resolveEm(ctx)
    const ticket = await requireTicket(em, parsed.id, scope)
    await enforceOptimisticLock(ctx, ticket)
    await withAtomicFlush(em, [
      () => {
        if (parsed.subject !== undefined) ticket.subject = parsed.subject
        if (parsed.queueKey !== undefined) ticket.queueKey = parsed.queueKey
        if (hasOwn(parsed, 'assigneeUserId')) ticket.assigneeUserId = parsed.assigneeUserId ?? null
        ticket.updatedAt = new Date()
      },
    ], { transaction: true, label: 'tickets.ticket.update' })
    await emitTicketCrud(ctx, 'updated', ticket)
    return { ticketId: ticket.id }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const parsed = parseCommandInput(ticketUpdateSchema, rawInput)
    return loadTicketSnapshot(ctx, result.ticketId, resolveScope(ctx, parsed))
  },
  buildLog: ({ result, snapshots }) => buildTicketLog('tickets.audit.ticket.update', result.ticketId, snapshots),
  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<TicketUndoPayload>(logEntry)?.before
    if (!before) return
    const ticket = await restoreTicketFromSnapshot(ctx, before, 'tickets.ticket.update.undo')
    await emitTicketUndoCrud(ctx, 'updated', ticket)
  },
}

const deleteTicketCommand: CommandHandler<unknown, TicketMutationResult> = {
  id: 'tickets.ticket.delete',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = parseCommandInput(ticketDeleteSchema, rawInput)
    return { before: await loadTicketSnapshot(ctx, parsed.id, resolveScope(ctx, parsed)) }
  },
  async execute(rawInput, ctx) {
    const parsed = parseCommandInput(ticketDeleteSchema, rawInput)
    const scope = resolveScope(ctx, parsed)
    const em = resolveEm(ctx)
    const ticket = await requireTicket(em, parsed.id, scope)
    await enforceOptimisticLock(ctx, ticket)
    await withAtomicFlush(em, [
      () => {
        const now = new Date()
        ticket.deletedAt = now
        ticket.updatedAt = now
      },
    ], { transaction: true, label: 'tickets.ticket.delete' })
    await emitTicketCrud(ctx, 'deleted', ticket)
    return { ticketId: ticket.id }
  },
  buildLog: ({ result, snapshots }) => buildTicketLog('tickets.audit.ticket.delete', result.ticketId, snapshots),
  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<TicketUndoPayload>(logEntry)?.before
    if (!before) return
    const ticket = await restoreTicketFromSnapshot(ctx, before, 'tickets.ticket.delete.undo')
    await emitTicketUndoCrud(ctx, 'created', ticket)
  },
}

export function assertClassificationWritable(
  current: Pick<Ticket, 'classificationSource'>,
  input: Pick<TicketClassifyParsed, 'source' | 'force'>,
): void {
  if (input.source !== 'workflow') return
  if (current.classificationSource !== 'manual') return
  if (input.force === true) return
  throw new CrudHttpError(409, { error: 'tickets.errors.manualClassificationLocked', code: 'manual_classification_locked' })
}

type ClassificationView = {
  customerPersonId: string | null
  reservationId: string | null
  reservationNumberSnapshot: string | null
  categoryKey: string | null
  subcategoryKey: string | null
  topicKey: string | null
  categoryPathSnapshot: string | null
  priority: TicketPriority
  priorityReason: string | null
  classificationSource: string | null
}

function classificationView(ticket: Ticket): ClassificationView {
  return {
    customerPersonId: ticket.customerPersonId ?? null,
    reservationId: ticket.reservationId ?? null,
    reservationNumberSnapshot: ticket.reservationNumberSnapshot ?? null,
    categoryKey: ticket.categoryKey ?? null,
    subcategoryKey: ticket.subcategoryKey ?? null,
    topicKey: ticket.topicKey ?? null,
    categoryPathSnapshot: ticket.categoryPathSnapshot ?? null,
    priority: ticket.priority,
    priorityReason: ticket.priorityReason ?? null,
    classificationSource: ticket.classificationSource ?? null,
  }
}

export function applyClassification(ticket: Ticket, input: TicketClassifyParsed, now: Date): void {
  if (hasOwn(input, 'customerPersonId')) ticket.customerPersonId = input.customerPersonId ?? null
  if (hasOwn(input, 'reservationId')) ticket.reservationId = input.reservationId ?? null
  if (hasOwn(input, 'reservationNumberSnapshot')) ticket.reservationNumberSnapshot = input.reservationNumberSnapshot ?? null
  if (hasOwn(input, 'categoryKey')) ticket.categoryKey = input.categoryKey ?? null
  if (hasOwn(input, 'subcategoryKey')) ticket.subcategoryKey = input.subcategoryKey ?? null
  if (hasOwn(input, 'topicKey')) ticket.topicKey = input.topicKey ?? null
  if (hasOwn(input, 'categoryPathSnapshot')) ticket.categoryPathSnapshot = input.categoryPathSnapshot ?? null
  if (input.priority) {
    ticket.priority = input.priority
    ticket.priorityRank = priorityRank(input.priority)
  }
  if (hasOwn(input, 'priorityReason')) ticket.priorityReason = input.priorityReason ?? null
  if (hasOwn(input, 'summary')) ticket.summary = input.summary ?? null
  ticket.classifiedAt = now
  ticket.classificationSource = input.source
  ticket.updatedAt = now
}

const classifyTicketCommand: CommandHandler<unknown, TicketMutationResult> = {
  id: 'tickets.ticket.classify',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = parseCommandInput(ticketClassifySchema, rawInput)
    return { before: await loadTicketSnapshot(ctx, parsed.id, resolveScope(ctx, parsed)) }
  },
  async execute(rawInput, ctx) {
    const parsed = parseCommandInput(ticketClassifySchema, rawInput)
    const scope = resolveScope(ctx, parsed)
    const em = resolveEm(ctx)
    const ticket = await requireTicket(em, parsed.id, scope)
    await enforceOptimisticLock(ctx, ticket)
    assertClassificationWritable(ticket, parsed)
    const before = classificationView(ticket)
    await withAtomicFlush(em, [() => applyClassification(ticket, parsed, new Date())], {
      transaction: true,
      label: 'tickets.ticket.classify',
    })
    await emitTicketCrud(ctx, 'updated', ticket)
    await emitTicketsEvent('tickets.ticket.classified', {
      ...ticketEventPayload(ticket),
      source: parsed.source,
      before,
      after: classificationView(ticket),
    }, ticketEmitOptions(ticket))
    return { ticketId: ticket.id }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const parsed = parseCommandInput(ticketClassifySchema, rawInput)
    return loadTicketSnapshot(ctx, result.ticketId, resolveScope(ctx, parsed))
  },
  buildLog: ({ result, snapshots }) => buildTicketLog('tickets.audit.ticket.classify', result.ticketId, snapshots),
  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<TicketUndoPayload>(logEntry)?.before
    if (!before) return
    const ticket = await restoreTicketFromSnapshot(ctx, before, 'tickets.ticket.classify.undo')
    await emitTicketUndoCrud(ctx, 'updated', ticket)
  },
}

const flagManualReviewCommand: CommandHandler<unknown, TicketMutationResult> = {
  id: 'tickets.ticket.flag_manual_review',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = parseCommandInput(ticketFlagManualReviewSchema, rawInput)
    return { before: await loadTicketSnapshot(ctx, parsed.id, resolveScope(ctx, parsed)) }
  },
  async execute(rawInput, ctx) {
    const parsed = parseCommandInput(ticketFlagManualReviewSchema, rawInput)
    const scope = resolveScope(ctx, parsed)
    const em = resolveEm(ctx)
    const ticket = await requireTicket(em, parsed.id, scope)
    await enforceOptimisticLock(ctx, ticket)
    await withAtomicFlush(em, [
      () => {
        if (parsed.clear) {
          ticket.needsManualReview = false
          ticket.manualReviewReason = null
          ticket.manualReviewReasonCode = null
        } else {
          ticket.needsManualReview = true
          ticket.manualReviewReason = parsed.reason ?? null
          ticket.manualReviewReasonCode = parsed.reasonCode ?? null
        }
        if (parsed.targetQueueKey) ticket.queueKey = parsed.targetQueueKey
        ticket.updatedAt = new Date()
      },
    ], { transaction: true, label: 'tickets.ticket.flag_manual_review' })
    await emitTicketCrud(ctx, 'updated', ticket)
    if (!parsed.clear) {
      await emitTicketsEvent('tickets.ticket.manual_review_flagged', {
        ...ticketEventPayload(ticket),
        reasonCode: ticket.manualReviewReasonCode ?? null,
        targetQueueKey: parsed.targetQueueKey ?? null,
      }, ticketEmitOptions(ticket))
    }
    return { ticketId: ticket.id }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const parsed = parseCommandInput(ticketFlagManualReviewSchema, rawInput)
    return loadTicketSnapshot(ctx, result.ticketId, resolveScope(ctx, parsed))
  },
  buildLog: ({ result, snapshots }) => buildTicketLog('tickets.audit.ticket.flagManualReview', result.ticketId, snapshots),
  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<TicketUndoPayload>(logEntry)?.before
    if (!before) return
    const ticket = await restoreTicketFromSnapshot(ctx, before, 'tickets.ticket.flag_manual_review.undo')
    await emitTicketUndoCrud(ctx, 'updated', ticket)
  },
}

const transitionTicketCommand: CommandHandler<unknown, TicketMutationResult & { fromStatus: TicketStatus; toStatus: TicketStatus }> = {
  id: 'tickets.ticket.transition',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = parseCommandInput(ticketTransitionSchema, rawInput)
    return { before: await loadTicketSnapshot(ctx, parsed.id, resolveScope(ctx, parsed)) }
  },
  async execute(rawInput, ctx) {
    const parsed = parseCommandInput(ticketTransitionSchema, rawInput)
    const scope = resolveScope(ctx, parsed)
    const em = resolveEm(ctx)
    const ticket = await requireTicket(em, parsed.id, scope)
    await enforceOptimisticLock(ctx, ticket)
    const fromStatus = ticket.status
    assertTransition(fromStatus, parsed.to)
    await withAtomicFlush(em, [
      () => {
        const now = new Date()
        ticket.status = parsed.to
        ticket.updatedAt = now
        if (parsed.note && parsed.note.trim()) {
          em.persist(em.create(TicketArticle, {
            id: randomUUID(),
            tenantId: ticket.tenantId,
            organizationId: ticket.organizationId,
            ticketId: ticket.id,
            direction: 'internal_note',
            fromEmail: null,
            toEmail: null,
            subject: null,
            bodyText: parsed.note.trim(),
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
        }
      },
    ], { transaction: true, label: 'tickets.ticket.transition' })
    await emitTicketCrud(ctx, 'updated', ticket)
    await emitStatusChanged(ticket, fromStatus, parsed.to)
    return { ticketId: ticket.id, fromStatus, toStatus: parsed.to }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const parsed = parseCommandInput(ticketTransitionSchema, rawInput)
    return loadTicketSnapshot(ctx, result.ticketId, resolveScope(ctx, parsed))
  },
  buildLog: ({ result, snapshots }) => buildTicketLog('tickets.audit.ticket.transition', result.ticketId, snapshots),
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<TicketUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const ticket = await restoreTicketFromSnapshot(ctx, before, 'tickets.ticket.transition.undo')
    await emitTicketUndoCrud(ctx, 'updated', ticket)
    const after = payload?.after
    if (ticket && after) await emitStatusChanged(ticket, after.status, before.status)
  },
}

registerCommand(createTicketCommand)
registerCommand(updateTicketCommand)
registerCommand(deleteTicketCommand)
registerCommand(classifyTicketCommand)
registerCommand(flagManualReviewCommand)
registerCommand(transitionTicketCommand)
