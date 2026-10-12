import type { EntityManager, FilterQuery, FindOneOptions } from '@mikro-orm/postgresql'
import type { z } from 'zod'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { ensureOrganizationScope, ensureTenantScope } from '@open-mercato/shared/lib/commands/scope'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { invalidateCrudCache } from '@open-mercato/shared/lib/crud/cache'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import {
  Reservation,
  ReservationPayment,
  ReservationRefund,
} from '../data/entities'
import { computeReservationBalance, type ReservationBalance } from '../lib/balance'
import { toDateOnlyString } from '../lib/dates'

export type ReservationScope = {
  tenantId: string
  organizationId: string
}

export function parseCommandInput<T>(schema: z.ZodType<T>, rawInput: unknown): T {
  const result = schema.safeParse(rawInput ?? {})
  if (!result.success) {
    const fieldErrors: Record<string, string> = {}
    for (const issue of result.error.issues) {
      const key = issue.path.join('.')
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message
    }
    throw new CrudHttpError(400, { error: 'reservations.errors.invalidInput', fieldErrors })
  }
  return result.data
}

export function resolveScope(ctx: CommandRuntimeContext): ReservationScope {
  const tenantId = ctx.auth?.tenantId ?? null
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: '[internal] tenant scope required for reservations command' })
  if (!organizationId) throw new CrudHttpError(400, { error: '[internal] organization scope required for reservations command' })
  ensureTenantScope(ctx, tenantId)
  ensureOrganizationScope(ctx, organizationId)
  return { tenantId, organizationId }
}

export function resolveUndoScope(
  ctx: CommandRuntimeContext,
  snapshot: { tenantId?: string | null; organizationId?: string | null } | null | undefined,
): ReservationScope {
  const scope = resolveScope(ctx)
  if (snapshot?.tenantId && snapshot.tenantId !== scope.tenantId) {
    throw new CrudHttpError(403, { error: 'reservations.errors.forbidden' })
  }
  if (snapshot?.organizationId && snapshot.organizationId !== scope.organizationId) {
    const allowed = Array.isArray(ctx.organizationIds) ? ctx.organizationIds : null
    if (allowed && !allowed.includes(snapshot.organizationId)) {
      throw new CrudHttpError(403, { error: 'reservations.errors.forbidden' })
    }
    return { tenantId: scope.tenantId, organizationId: snapshot.organizationId }
  }
  return scope
}

export function forkEm(ctx: CommandRuntimeContext): EntityManager {
  return (ctx.container.resolve('em') as EntityManager).fork()
}

export async function loadReservation(
  em: EntityManager,
  id: string,
  scope: ReservationScope,
  options: FindOneOptions<Reservation> = {},
): Promise<Reservation | null> {
  return findOneWithDecryption(
    em,
    Reservation,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<Reservation>,
    options,
    scope,
  )
}

export async function requireReservation(
  em: EntityManager,
  id: string,
  scope: ReservationScope,
  options: FindOneOptions<Reservation> = {},
): Promise<Reservation> {
  const reservation = await loadReservation(em, id, scope, options)
  if (!reservation) throw new CrudHttpError(404, { error: 'reservations.errors.notFound' })
  return reservation
}

export async function loadReservationPayments(
  em: EntityManager,
  reservationId: string,
  scope: ReservationScope,
): Promise<ReservationPayment[]> {
  return findWithDecryption(
    em,
    ReservationPayment,
    { reservationId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<ReservationPayment>,
    { orderBy: { createdAt: 'asc' } },
    scope,
  )
}

export async function loadReservationRefunds(
  em: EntityManager,
  reservationId: string,
  scope: ReservationScope,
): Promise<ReservationRefund[]> {
  return findWithDecryption(
    em,
    ReservationRefund,
    { reservationId, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<ReservationRefund>,
    { orderBy: { createdAt: 'asc' } },
    scope,
  )
}

export async function loadReservationBalance(
  em: EntityManager,
  reservation: Reservation,
  scope: ReservationScope,
): Promise<ReservationBalance> {
  const [payments, refunds] = await Promise.all([
    loadReservationPayments(em, reservation.id, scope),
    loadReservationRefunds(em, reservation.id, scope),
  ])
  return computeReservationBalance(reservation, payments, refunds)
}

export async function enforceReservationsOptimisticLock(
  ctx: CommandRuntimeContext,
  record: { id: string; updatedAt?: Date | string | null },
  resourceKind: string,
): Promise<void> {
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind,
    resourceId: record.id,
    current: record.updatedAt ?? null,
    request: ctx.request ?? null,
  })
}

export async function invalidateReservationsCache(
  ctx: CommandRuntimeContext,
  resource: string,
  identifiers: { id: string; tenantId: string; organizationId: string },
  reason: string,
): Promise<void> {
  await invalidateCrudCache(ctx.container, resource, identifiers, identifiers.tenantId, reason)
}

export function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function toDateOrNull(value: string | null | undefined): Date | null {
  if (!value) return null
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function dateOnly(value: unknown): string {
  return toDateOnlyString(value) ?? ''
}
