import { LockMode } from '@mikro-orm/core'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { ReservationRefund } from '../data/entities'
import {
  REFUND_TRANSITIONS,
  RESERVATION_REFUND_ENTITY_ID,
  RESERVATION_REFUND_RESOURCE_KIND,
  RESERVATION_RESOURCE_KIND,
  type RefundStatus,
} from '../data/constants'
import {
  refundRequestSchema,
  refundTransitionSchema,
  type RefundRequestInput,
  type RefundTransitionInput,
} from '../data/validators'
import { emitReservationsEvent } from '../events'
import { checkRefundWithinOverpayment, computeBalanceCents, formatAmount } from '../lib/balance'
import { ibanLast4, isValidIban, normalizeIban } from '../lib/iban'
import {
  enforceReservationsOptimisticLock,
  forkEm,
  invalidateReservationsCache,
  loadReservationPayments,
  loadReservationRefunds,
  parseCommandInput,
  requireReservation,
  resolveScope,
  resolveUndoScope,
  type ReservationScope,
} from './shared'

export type RefundSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  reservationId: string
  amount: string
  currencyCode: string
  bankAccountLast4: string
  status: RefundStatus
  sourceType: string | null
  sourceRef: string | null
  relatedTicketId: string | null
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function serializeRefund(refund: ReservationRefund): RefundSnapshot {
  return {
    id: refund.id,
    tenantId: refund.tenantId,
    organizationId: refund.organizationId,
    reservationId: refund.reservationId,
    amount: formatAmount(refund.amount),
    currencyCode: refund.currencyCode,
    bankAccountLast4: refund.bankAccountLast4,
    status: refund.status,
    sourceType: refund.sourceType ?? null,
    sourceRef: refund.sourceRef ?? null,
    relatedTicketId: refund.relatedTicketId ?? null,
  }
}

export function canTransitionRefund(from: RefundStatus, to: RefundStatus): boolean {
  return REFUND_TRANSITIONS[from]?.includes(to) ?? false
}

async function loadRefund(
  em: EntityManager,
  id: string,
  scope: ReservationScope,
): Promise<ReservationRefund | null> {
  return findOneWithDecryption(
    em,
    ReservationRefund,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<ReservationRefund>,
    {},
    scope,
  )
}

async function requireRefund(em: EntityManager, id: string, scope: ReservationScope): Promise<ReservationRefund> {
  const refund = await loadRefund(em, id, scope)
  if (!refund) throw new CrudHttpError(404, { error: 'reservations.errors.refundNotFound' })
  return refund
}

async function emitRefundSideEffects(
  ctx: CommandRuntimeContext,
  refund: ReservationRefund,
  action: 'created' | 'updated',
  undo: boolean,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  const identifiers = { id: refund.id, tenantId: refund.tenantId, organizationId: refund.organizationId }
  const emit = undo ? emitCrudUndoSideEffects : emitCrudSideEffects
  await emit({
    dataEngine,
    action,
    entity: refund,
    identifiers,
    indexer: { entityType: RESERVATION_REFUND_ENTITY_ID },
  })
  await invalidateReservationsCache(ctx, RESERVATION_REFUND_RESOURCE_KIND, identifiers, `reservations.refund.${action}`)
  await invalidateReservationsCache(
    ctx,
    RESERVATION_RESOURCE_KIND,
    { id: refund.reservationId, tenantId: refund.tenantId, organizationId: refund.organizationId },
    `reservations.refund.${action}`,
  )
}

async function emitStatusChanged(refund: ReservationRefund, fromStatus: RefundStatus, toStatus: RefundStatus): Promise<void> {
  await emitReservationsEvent('reservations.refund.status_changed', {
    id: refund.id,
    reservationId: refund.reservationId,
    tenantId: refund.tenantId,
    organizationId: refund.organizationId,
    fromStatus,
    toStatus,
  }, { persistent: true, tenantId: refund.tenantId, organizationId: refund.organizationId })
}

async function captureRefund(ctx: CommandRuntimeContext, refundId: string, hints?: unknown): Promise<RefundSnapshot | null> {
  const scope = resolveScope(ctx, hints)
  const refund = await loadRefund(forkEm(ctx), refundId, scope)
  return refund ? serializeRefund(refund) : null
}

