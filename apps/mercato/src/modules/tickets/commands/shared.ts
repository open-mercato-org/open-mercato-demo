import type { EntityManager } from '@mikro-orm/postgresql'
import type { z } from 'zod'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { Ticket, TicketReplyDraft } from '../data/entities'
import { emitTicketsEvent } from '../events'
import {
  TICKET_ENTITY_ID,
  TICKET_PRIORITY_RANK,
  TICKET_RESOURCE_KIND,
  type ClassificationSource,
  type TicketChannel,
  type TicketPriority,
  type TicketStatus,
} from '../data/constants'

export { extractUndoPayload } from '@open-mercato/shared/lib/commands/undo'

export type TicketScope = {
  tenantId: string
  organizationId: string
}

export type ScopeInput = {
  tenantId?: string | null
  organizationId?: string | null
}

export type TicketSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  number: string
  subject: string
  channel: TicketChannel
  queueKey: string
  status: TicketStatus
  priority: TicketPriority
  priorityReason: string | null
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
  classifiedAt: string | null
  classificationSource: ClassificationSource | null
  assigneeUserId: string | null
  lastInboundAt: string | null
  lastOutboundAt: string | null
  deletedAt: string | null
}

export type TicketUndoPayload = {
  before?: TicketSnapshot | null
  after?: TicketSnapshot | null
}

export function parseCommandInput<TSchema extends z.ZodTypeAny>(schema: TSchema, rawInput: unknown): z.infer<TSchema> {
  const result = schema.safeParse(rawInput ?? {})
  if (!result.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of result.error.issues) {
      const path = issue.path.map(String).join('.')
      if (path && !fieldErrors[path]) fieldErrors[path] = issue.message
    }
    throw new CrudHttpError(400, { error: 'tickets.errors.invalidInput', fieldErrors })
  }
  return result.data
}

export function resolveScope(ctx: CommandRuntimeContext, input: ScopeInput = {}): TicketScope {
  const tenantId = input.tenantId ?? ctx.auth?.tenantId ?? null
  const organizationId = input.organizationId ?? ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: 'tickets.errors.tenantRequired' })
  if (!organizationId) throw new CrudHttpError(400, { error: 'tickets.errors.organizationRequired' })
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
  return { tenantId, organizationId }
}

export function resolveEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

export function actorUserId(ctx: CommandRuntimeContext): string | null {
  return ctx.auth?.sub ?? null
}

export function computeRequesterEmailHash(email: string): string {
  return hashForLookup(email)
}

export function priorityRank(priority: TicketPriority): number {
  return TICKET_PRIORITY_RANK[priority] ?? TICKET_PRIORITY_RANK.normal
}

export async function loadTicket(
  em: EntityManager,
  id: string,
  scope: TicketScope,
  options: { includeDeleted?: boolean } = {},
): Promise<Ticket | null> {
  return findOneWithDecryption(
    em,
    Ticket,
    {
      id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ...(options.includeDeleted ? {} : { deletedAt: null }),
    },
    {},
    scope,
  )
}

export async function requireTicket(em: EntityManager, id: string, scope: TicketScope): Promise<Ticket> {
  const ticket = await loadTicket(em, id, scope)
  if (!ticket) throw new CrudHttpError(404, { error: 'tickets.errors.notFound' })
  return ticket
}

export async function requireDraft(
  em: EntityManager,
  ticketId: string,
  draftId: string,
  scope: TicketScope,
): Promise<TicketReplyDraft> {
  const draft = await findOneWithDecryption(
    em,
    TicketReplyDraft,
    {
      id: draftId,
      ticketId,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
    },
    {},
    scope,
  )
  if (!draft) throw new CrudHttpError(404, { error: 'tickets.errors.draftNotFound' })
  return draft
}

export async function enforceOptimisticLock(
  ctx: CommandRuntimeContext,
  record: { id: string; updatedAt?: Date | null },
  resourceKind: string = TICKET_RESOURCE_KIND,
  expected?: string | null,
): Promise<void> {
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind,
    resourceId: record.id,
    current: record.updatedAt ?? null,
    expected,
    request: ctx.request ?? null,
  })
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

