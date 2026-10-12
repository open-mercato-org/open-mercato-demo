import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { registerCommand, type CommandHandler, type CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { emitCrudSideEffects, emitCrudUndoSideEffects } from '@open-mercato/shared/lib/commands/helpers'
import { withAtomicFlush } from '@open-mercato/shared/lib/commands/flush'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { hashForLookup } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Reservation } from '../data/entities'
import {
  DEFAULT_CURRENCY_CODE,
  RESERVATION_ENTITY_ID,
  RESERVATION_RESOURCE_KIND,
  type ReservationStatus,
} from '../data/constants'
import {
  reservationCreateSchema,
  reservationDeleteSchema,
  reservationUpdateSchema,
  type ReservationCreateInput,
  type ReservationDeleteInput,
  type ReservationUpdateInput,
} from '../data/validators'
import { normalizeBookingNumber } from '../lib/bookingNumber'
import { formatAmount } from '../lib/balance'
import { loadCustomerPersonContact, normalizeEmail } from '../lib/customerLookup'
import {
  dateOnly,
  enforceReservationsOptimisticLock,
  forkEm,
  invalidateReservationsCache,
  parseCommandInput,
  requireReservation,
  resolveScope,
  resolveUndoScope,
  type ReservationScope,
} from './shared'

export type ReservationSnapshot = {
  id: string
  tenantId: string
  organizationId: string
  bookingNumber: string
  customerPersonId: string
  customerEmailSnapshot: string | null
  customerEmailHash: string | null
  customerNameSnapshot: string | null
  status: ReservationStatus
  destination: string
  hotelName: string
  roomType: string | null
  boardType: string | null
  departureDate: string
  returnDate: string
  travelersCount: number
  totalPriceAmount: string
  currencyCode: string
  notes: string | null
}

type ReservationUndoPayload = UndoPayload<ReservationSnapshot>

export const reservationCrudEvents: CrudEventsConfig<Reservation> = {
  module: 'reservations',
  entity: 'reservation',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<Reservation>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    bookingNumber: ctx.entity?.bookingNumber ?? null,
    customerPersonId: ctx.entity?.customerPersonId ?? null,
    status: ctx.entity?.status ?? null,
    departureDate: ctx.entity ? dateOnly(ctx.entity.departureDate) : null,
  }),
}

export const reservationCrudIndexer: CrudIndexerConfig<Reservation> = {
  entityType: RESERVATION_ENTITY_ID,
}

export function serializeReservation(reservation: Reservation): ReservationSnapshot {
  return {
    id: reservation.id,
    tenantId: reservation.tenantId,
    organizationId: reservation.organizationId,
    bookingNumber: reservation.bookingNumber,
    customerPersonId: reservation.customerPersonId,
    customerEmailSnapshot: reservation.customerEmailSnapshot ?? null,
    customerEmailHash: reservation.customerEmailHash ?? null,
    customerNameSnapshot: reservation.customerNameSnapshot ?? null,
    status: reservation.status,
    destination: reservation.destination,
    hotelName: reservation.hotelName,
    roomType: reservation.roomType ?? null,
    boardType: reservation.boardType ?? null,
    departureDate: dateOnly(reservation.departureDate),
    returnDate: dateOnly(reservation.returnDate),
    travelersCount: reservation.travelersCount,
    totalPriceAmount: formatAmount(reservation.totalPriceAmount),
    currencyCode: reservation.currencyCode,
    notes: reservation.notes ?? null,
  }
}

function applySnapshot(reservation: Reservation, snapshot: ReservationSnapshot): void {
  reservation.bookingNumber = snapshot.bookingNumber
  reservation.customerPersonId = snapshot.customerPersonId
  reservation.customerEmailSnapshot = snapshot.customerEmailSnapshot
  reservation.customerEmailHash = snapshot.customerEmailHash
  reservation.customerNameSnapshot = snapshot.customerNameSnapshot
  reservation.status = snapshot.status
  reservation.destination = snapshot.destination
  reservation.hotelName = snapshot.hotelName
  reservation.roomType = snapshot.roomType
  reservation.boardType = snapshot.boardType
  reservation.departureDate = snapshot.departureDate
  reservation.returnDate = snapshot.returnDate
  reservation.travelersCount = snapshot.travelersCount
  reservation.totalPriceAmount = snapshot.totalPriceAmount
  reservation.currencyCode = snapshot.currencyCode
  reservation.notes = snapshot.notes
  reservation.updatedAt = new Date()
}