async function buildRefundLog(
  labelKey: string,
  fallback: string,
  result: { refundId: string; reservationId: string },
  snapshots: { before?: unknown; after?: unknown },
) {
  const { translate } = await resolveTranslations()
  const before = (snapshots.before as RefundSnapshot | null | undefined) ?? null
  const after = (snapshots.after as RefundSnapshot | null | undefined) ?? null
  return {
    actionLabel: translate(labelKey, fallback),
    resourceKind: RESERVATION_REFUND_RESOURCE_KIND,
    resourceId: result.refundId,
    parentResourceKind: RESERVATION_RESOURCE_KIND,
    parentResourceId: result.reservationId,
    tenantId: after?.tenantId ?? before?.tenantId ?? null,
    organizationId: after?.organizationId ?? before?.organizationId ?? null,
    snapshotBefore: before,
    snapshotAfter: after,
    payload: { undo: { before, after } satisfies UndoPayload<RefundSnapshot> },
  }
}

export type RefundRequestResult = {
  refundId: string
  reservationId: string
  amount: string
  currencyCode: string
  status: RefundStatus
}

const requestRefundCommand: CommandHandler<RefundRequestInput, RefundRequestResult> = {
  id: 'reservations.refund.request',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = parseCommandInput(refundRequestSchema, rawInput)
    const scope = resolveScope(ctx, rawInput)
    const iban = normalizeIban(input.bankAccountNumber)
    if (!isValidIban(iban)) {
      throw new CrudHttpError(422, {
        error: 'reservations.errors.invalidIban',
        code: 'invalid_iban',
        fieldErrors: { bankAccountNumber: 'reservations.errors.invalidIban' },
      })
    }
    const em = forkEm(ctx)
    const requestedBy = ctx.auth?.sub && UUID_PATTERN.test(ctx.auth.sub) ? ctx.auth.sub : null
    const refund = await em.transactional(async (tem) => {
      const reservation = await requireReservation(tem, input.reservationId, scope, {
        lockMode: LockMode.PESSIMISTIC_WRITE,
      })
      const currencyCode = input.currencyCode ?? reservation.currencyCode
      if (currencyCode !== reservation.currencyCode) {
        throw new CrudHttpError(422, {
          error: 'reservations.errors.currencyMismatch',
          code: 'currency_mismatch',
          fieldErrors: { currencyCode: 'reservations.errors.currencyMismatch' },
        })
      }
      const [payments, refunds] = await Promise.all([
        loadReservationPayments(tem, reservation.id, scope),
        loadReservationRefunds(tem, reservation.id, scope),
      ])
      const balance = computeBalanceCents(reservation, payments, refunds)
      const check = checkRefundWithinOverpayment(input.amount, balance.overpayment)
      if (!check.ok) {
        throw new CrudHttpError(422, {
          error: 'reservations.errors.refundExceedsOverpayment',
          code: 'refund_exceeds_overpayment',
          overpayment: check.overpayment,
          currencyCode: reservation.currencyCode,
          fieldErrors: { amount: 'reservations.errors.refundExceedsOverpayment' },
        })
      }
      const created = tem.create(ReservationRefund, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        reservationId: reservation.id,
        amount: formatAmount(input.amount),
        currencyCode,
        bankAccountNumber: iban,
        bankAccountLast4: ibanLast4(iban),
        reason: input.reason ?? null,
        status: 'requested',
        requestedByUserId: requestedBy,
        sourceType: input.sourceType ?? null,
        sourceRef: input.sourceRef ?? null,
        relatedTicketId: input.relatedTicketId ?? null,
      })
      tem.persist(created)
      await tem.flush()
      return created
    })
    await emitRefundSideEffects(ctx, refund, 'created', false)
    await emitReservationsEvent('reservations.refund.requested', {
      id: refund.id,
      reservationId: refund.reservationId,
      tenantId: refund.tenantId,
      organizationId: refund.organizationId,
      amount: refund.amount,
      currencyCode: refund.currencyCode,
      bankAccountLast4: refund.bankAccountLast4,
      sourceType: refund.sourceType ?? null,
      sourceRef: refund.sourceRef ?? null,
      relatedTicketId: refund.relatedTicketId ?? null,
    }, { persistent: true, tenantId: refund.tenantId, organizationId: refund.organizationId })
    return {
      refundId: refund.id,
      reservationId: refund.reservationId,
      amount: formatAmount(refund.amount),
      currencyCode: refund.currencyCode,
      status: refund.status,
    }
  },
  captureAfter: async (rawInput, result, ctx) => captureRefund(ctx, result.refundId, rawInput),
  buildLog: async ({ result, snapshots }) =>
    buildRefundLog('reservations.audit.refund.request', 'Request refund', result, snapshots),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<RefundSnapshot>>(logEntry)
    const after = payload?.after
    if (!after) return
    const scope = resolveUndoScope(ctx, after)
    const em = forkEm(ctx)
    const refund = await requireRefund(em, after.id, scope)
    if (refund.status === 'cancelled') return
    if (refund.status !== 'requested') {
      throw new CrudHttpError(409, { error: 'reservations.errors.refundUndoConflict' })
    }
    await withAtomicFlush(em, [
      () => {
        refund.status = 'cancelled'
        refund.updatedAt = new Date()
      },
    ], { transaction: true, label: 'reservations.refund.request.undo' })
    await emitRefundSideEffects(ctx, refund, 'updated', true)
    await emitStatusChanged(refund, 'requested', 'cancelled')
  },
}

