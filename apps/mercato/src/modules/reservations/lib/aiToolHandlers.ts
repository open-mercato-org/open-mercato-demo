import { z } from 'zod'
import type { Reservation } from '../data/entities'
import { MAX_CUSTOMER_RESERVATIONS } from '../data/constants'
import { normalizeEmail, type CustomerPersonContact } from './customerLookup'
import {
  toReservationDto,
  toReservationSummary,
  type ReservationDetails,
  type ReservationDto,
  type ReservationSummaryDto,
  type ReservationsScope,
} from './reservationsService'

export const findByBookingNumberInputSchema = z.object({
  bookingNumber: z.string().trim().min(1).max(64),
  senderEmail: z.string().trim().email().max(320).optional(),
})

export const listForCustomerInputSchema = z
  .object({
    customerPersonId: z.string().uuid().optional(),
    email: z.string().trim().email().max(320).optional(),
  })
  .refine((value) => Boolean(value.customerPersonId || value.email), {
    message: 'customerPersonId or email is required',
  })

export const getDetailsInputSchema = z.object({
  reservationId: z.string().uuid(),
})

export type OwnerMatch = 'match' | 'mismatch' | 'unknown'

export type FindByBookingNumberResult = {
  found: boolean
  ownerMatch: OwnerMatch
  reservation?: ReservationDto
}

export type ListForCustomerResult = {
  customerPersonId?: string
  reservations: ReservationSummaryDto[]
}

export type GetDetailsResult = ({ found: true } & ReservationDetails) | { found: false }

export type ReservationsToolDeps = {
  findByBookingNumber: (scope: ReservationsScope, bookingNumber: string) => Promise<Reservation | null>
  listForCustomerPerson: (scope: ReservationsScope, customerPersonId: string) => Promise<Reservation[]>
  listForEmail: (scope: ReservationsScope, email: string) => Promise<Reservation[]>
  getDetails: (scope: ReservationsScope, reservationId: string) => Promise<ReservationDetails | null>
  loadPersonContact: (scope: ReservationsScope, personId: string) => Promise<CustomerPersonContact | null>
  now?: () => Date
}

export function resolveOwnerMatch(
  senderEmail: string | null | undefined,
  candidates: ReadonlyArray<string | null | undefined>,
): OwnerMatch {
  const sender = normalizeEmail(senderEmail ?? null)
  if (!sender) return 'unknown'
  const known = candidates.map((candidate) => normalizeEmail(candidate ?? null)).filter((value): value is string => Boolean(value))
  if (known.length === 0) return 'unknown'
  return known.includes(sender) ? 'match' : 'mismatch'
}

export async function findReservationByBookingNumber(
  deps: ReservationsToolDeps,
  scope: ReservationsScope,
  rawInput: unknown,
): Promise<FindByBookingNumberResult> {
  const input = findByBookingNumberInputSchema.parse(rawInput)
  const reservation = await deps.findByBookingNumber(scope, input.bookingNumber)
  if (!reservation) return { found: false, ownerMatch: 'unknown' }
  if (!input.senderEmail) {
    return { found: true, ownerMatch: 'unknown', reservation: toReservationDto(reservation, deps.now?.()) }
  }
  const contact = await deps.loadPersonContact(scope, reservation.customerPersonId).catch(() => null)
  const ownerMatch = resolveOwnerMatch(input.senderEmail, [
    reservation.customerEmailSnapshot ?? null,
    contact?.primaryEmail ?? null,
  ])
  if (ownerMatch === 'match') {
    return { found: true, ownerMatch, reservation: toReservationDto(reservation, deps.now?.()) }
  }
  return { found: true, ownerMatch: ownerMatch === 'unknown' ? 'unknown' : 'mismatch' }
}

export async function listReservationsForCustomer(
  deps: ReservationsToolDeps,
  scope: ReservationsScope,
  rawInput: unknown,
): Promise<ListForCustomerResult> {
  const input = listForCustomerInputSchema.parse(rawInput)
  const now = deps.now?.()
  const reservations = input.customerPersonId
    ? await deps.listForCustomerPerson(scope, input.customerPersonId)
    : await deps.listForEmail(scope, input.email ?? '')
  const personIds = Array.from(new Set(reservations.map((reservation) => reservation.customerPersonId)))
  const customerPersonId = input.customerPersonId ?? (personIds.length === 1 ? personIds[0] : undefined)
  return {
    ...(customerPersonId ? { customerPersonId } : {}),
    reservations: reservations.slice(0, MAX_CUSTOMER_RESERVATIONS).map((reservation) => toReservationSummary(reservation, now)),
  }
}

export async function getReservationDetails(
  deps: ReservationsToolDeps,
  scope: ReservationsScope,
  rawInput: unknown,
): Promise<GetDetailsResult> {
  const input = getDetailsInputSchema.parse(rawInput)
  const details = await deps.getDetails(scope, input.reservationId)
  if (!details) return { found: false }
  return { found: true, ...details }
}
