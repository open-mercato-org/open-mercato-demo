import { randomUUID } from 'crypto'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { TicketReplyDraft } from '../data/entities'
import { TICKET_REPLY_DRAFT_RESOURCE_KIND, type DraftStatus } from '../data/constants'
import { replyDraftSaveSchema } from '../data/validators'
import { emitTicketsEvent } from '../events'
import {
  actorUserId,
  enforceOptimisticLock,
  extractUndoPayload,
  parseCommandInput,
  requireDraft,
  requireTicket,
  resolveEm,
  resolveScope,
  resolveUndoScope,
  type TicketScope,
} from './shared'

export type DraftSnapshot = {
  id: string
  ticketId: string
  tenantId: string
  organizationId: string
  subject: string | null
  body: string
  status: DraftStatus
  sourceType: string | null
  sourceRef: string | null
}

type DraftUndoPayload = {
  before?: DraftSnapshot | null
  after?: DraftSnapshot | null
}

export type DraftSaveResult = { ticketId: string; draftId: string; created: boolean }

function serializeDraft(draft: TicketReplyDraft): DraftSnapshot {
  return {
    id: draft.id,
    ticketId: draft.ticketId,
    tenantId: draft.tenantId,
    organizationId: draft.organizationId,
    subject: draft.subject ?? null,
    body: draft.body,
    status: draft.status,
    sourceType: draft.sourceType ?? null,
    sourceRef: draft.sourceRef ?? null,
  }
}

async function loadDraftSnapshot(
  ctx: CommandRuntimeContext,
  ticketId: string,
  draftId: string,
  scope: TicketScope,
): Promise<DraftSnapshot | null> {
  const em = resolveEm(ctx)
  const draft = await findOneWithDecryption(
    em,
    TicketReplyDraft,
    { id: draftId, ticketId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    scope,
  )
  return draft ? serializeDraft(draft) : null
}

function defaultSourceType(ctx: CommandRuntimeContext): string | null {
  return ctx.auth?.sub ? 'manual' : null
}

const saveDraftCommand: CommandHandler<unknown, DraftSaveResult> = {
  id: 'tickets.reply_draft.save',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = parseCommandInput(replyDraftSaveSchema, rawInput)
    if (!parsed.draftId) return { before: null }
    return { before: await loadDraftSnapshot(ctx, parsed.ticketId, parsed.draftId, resolveScope(ctx, parsed)) }
  },
  async execute(rawInput, ctx) {
    const parsed = parseCommandInput(replyDraftSaveSchema, rawInput)
    const scope = resolveScope(ctx, parsed)
    const em = resolveEm(ctx)
    const ticket = await requireTicket(em, parsed.ticketId, scope)
    if (ticket.status === 'closed') throw new CrudHttpError(409, { error: 'tickets.errors.ticketClosed' })
    let draft: TicketReplyDraft
    let created = false
    if (parsed.draftId) {
      draft = await requireDraft(em, ticket.id, parsed.draftId, scope)
      if (draft.status !== 'draft') throw new CrudHttpError(409, { error: 'tickets.errors.draftNotEditable' })
      await enforceOptimisticLock(ctx, draft, TICKET_REPLY_DRAFT_RESOURCE_KIND, parsed.expectedUpdatedAt)
      await withAtomicFlush(em, [
        () => {
          draft.body = parsed.body
          if (parsed.subject !== undefined) draft.subject = parsed.subject ?? null
          if (parsed.sourceType !== undefined) draft.sourceType = parsed.sourceType ?? null
          if (parsed.sourceRef !== undefined) draft.sourceRef = parsed.sourceRef ?? null
          draft.updatedAt = new Date()
        },
      ], { transaction: true, label: 'tickets.reply_draft.save' })
    } else {
      const now = new Date()
      draft = em.create(TicketReplyDraft, {
        id: randomUUID(),
        tenantId: ticket.tenantId,
        organizationId: ticket.organizationId,
        ticketId: ticket.id,
        subject: parsed.subject ?? null,
        body: parsed.body,
        status: 'draft',
        sourceType: parsed.sourceType ?? defaultSourceType(ctx),
        sourceRef: parsed.sourceRef ?? null,
        createdByUserId: actorUserId(ctx),
        sentArticleId: null,
        createdAt: now,
        updatedAt: now,
      })
      created = true
      await withAtomicFlush(em, [() => { em.persist(draft) }], { transaction: true, label: 'tickets.reply_draft.create' })
    }
    await emitTicketsEvent('tickets.reply_draft.saved', {
      id: draft.id,
      draftId: draft.id,
      ticketId: ticket.id,
      tenantId: ticket.tenantId,
      organizationId: ticket.organizationId,
      sourceType: draft.sourceType ?? null,
      sourceRef: draft.sourceRef ?? null,
      created,
    }, { persistent: true, tenantId: ticket.tenantId, organizationId: ticket.organizationId })
    return { ticketId: ticket.id, draftId: draft.id, created }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const parsed = parseCommandInput(replyDraftSaveSchema, rawInput)
    return loadDraftSnapshot(ctx, result.ticketId, result.draftId, resolveScope(ctx, parsed))
  },
  buildLog: ({ result, snapshots }) => {
    const before = (snapshots.before as DraftSnapshot | null | undefined) ?? null
    const after = (snapshots.after as DraftSnapshot | null | undefined) ?? null
    const payload: { undo: DraftUndoPayload } = { undo: { before, after } }
    return {
      actionLabel: result.created ? 'tickets.audit.draft.create' : 'tickets.audit.draft.update',
      resourceKind: TICKET_REPLY_DRAFT_RESOURCE_KIND,
      resourceId: result.draftId,
      parentResourceKind: 'tickets.ticket',
      parentResourceId: result.ticketId,
      tenantId: after?.tenantId ?? before?.tenantId ?? null,
      organizationId: after?.organizationId ?? before?.organizationId ?? null,
      snapshotBefore: before,
      snapshotAfter: after,
      payload,
    }
  },
  async undo({ logEntry, ctx }) {
    const payload = extractUndoPayload<DraftUndoPayload>(logEntry)
    const reference = payload?.after ?? payload?.before
    if (!reference) return
    const scope = resolveUndoScope(ctx, reference)
    const em = resolveEm(ctx)
    const draft = await findOneWithDecryption(
      em,
      TicketReplyDraft,
      { id: reference.id, ticketId: reference.ticketId, tenantId: scope.tenantId, organizationId: scope.organizationId },
      {},
      scope,
    )
    if (!draft || draft.status === 'sent') return
    const before = payload?.before ?? null
    await withAtomicFlush(em, [
      () => {
        const now = new Date()
        if (!before) {
          draft.status = 'discarded'
          draft.deletedAt = now
        } else {
          draft.body = before.body
          draft.subject = before.subject
          draft.sourceType = before.sourceType
          draft.sourceRef = before.sourceRef
          draft.status = before.status
        }
        draft.updatedAt = now
      },
    ], { transaction: true, label: 'tickets.reply_draft.save.undo' })
  },
}

registerCommand(saveDraftCommand)