const transitionRefundCommand: CommandHandler<RefundTransitionInput, { refundId: string; reservationId: string; status: RefundStatus }> = {
  id: 'reservations.refund.transition',
  isUndoable: true,
  prepare: async (rawInput, ctx) => {
    const input = parseCommandInput(refundTransitionSchema, rawInput)
    return { before: await captureRefund(ctx, input.id, rawInput) }
  },
  async execute(rawInput, ctx) {
    const input = parseCommandInput(refundTransitionSchema, rawInput)
    const scope = resolveScope(ctx, rawInput)
    const em = forkEm(ctx)
    const refund = await requireRefund(em, input.id, scope)
    await enforceReservationsOptimisticLock(ctx, refund, RESERVATION_REFUND_RESOURCE_KIND)
    const fromStatus = refund.status
    if (!canTransitionRefund(fromStatus, input.to)) {
      throw new CrudHttpError(422, { error: 'reservations.errors.invalidRefundTransition', code: 'invalid_transition' })
    }
    await withAtomicFlush(em, [
      () => {
        refund.status = input.to
        if (input.reason) refund.reason = refund.reason ? `${refund.reason}\n${input.reason}` : input.reason
        refund.updatedAt = new Date()
      },
    ], { transaction: true, label: 'reservations.refund.transition' })
    await emitRefundSideEffects(ctx, refund, 'updated', false)
    await emitStatusChanged(refund, fromStatus, input.to)
    return { refundId: refund.id, reservationId: refund.reservationId, status: refund.status }
  },
  captureAfter: async (rawInput, result, ctx) => captureRefund(ctx, result.refundId, rawInput),
  buildLog: async ({ result, snapshots }) =>
    buildRefundLog('reservations.audit.refund.transition', 'Change refund status', result, snapshots),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<RefundSnapshot>>(logEntry)
    const before = payload?.before
    const after = payload?.after
    if (!before || !after) return
    const scope = resolveUndoScope(ctx, before)
    const em = forkEm(ctx)
    const refund = await requireRefund(em, before.id, scope)
    if (refund.status !== after.status) {
      throw new CrudHttpError(409, { error: 'reservations.errors.refundUndoConflict' })
    }
    const fromStatus = refund.status
    await withAtomicFlush(em, [
      () => {
        refund.status = before.status
        refund.updatedAt = new Date()
      },
    ], { transaction: true, label: 'reservations.refund.transition.undo' })
    await emitRefundSideEffects(ctx, refund, 'updated', true)
    await emitStatusChanged(refund, fromStatus, before.status)
  },
}

registerCommand(requestRefundCommand)
registerCommand(transitionRefundCommand)
