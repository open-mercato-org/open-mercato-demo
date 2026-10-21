import type { FilterQuery } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { ReservationPayment } from '../data/entities'
import {
  RESERVATION_PAYMENT_ENTITY_ID,
  RESERVATION_PAYMENT_RESOURCE_KIND,
  RESERVATION_RESOURCE_KIND,
  type PaymentMethod,
  type PaymentStatus,
} from '../data/constants'
import { paymentRecordSchema, type PaymentRecordInput } from '../data/validators'
import { emitReservationsEvent } from '../events'
import { formatAmount } from '../lib/balance'
import {
  forkEm,
  invalidateReservationsCache,
  parseCommandInput,
  requireReservation,
  resolveScope,
  resolveUndoScope,
  toIso,
} from './shared'

export type PaymentSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  reservationId: string
  amount: string
  currencyCode: string
  status: PaymentStatus
  method: PaymentMethod
  paidAt: string | null
  bookedAt: string | null
  externalReference: string | null
}

export function serializePayment(payment: ReservationPayment): PaymentSnapshot {
  return {
    id: payment.id,
    tenantId: payment.tenantId,
    organizationId: payment.organizationId,
    reservationId: payment.reservationId,
    amount: formatAmount(payment.amount),
    currencyCode: payment.currencyCode,
    status: payment.status,
    method: payment.method,
    paidAt: toIso(payment.paidAt),
    bookedAt: toIso(payment.bookedAt),
    externalReference: payment.externalReference ?? null,
  }
}

async function emitPaymentSideEffects(
  ctx: CommandRuntimeContext,
  payment: ReservationPayment,
  action: 'created' | 'deleted',
  undo: boolean,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  const identifiers = { id: payment.id, tenantId: payment.tenantId, organizationId: payment.organizationId }
  const emit = undo ? emitCrudUndoSideEffects : emitCrudSideEffects
  await emit({
    dataEngine,
    action,
    entity: payment,
    identifiers,
    indexer: { entityType: RESERVATION_PAYMENT_ENTITY_ID },
  })
  await invalidateReservationsCache(ctx, RESERVATION_PAYMENT_RESOURCE_KIND, identifiers, `reservations.payment.${action}`)
  await invalidateReservationsCache(
    ctx,
    RESERVATION_RESOURCE_KIND,
    { id: payment.reservationId, tenantId: payment.tenantId, organizationId: payment.organizationId },
    `reservations.payment.${action}`,
  )
}

const recordPaymentCommand: CommandHandler<PaymentRecordInput, { paymentId: string; reservationId: string }> = {
  id: 'reservations.payment.record',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = parseCommandInput(paymentRecordSchema, rawInput)
    const scope = resolveScope(ctx, rawInput)
    const em = forkEm(ctx)
    const reservation = await requireReservation(em, input.reservationId, scope)
    const currencyCode = input.currencyCode ?? reservation.currencyCode
    if (currencyCode !== reservation.currencyCode) {
      throw new CrudHttpError(422, {
        error: 'reservations.errors.currencyMismatch',
        code: 'currency_mismatch',
        fieldErrors: { currencyCode: 'reservations.errors.currencyMismatch' },
      })
    }
    const status: PaymentStatus = input.status ?? 'booked'
    const now = new Date()
    let payment!: ReservationPayment
    await withAtomicFlush(em, [
      () => {
        payment = em.create(ReservationPayment, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          reservationId: reservation.id,
          amount: formatAmount(input.amount),
          currencyCode,
          status,
          method: input.method ?? 'transfer',
          paidAt: input.paidAt ?? now,
          bookedAt: status === 'booked' ? input.bookedAt ?? now : input.bookedAt ?? null,
          externalReference: input.externalReference ?? null,
        })
        em.persist(payment)
      },
    ], { transaction: true, label: 'reservations.payment.record' })
    await emitPaymentSideEffects(ctx, payment, 'created', false)
    await emitReservationsEvent('reservations.payment.recorded', {
      id: payment.id,
      reservationId: reservation.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      amount: payment.amount,
      currencyCode: payment.currencyCode,
      status: payment.status,
    }, { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId })
    return { paymentId: payment.id, reservationId: reservation.id }
  },
  captureAfter: async (rawInput, result, ctx) => {
    const scope = resolveScope(ctx, rawInput)
    const em = forkEm(ctx)
    const payment = await findOneWithDecryption(
      em,
      ReservationPayment,
      { id: result.paymentId, tenantId: scope.tenantId, organizationId: scope.organizationId } as FilterQuery<ReservationPayment>,
      {},
      scope,
    )
    return payment ? serializePayment(payment) : null
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const after = (snapshots.after as PaymentSnapshot | null | undefined) ?? null
    return {
      actionLabel: translate('reservations.audit.payment.record', 'Record reservation payment'),
      resourceKind: RESERVATION_PAYMENT_RESOURCE_KIND,
      resourceId: result.paymentId,
      parentResourceKind: 'reservations.reservation',
      parentResourceId: result.reservationId,
      tenantId: after?.tenantId ?? null,
      organizationId: after?.organizationId ?? null,
      snapshotAfter: after,
      payload: { undo: { before: null, after } satisfies UndoPayload<PaymentSnapshot> },
    }
  },
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<UndoPayload<PaymentSnapshot>>(logEntry)
    const after = payload?.after
    if (!after) return
    const scope = resolveUndoScope(ctx, after)
    const em = forkEm(ctx)
    const payment = await findOneWithDecryption(
      em,
      ReservationPayment,
      { id: after.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<ReservationPayment>,
      {},
      scope,
    )
    if (!payment) return
    await withAtomicFlush(em, [
      () => {
        payment.deletedAt = new Date()
      },
    ], { transaction: true, label: 'reservations.payment.record.undo' })
    await emitPaymentSideEffects(ctx, payment, 'deleted', true)
  },
}

registerCommand(recordPaymentCommand)