export function computeEmailHash(email: string | null): string | null {
  return email ? hashForLookup(email) : null
}

async function assertBookingNumberAvailable(
  em: EntityManager,
  scope: ReservationScope,
  bookingNumber: string,
  excludeId?: string,
): Promise<void> {
  const existing = await findOneWithDecryption(
    em,
    Reservation,
    {
      bookingNumber,
      organizationId: scope.organizationId,
      tenantId: scope.tenantId,
      deletedAt: null,
      ...(excludeId ? { id: { $ne: excludeId } } : {}),
    } as FilterQuery<Reservation>,
    {},
    scope,
  )
  if (existing) throw new CrudHttpError(409, { error: 'reservations.errors.bookingNumberTaken' })
}

function requireNormalizedBookingNumber(raw: string): string {
  const normalized = normalizeBookingNumber(raw)
  if (!normalized) {
    throw new CrudHttpError(400, {
      error: 'reservations.errors.invalidBookingNumber',
      fieldErrors: { bookingNumber: 'reservations.errors.invalidBookingNumber' },
    })
  }
  return normalized
}

async function resolveCustomerSnapshot(
  ctx: CommandRuntimeContext,
  scope: ReservationScope,
  personId: string,
  input: { customerEmail?: string | null; customerName?: string | null },
): Promise<{ email: string | null; name: string | null }> {
  const explicitEmail = normalizeEmail(input.customerEmail ?? null)
  const explicitName = typeof input.customerName === 'string' && input.customerName.trim() ? input.customerName.trim() : null
  if (explicitEmail && explicitName) return { email: explicitEmail, name: explicitName }
  const contact = await loadCustomerPersonContact(ctx.container, scope, personId).catch(() => null)
  return {
    email: explicitEmail ?? contact?.primaryEmail ?? null,
    name: explicitName ?? contact?.displayName ?? null,
  }
}

async function emitReservationCrud(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  reservation: Reservation,
  undo = false,
): Promise<void> {
  const dataEngine = ctx.container.resolve('dataEngine') as DataEngine
  const identifiers = {
    id: reservation.id,
    tenantId: reservation.tenantId,
    organizationId: reservation.organizationId,
  }
  const emit = undo ? emitCrudUndoSideEffects : emitCrudSideEffects
  await emit({
    dataEngine,
    action,
    entity: reservation,
    identifiers,
    events: reservationCrudEvents,
    indexer: reservationCrudIndexer,
  })
  await invalidateReservationsCache(ctx, RESERVATION_RESOURCE_KIND, identifiers, `reservations.reservation.${action}`)
}

async function buildReservationLog(
  labelKey: string,
  fallback: string,
  resourceId: string,
  snapshots: { before?: unknown; after?: unknown },
) {
  const { translate } = await resolveTranslations()
  const before = (snapshots.before as ReservationSnapshot | null | undefined) ?? null
  const after = (snapshots.after as ReservationSnapshot | null | undefined) ?? null
  return {
    actionLabel: translate(labelKey, fallback),
    resourceKind: RESERVATION_RESOURCE_KIND,
    resourceId,
    tenantId: after?.tenantId ?? before?.tenantId ?? null,
    organizationId: after?.organizationId ?? before?.organizationId ?? null,
    snapshotBefore: before,
    snapshotAfter: after,
    payload: { undo: { before, after } satisfies ReservationUndoPayload },
  }
}

async function loadSnapshot(ctx: CommandRuntimeContext, id: string): Promise<ReservationSnapshot | null> {
  const scope = resolveScope(ctx)
  const em = forkEm(ctx)
  const reservation = await findOneWithDecryption(
    em,
    Reservation,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<Reservation>,
    {},
    scope,
  )
  return reservation ? serializeReservation(reservation) : null
}

