"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { DEPARTURE_SOON_DAYS } from '../data/constants'

const RESERVATION_STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  pending_payment: 'warning',
  confirmed: 'success',
  cancelled: 'neutral',
  completed: 'info',
}

const PAYMENT_STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  pending: 'warning',
  booked: 'success',
  failed: 'error',
}

const REFUND_STATUS_VARIANTS: Record<string, StatusBadgeVariant> = {
  requested: 'info',
  approved: 'warning',
  executed: 'success',
  rejected: 'error',
  cancelled: 'neutral',
}

export function ReservationStatusBadge({ status }: { status: string }) {
  const t = useT()
  return (
    <StatusBadge variant={RESERVATION_STATUS_VARIANTS[status] ?? 'neutral'} dot>
      {t(`reservations.status.${status}`, status)}
    </StatusBadge>
  )
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const t = useT()
  return (
    <StatusBadge variant={PAYMENT_STATUS_VARIANTS[status] ?? 'neutral'} dot>
      {t(`reservations.paymentStatus.${status}`, status)}
    </StatusBadge>
  )
}

export function RefundStatusBadge({ status }: { status: string }) {
  const t = useT()
  return (
    <StatusBadge variant={REFUND_STATUS_VARIANTS[status] ?? 'neutral'} dot>
      {t(`reservations.refundStatus.${status}`, status)}
    </StatusBadge>
  )
}

export function DepartureBadge({ daysToDeparture }: { daysToDeparture: number | null | undefined }) {
  const t = useT()
  if (daysToDeparture === null || daysToDeparture === undefined) return null
  if (daysToDeparture < 0) {
    return (
      <StatusBadge variant="neutral">
        {t('reservations.departure.past', 'Departed')}
      </StatusBadge>
    )
  }
  const label = daysToDeparture === 0
    ? t('reservations.departure.today', 'Today')
    : t('reservations.departure.inDays', 'In {count} days', { count: daysToDeparture })
  return (
    <StatusBadge variant={daysToDeparture <= DEPARTURE_SOON_DAYS ? 'warning' : 'neutral'}>
      {label}
    </StatusBadge>
  )
}

export function formatMoney(amount: number | string | null | undefined, currencyCode: string, locale?: string): string {
  const numeric = typeof amount === 'number' ? amount : Number(amount ?? 0)
  const value = Number.isFinite(numeric) ? numeric : 0
  try {
    return new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode }).format(value)
  } catch {
    return `${value.toFixed(2)} ${currencyCode}`
  }
}

export function BalanceChip({
  balance,
  currencyCode,
}: {
  balance: { outstanding?: number; overpayment?: number } | null | undefined
  currencyCode: string
}) {
  const t = useT()
  if (!balance) return null
  if ((balance.overpayment ?? 0) > 0) {
    return (
      <StatusBadge variant="info">
        {t('reservations.balance.chip.overpaid', 'Overpaid {amount}', { amount: formatMoney(balance.overpayment, currencyCode) })}
      </StatusBadge>
    )
  }
  if ((balance.outstanding ?? 0) > 0) {
    return (
      <StatusBadge variant="warning">
        {t('reservations.balance.chip.due', 'Due {amount}', { amount: formatMoney(balance.outstanding, currencyCode) })}
      </StatusBadge>
    )
  }
  return (
    <StatusBadge variant="success">
      {t('reservations.balance.chip.settled', 'Paid in full')}
    </StatusBadge>
  )
}
