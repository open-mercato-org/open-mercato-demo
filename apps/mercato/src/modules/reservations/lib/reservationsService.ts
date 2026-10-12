import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Reservation, ReservationPayment, ReservationRefund } from '../data/entities'
import { MAX_CUSTOMER_RESERVATIONS } from '../data/constants'
import { computeReservationBalance, formatAmount, type ReservationBalance } from './balance'
import { normalizeBookingNumber } from './bookingNumber'
import { normalizeEmail } from './customerLookup'
import { computeDaysToDeparture, toDateOnlyString } from './dates'

export type ReservationsScope = {
  tenantId: string
  organizationId: string
}

export type ReservationDto = {
  id: string
  bookingNumber: string
  customerPersonId: string
  customerEmail: string | null
  customerName: string | null
  status: string
  destination: string
  hotelName: string
  roomType: string | null
  boardType: string | null
  departureDate: string | null
  returnDate: string | null
  travelersCount: number
  totalPriceAmount: string
  currencyCode: string
  notes: string | null
  daysToDeparture: number | null
  updatedAt: string | null
}

export type PaymentDto = {
  id: string
  reservationId: string
  amount: string
  currencyCode: string
  status: string
  method: string
  paidAt: string | null
  bookedAt: string | null
  externalReference: string | null
  updatedAt: string | null
}

export type RefundDto = {
  id: string
  reservationId: string
  amount: string
  currencyCode: string
  bankAccountLast4: string
  reason: string | null
  status: string
  sourceType: string | null
  sourceRef: string | null
  relatedTicketId: string | null
  createdAt: string | null
  updatedAt: string | null
}

export type ReservationDetails = {
  reservation: ReservationDto
  payments: PaymentDto[]
  refunds: RefundDto[]
  balance: ReservationBalance
}

export type ReservationSummaryDto = Pick<
  ReservationDto,
  'id' | 'bookingNumber' | 'destination' | 'hotelName' | 'departureDate' | 'returnDate' | 'status' | 'daysToDeparture'
>

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function toReservationDto(reservation: Reservation, now: Date = new Date()): ReservationDto {
  return {
    id: reservation.id,
    bookingNumber: reservation.bookingNumber,
    customerPersonId: reservation.customerPersonId,
    customerEmail: reservation.customerEmailSnapshot ?? null,
    customerName: reservation.customerNameSnapshot ?? null,
    status: reservation.status,
    destination: reservation.destination,
    hotelName: reservation.hotelName,
    roomType: reservation.roomType ?? null,
    boardType: reservation.boardType ?? null,
    departureDate: toDateOnlyString(reservation.departureDate),
    returnDate: toDateOnlyString(reservation.returnDate),
    travelersCount: reservation.travelersCount,
    totalPriceAmount: formatAmount(reservation.totalPriceAmount),
    currencyCode: reservation.currencyCode,
    notes: reservation.notes ?? null,
    daysToDeparture: computeDaysToDeparture(reservation.departureDate, now),
    updatedAt: iso(reservation.updatedAt),
  }
}

export function toReservationSummary(reservation: Reservation, now: Date = new Date()): ReservationSummaryDto {
  return {
    id: reservation.id,
    bookingNumber: reservation.bookingNumber,
    destination: reservation.destination,
    hotelName: reservation.hotelName,
    departureDate: toDateOnlyString(reservation.departureDate),
    returnDate: toDateOnlyString(reservation.returnDate),
    status: reservation.status,
    daysToDeparture: computeDaysToDeparture(reservation.departureDate, now),
  }
}

export function toPaymentDto(payment: ReservationPayment): PaymentDto {
  return {
    id: payment.id,
    reservationId: payment.reservationId,
    amount: formatAmount(payment.amount),
    currencyCode: payment.currencyCode,
    status: payment.status,
    method: payment.method,
    paidAt: iso(payment.paidAt),
    bookedAt: iso(payment.bookedAt),
    externalReference: payment.externalReference ?? null,
    updatedAt: iso(payment.updatedAt),
  }
}

export function toRefundDto(refund: ReservationRefund): RefundDto {
  return {
    id: refund.id,
    reservationId: refund.reservationId,
    amount: formatAmount(refund.amount),
    currencyCode: refund.currencyCode,
    bankAccountLast4: refund.bankAccountLast4,
    reason: refund.reason ?? null,
    status: refund.status,
    sourceType: refund.sourceType ?? null,
    sourceRef: refund.sourceRef ?? null,
    relatedTicketId: refund.relatedTicketId ?? null,
    createdAt: iso(refund.createdAt),
    updatedAt: iso(refund.updatedAt),
  }
}

function scopedWhere<T>(scope: ReservationsScope, extra: Record<string, unknown>): FilterQuery<T> {
  return {
    ...extra,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    deletedAt: null,
  } as FilterQuery<T>
}

export function createReservationsService(em: EntityManager) {
  async function findByBookingNumber(scope: ReservationsScope, rawBookingNumber: string): Promise<Reservation | null> {
    const bookingNumber = normalizeBookingNumber(rawBookingNumber)
    if (!bookingNumber) return null
    return findOneWithDecryption(em.fork(), Reservation, scopedWhere<Reservation>(scope, { bookingNumber }), {}, scope)
  }

  async function findById(scope: ReservationsScope, id: string): Promise<Reservation | null> {
    return findOneWithDecryption(em.fork(), Reservation, scopedWhere<Reservation>(scope, { id }), {}, scope)
  }

  async function getDetails(scope: ReservationsScope, id: string, now: Date = new Date()): Promise<ReservationDetails | null> {
    const fork = em.fork()
    const reservation = await findOneWithDecryption(fork, Reservation, scopedWhere<Reservation>(scope, { id }), {}, scope)
    if (!reservation) return null
    const [payments, refunds] = await Promise.all([
      findWithDecryption(fork, ReservationPayment, scopedWhere<ReservationPayment>(scope, { reservationId: id }), { orderBy: { createdAt: 'asc' } }, scope),
      findWithDecryption(fork, ReservationRefund, scopedWhere<ReservationRefund>(scope, { reservationId: id }), { orderBy: { createdAt: 'asc' } }, scope),
    ])
    return {
      reservation: toReservationDto(reservation, now),
      payments: payments.map(toPaymentDto),
      refunds: refunds.map(toRefundDto),
      balance: computeReservationBalance(reservation, payments, refunds, { now }),
    }
  }

  async function listForCustomerPerson(scope: ReservationsScope, customerPersonId: string): Promise<Reservation[]> {
    return findWithDecryption(
      em.fork(),
      Reservation,
      scopedWhere<Reservation>(scope, { customerPersonId }),
      { orderBy: { departureDate: 'asc' }, limit: MAX_CUSTOMER_RESERVATIONS },
      scope,
    )
  }

  async function listForEmail(scope: ReservationsScope, email: string): Promise<Reservation[]> {
    const normalized = normalizeEmail(email)
    if (!normalized) return []
    return findWithDecryption(
      em.fork(),
      Reservation,
      scopedWhere<Reservation>(scope, { customerEmailHash: { $in: lookupHashCandidates(normalized) } }),
      { orderBy: { departureDate: 'asc' }, limit: MAX_CUSTOMER_RESERVATIONS },
      scope,
    )
  }

  return { findByBookingNumber, findById, getDetails, listForCustomerPerson, listForEmail }
}

export type ReservationsService = ReturnType<typeof createReservationsService>