const createReservationCommand: CommandHandler<ReservationCreateInput, { reservationId: string }> = {
  id: 'reservations.reservation.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const input = parseCommandInput(reservationCreateSchema, rawInput)
    const scope = resolveScope(ctx)
    const em = forkEm(ctx)
    const bookingNumber = requireNormalizedBookingNumber(input.bookingNumber)
    await assertBookingNumberAvailable(em, scope, bookingNumber)
    const customer = await resolveCustomerSnapshot(ctx, scope, input.customerPersonId, input)
    let reservation!: Reservation
    await withAtomicFlush(em, [
      () => {
        reservation = em.create(Reservation, {
          ...(input.id ? { id: input.id } : {}),
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          bookingNumber,
          customerPersonId: input.customerPersonId,
          customerEmailSnapshot: customer.email,
          customerEmailHash: computeEmailHash(customer.email),
          customerNameSnapshot: customer.name,
          status: input.status ?? 'pending_payment',
          destination: input.destination,
          hotelName: input.hotelName,
          roomType: input.roomType ?? null,
          boardType: input.boardType ?? null,
          departureDate: input.departureDate,
          returnDate: input.returnDate,
          travelersCount: input.travelersCount ?? 1,
          totalPriceAmount: formatAmount(input.totalPriceAmount),
          currencyCode: input.currencyCode ?? DEFAULT_CURRENCY_CODE,
          notes: input.notes ?? null,
        })
        em.persist(reservation)
      },
    ], { transaction: true, label: 'reservations.reservation.create' })
    await emitReservationCrud(ctx, 'created', reservation)
    return { reservationId: reservation.id }
  },
  captureAfter: async (_input, result, ctx) => loadSnapshot(ctx, result.reservationId),
  buildLog: async ({ result, snapshots }) =>
    buildReservationLog('reservations.audit.reservation.create', 'Create reservation', result.reservationId, snapshots),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ReservationUndoPayload>(logEntry)
    const after = payload?.after
    if (!after) return
    const scope = resolveUndoScope(ctx, after)
    const em = forkEm(ctx)
    const reservation = await requireReservation(em, after.id, scope)
    await withAtomicFlush(em, [
      () => {
        reservation.deletedAt = new Date()
      },
    ], { transaction: true, label: 'reservations.reservation.create.undo' })
    await emitReservationCrud(ctx, 'deleted', reservation, true)
  },
}

const updateReservationCommand: CommandHandler<ReservationUpdateInput, { reservationId: string }> = {
  id: 'reservations.reservation.update',
  isUndoable: true,
  prepare: async (rawInput, ctx) => {
    const input = parseCommandInput(reservationUpdateSchema, rawInput)
    return { before: await loadSnapshot(ctx, input.id) }
  },
  async execute(rawInput, ctx) {
    const input = parseCommandInput(reservationUpdateSchema, rawInput)
    const scope = resolveScope(ctx)
    const em = forkEm(ctx)
    const reservation = await requireReservation(em, input.id, scope)
    await enforceReservationsOptimisticLock(ctx, reservation, RESERVATION_RESOURCE_KIND)
    const bookingNumber = input.bookingNumber !== undefined
      ? requireNormalizedBookingNumber(input.bookingNumber)
      : reservation.bookingNumber
    if (bookingNumber !== reservation.bookingNumber) {
      await assertBookingNumberAvailable(em, scope, bookingNumber, reservation.id)
    }
    const departureDate = input.departureDate ?? dateOnly(reservation.departureDate)
    const returnDate = input.returnDate ?? dateOnly(reservation.returnDate)
    if (returnDate < departureDate) {
      throw new CrudHttpError(400, {
        error: 'reservations.errors.returnBeforeDeparture',
        fieldErrors: { returnDate: 'reservations.errors.returnBeforeDeparture' },
      })
    }
    const personChanged = input.customerPersonId !== undefined && input.customerPersonId !== reservation.customerPersonId
    const customer = personChanged || input.customerEmail !== undefined || input.customerName !== undefined
      ? await resolveCustomerSnapshot(ctx, scope, input.customerPersonId ?? reservation.customerPersonId, {
          customerEmail: input.customerEmail !== undefined ? input.customerEmail : personChanged ? null : reservation.customerEmailSnapshot,
          customerName: input.customerName !== undefined ? input.customerName : personChanged ? null : reservation.customerNameSnapshot,
        })
      : null
    await withAtomicFlush(em, [
      () => {
        reservation.bookingNumber = bookingNumber
        if (input.customerPersonId !== undefined) reservation.customerPersonId = input.customerPersonId
        if (customer) {
          reservation.customerEmailSnapshot = customer.email
          reservation.customerEmailHash = computeEmailHash(customer.email)
          reservation.customerNameSnapshot = customer.name
        }
        if (input.status !== undefined) reservation.status = input.status
        if (input.destination !== undefined) reservation.destination = input.destination
        if (input.hotelName !== undefined) reservation.hotelName = input.hotelName
        if (input.roomType !== undefined) reservation.roomType = input.roomType ?? null
        if (input.boardType !== undefined) reservation.boardType = input.boardType ?? null
        reservation.departureDate = departureDate
        reservation.returnDate = returnDate
        if (input.travelersCount !== undefined) reservation.travelersCount = input.travelersCount
        if (input.totalPriceAmount !== undefined) reservation.totalPriceAmount = formatAmount(input.totalPriceAmount)
        if (input.currencyCode !== undefined) reservation.currencyCode = input.currencyCode
        if (input.notes !== undefined) reservation.notes = input.notes ?? null
        reservation.updatedAt = new Date()
      },
    ], { transaction: true, label: 'reservations.reservation.update' })
    await emitReservationCrud(ctx, 'updated', reservation)
    return { reservationId: reservation.id }
  },
  captureAfter: async (_input, result, ctx) => loadSnapshot(ctx, result.reservationId),
  buildLog: async ({ result, snapshots }) =>
    buildReservationLog('reservations.audit.reservation.update', 'Update reservation', result.reservationId, snapshots),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ReservationUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const scope = resolveUndoScope(ctx, before)
    const em = forkEm(ctx)
    const reservation = await requireReservation(em, before.id, scope)
    await withAtomicFlush(em, [
      () => applySnapshot(reservation, before),
    ], { transaction: true, label: 'reservations.reservation.update.undo' })
    await emitReservationCrud(ctx, 'updated', reservation, true)
  },
}

