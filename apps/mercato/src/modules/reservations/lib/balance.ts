import { REFUND_COUNTED_STATUSES, type PaymentStatus, type RefundStatus } from '../data/constants'
import { computeDaysToDeparture } from './dates'

export type BalancePaymentInput = {
  amount: string | number
  status: PaymentStatus | string
}

export type BalanceRefundInput = {
  amount: string | number
  status: RefundStatus | string
}

export type BalanceReservationInput = {
  totalPriceAmount: string | number
  currencyCode: string
  departureDate: unknown
}

export type ReservationBalance = {
  totalPrice: number
  paidTotal: number
  pendingPaymentsTotal: number
  refundedTotal: number
  outstanding: number
  overpayment: number
  currencyCode: string
  daysToDeparture: number | null
}

export function toCents(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return 0
  return Math.round(numeric * 100)
}

export function fromCents(cents: number): number {
  return Math.round(cents) / 100
}

export function formatAmount(value: string | number): string {
  return fromCents(toCents(value)).toFixed(2)
}

function sumCents<T extends { amount: string | number }>(rows: ReadonlyArray<T>, predicate: (row: T) => boolean): number {
  return rows.reduce((total, row) => (predicate(row) ? total + toCents(row.amount) : total), 0)
}

export function computeBalanceCents(
  reservation: Pick<BalanceReservationInput, 'totalPriceAmount'>,
  payments: ReadonlyArray<BalancePaymentInput>,
  refunds: ReadonlyArray<BalanceRefundInput>,
): { total: number; paid: number; pending: number; refunded: number; outstanding: number; overpayment: number } {
  const total = toCents(reservation.totalPriceAmount)
  const paid = sumCents(payments, (payment) => payment.status === 'booked')
  const pending = sumCents(payments, (payment) => payment.status === 'pending')
  const refunded = sumCents(refunds, (refund) => REFUND_COUNTED_STATUSES.includes(refund.status as RefundStatus))
  const net = paid - refunded
  return {
    total,
    paid,
    pending,
    refunded,
    outstanding: Math.max(0, total - net),
    overpayment: Math.max(0, net - total),
  }
}

export function computeReservationBalance(
  reservation: BalanceReservationInput,
  payments: ReadonlyArray<BalancePaymentInput>,
  refunds: ReadonlyArray<BalanceRefundInput>,
  options: { now?: Date; timeZone?: string } = {},
): ReservationBalance {
  const cents = computeBalanceCents(reservation, payments, refunds)
  return {
    totalPrice: fromCents(cents.total),
    paidTotal: fromCents(cents.paid),
    pendingPaymentsTotal: fromCents(cents.pending),
    refundedTotal: fromCents(cents.refunded),
    outstanding: fromCents(cents.outstanding),
    overpayment: fromCents(cents.overpayment),
    currencyCode: reservation.currencyCode,
    daysToDeparture: computeDaysToDeparture(reservation.departureDate, options.now, options.timeZone),
  }
}

export function checkRefundWithinOverpayment(
  requestedAmount: string | number,
  overpaymentCents: number,
): { ok: true } | { ok: false; overpayment: number } {
  const requested = toCents(requestedAmount)
  if (requested <= 0 || requested > overpaymentCents) {
    return { ok: false, overpayment: fromCents(overpaymentCents) }
  }
  return { ok: true }
}