function toDate(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function serializeTicket(ticket: Ticket): TicketSnapshot {
  return {
    id: ticket.id,
    tenantId: ticket.tenantId,
    organizationId: ticket.organizationId,
    number: ticket.number,
    subject: ticket.subject,
    channel: ticket.channel,
    queueKey: ticket.queueKey,
    status: ticket.status,
    priority: ticket.priority,
    priorityReason: ticket.priorityReason ?? null,
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
    classifiedAt: toIso(ticket.classifiedAt),
    classificationSource: ticket.classificationSource ?? null,
    assigneeUserId: ticket.assigneeUserId ?? null,
    lastInboundAt: toIso(ticket.lastInboundAt),
    lastOutboundAt: toIso(ticket.lastOutboundAt),
    deletedAt: toIso(ticket.deletedAt),
  }
}

export function applyTicketSnapshot(ticket: Ticket, snapshot: TicketSnapshot): void {
  ticket.subject = snapshot.subject
  ticket.channel = snapshot.channel
  ticket.queueKey = snapshot.queueKey
  ticket.status = snapshot.status
  ticket.priority = snapshot.priority
  ticket.priorityRank = priorityRank(snapshot.priority)
  ticket.priorityReason = snapshot.priorityReason
  ticket.requesterEmail = snapshot.requesterEmail
  ticket.requesterEmailHash = computeRequesterEmailHash(snapshot.requesterEmail)
  ticket.requesterName = snapshot.requesterName
  ticket.customerPersonId = snapshot.customerPersonId
  ticket.reservationId = snapshot.reservationId
  ticket.reservationNumberSnapshot = snapshot.reservationNumberSnapshot
  ticket.categoryKey = snapshot.categoryKey
  ticket.subcategoryKey = snapshot.subcategoryKey
  ticket.topicKey = snapshot.topicKey
  ticket.categoryPathSnapshot = snapshot.categoryPathSnapshot
  ticket.summary = snapshot.summary
  ticket.needsManualReview = snapshot.needsManualReview
  ticket.manualReviewReasonCode = snapshot.manualReviewReasonCode
  ticket.manualReviewReason = snapshot.manualReviewReason
  ticket.classifiedAt = toDate(snapshot.classifiedAt)
  ticket.classificationSource = snapshot.classificationSource
  ticket.assigneeUserId = snapshot.assigneeUserId
  ticket.lastInboundAt = toDate(snapshot.lastInboundAt)
  ticket.lastOutboundAt = toDate(snapshot.lastOutboundAt)
  ticket.deletedAt = toDate(snapshot.deletedAt)
  ticket.updatedAt = new Date()
}

export function ticketEventPayload(ticket: Ticket): Record<string, unknown> {
  return {
    id: ticket.id,
    ticketId: ticket.id,
    tenantId: ticket.tenantId,
    organizationId: ticket.organizationId,
    number: ticket.number,
    status: ticket.status,
    priority: ticket.priority,
    queueKey: ticket.queueKey,
    channel: ticket.channel,
    needsManualReview: ticket.needsManualReview === true,
  }
}

export function ticketEmitOptions(ticket: Ticket) {
  return {
    persistent: true,
    tenantId: ticket.tenantId,
    organizationId: ticket.organizationId,
  } as const
}

export async function emitStatusChanged(ticket: Ticket, from: TicketStatus, to: TicketStatus): Promise<void> {
  if (from === to) return
  await emitTicketsEvent('tickets.ticket.status_changed', {
    ...ticketEventPayload(ticket),
    fromStatus: from,
    toStatus: to,
  }, ticketEmitOptions(ticket))
}

export const ticketCrudEvents: CrudEventsConfig<Ticket> = {
  module: 'tickets',
  entity: 'ticket',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<Ticket>) => ({
    ...(ctx.entity ? ticketEventPayload(ctx.entity) : {}),
    id: ctx.identifiers.id,
    ticketId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

export const ticketCrudIndexer: CrudIndexerConfig<Ticket> = {
  entityType: TICKET_ENTITY_ID,
  buildUpsertPayload: (ctx: CrudEmitContext<Ticket>) => ({
    entityType: TICKET_ENTITY_ID,
    recordId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
  buildDeletePayload: (ctx: CrudEmitContext<Ticket>) => ({
    entityType: TICKET_ENTITY_ID,
    recordId: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
  }),
}

function ticketIdentifiers(ticket: Ticket) {
  return { id: ticket.id, tenantId: ticket.tenantId, organizationId: ticket.organizationId }
}

export async function emitTicketCrud(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  ticket: Ticket,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudSideEffects({
    dataEngine,
    action,
    entity: ticket,
    identifiers: ticketIdentifiers(ticket),
    syncOrigin: ctx.syncOrigin,
    actorUserId: actorUserId(ctx),
    events: ticketCrudEvents,
    indexer: ticketCrudIndexer,
  })
}

export async function emitTicketUndoCrud(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  ticket: Ticket | null,
): Promise<void> {
  if (!ticket) return
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  await emitCrudUndoSideEffects({
    dataEngine,
    action,
    entity: ticket,
    identifiers: ticketIdentifiers(ticket),
    syncOrigin: ctx.syncOrigin,
    actorUserId: actorUserId(ctx),
    events: ticketCrudEvents,
    indexer: ticketCrudIndexer,
  })
}

export function buildTicketLog(
  actionLabel: string,
  resourceId: string,
  snapshots: { before?: unknown; after?: unknown },
) {
  const before = (snapshots.before as TicketSnapshot | null | undefined) ?? null
  const after = (snapshots.after as TicketSnapshot | null | undefined) ?? null
  const payload: { undo: TicketUndoPayload } = { undo: { before, after } }
  return {
    actionLabel,
    resourceKind: TICKET_RESOURCE_KIND,
    resourceId,
    tenantId: after?.tenantId ?? before?.tenantId ?? null,
    organizationId: after?.organizationId ?? before?.organizationId ?? null,
    snapshotBefore: before,
    snapshotAfter: after,
    payload,
  }
}

export async function loadTicketSnapshot(
  ctx: CommandRuntimeContext,
  id: string,
  scope: TicketScope,
): Promise<TicketSnapshot | null> {
  const em = resolveEm(ctx)
  const ticket = await loadTicket(em, id, scope, { includeDeleted: true })
  return ticket ? serializeTicket(ticket) : null
}

export function resolveUndoScope(ctx: CommandRuntimeContext, snapshot: { tenantId: string; organizationId: string }): TicketScope {
  return resolveScope(ctx, { tenantId: snapshot.tenantId, organizationId: snapshot.organizationId })
}