function readDeleteId(rawInput: unknown): string {
  const record = rawInput && typeof rawInput === 'object' ? (rawInput as Record<string, unknown>) : {}
  const body = record.body && typeof record.body === 'object' ? (record.body as Record<string, unknown>) : null
  const query = record.query && typeof record.query === 'object' ? (record.query as Record<string, unknown>) : null
  const candidate = record.id ?? body?.id ?? query?.id
  return parseCommandInput(reservationDeleteSchema, { id: candidate }).id
}

const deleteReservationCommand: CommandHandler<ReservationDeleteInput | Record<string, unknown>, { reservationId: string }> = {
  id: 'reservations.reservation.delete',
  isUndoable: true,
  prepare: async (rawInput, ctx) => ({ before: await loadSnapshot(ctx, readDeleteId(rawInput)) }),
  async execute(rawInput, ctx) {
    const id = readDeleteId(rawInput)
    const scope = resolveScope(ctx)
    const em = forkEm(ctx)
    const reservation = await requireReservation(em, id, scope)
    await enforceReservationsOptimisticLock(ctx, reservation, RESERVATION_RESOURCE_KIND)
    await withAtomicFlush(em, [
      () => {
        reservation.deletedAt = new Date()
      },
    ], { transaction: true, label: 'reservations.reservation.delete' })
    await emitReservationCrud(ctx, 'deleted', reservation)
    return { reservationId: reservation.id }
  },
  buildLog: async ({ result, snapshots }) =>
    buildReservationLog('reservations.audit.reservation.delete', 'Delete reservation', result.reservationId, snapshots),
  undo: async ({ logEntry, ctx }) => {
    const payload = extractUndoPayload<ReservationUndoPayload>(logEntry)
    const before = payload?.before
    if (!before) return
    const scope = resolveUndoScope(ctx, before)
    const em = forkEm(ctx)
    const existing = await findOneWithDecryption(
      em,
      Reservation,
      { id: before.id, tenantId: scope.tenantId, organizationId: scope.organizationId } as FilterQuery<Reservation>,
      {},
      scope,
    )
    let restored!: Reservation
    await withAtomicFlush(em, [
      () => {
        if (existing) {
          existing.deletedAt = null
          applySnapshot(existing, before)
          restored = existing
          return
        }
        restored = em.create(Reservation, {
          ...before,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
        })
        em.persist(restored)
      },
    ], { transaction: true, label: 'reservations.reservation.delete.undo' })
    await emitReservationCrud(ctx, 'created', restored, true)
  },
}

registerCommand(createReservationCommand)
registerCommand(updateReservationCommand)
registerCommand(deleteReservationCommand)
