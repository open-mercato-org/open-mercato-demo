"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { FormHeader } from '@open-mercato/ui/backend/forms'
import { ErrorMessage, LoadingMessage, RecordNotFoundState } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { apiCallOrThrow, readApiResultOrThrow, withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { withFlash } from '@open-mercato/ui/backend/utils/flash'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useInjectionWidgets } from '@open-mercato/ui/backend/injection/InjectionSpot'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@open-mercato/ui/primitives/tabs'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import extensionPoints from '../extension-points'
import {
  REFUND_TRANSITIONS,
  RESERVATION_RESOURCE_KIND,
  type RefundStatus,
  type RefundTransitionTarget,
} from '../data/constants'
import {
  BalanceChip,
  DepartureBadge,
  PaymentStatusBadge,
  RefundStatusBadge,
  ReservationStatusBadge,
  formatMoney,
} from './ReservationBadges'
import { RefundRequestDialog } from './RefundRequestDialog'
import { RecordPaymentDialog } from './RecordPaymentDialog'
import type {
  ListResponse,
  PaymentListItem,
  RefundListItem,
  ReservationBalanceDto,
  ReservationListItem,
} from './types'

const LIST_HREF = '/backend/reservations'
const CONTEXT_ID = 'reservations:detail'
const LOAD_FAILED = 'load_failed'

type DetailState = {
  reservation: ReservationListItem
  payments: PaymentListItem[]
  refunds: RefundListItem[]
  balance: ReservationBalanceDto
}

function formatDateTime(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString()
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  )
}

function Section({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function ReservationDetail({ id }: { id: string }) {
  const t = useT()
  const router = useRouter()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [state, setState] = React.useState<DetailState | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [notFound, setNotFound] = React.useState(false)
  const [refundOpen, setRefundOpen] = React.useState(false)
  const [paymentOpen, setPaymentOpen] = React.useState(false)
  const [pendingRefundId, setPendingRefundId] = React.useState<string | null>(null)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const injectionContext = React.useMemo(() => ({
    formId: CONTEXT_ID,
    resourceKind: RESERVATION_RESOURCE_KIND,
    resourceId: id,
    reservationId: id,
    reservation: state?.reservation ?? null,
    retryLastMutation,
  }), [id, retryLastMutation, state?.reservation])

  const { widgets: tabWidgets } = useInjectionWidgets(extensionPoints.hosts.reservationTabs.spotId, {
    context: injectionContext,
    triggerOnLoad: true,
  })

  const injectedTabs = React.useMemo(
    () => (tabWidgets ?? [])
      .filter((widget) => (widget.placement?.kind ?? 'tab') === 'tab')
      .map((widget) => ({
        id: widget.placement?.groupId ?? widget.widgetId,
        label: widget.placement?.groupLabel
          ? t(widget.placement.groupLabel, widget.placement.groupLabel)
          : widget.module.metadata.title ?? widget.widgetId,
        priority: typeof widget.placement?.priority === 'number' ? widget.placement.priority : 0,
        widget,
      }))
      .sort((left, right) => right.priority - left.priority),
    [t, tabWidgets],
  )
  const [activeTab, setActiveTab] = React.useState<string>('')
  const resolvedActiveTab = injectedTabs.some((tab) => tab.id === activeTab) ? activeTab : injectedTabs[0]?.id ?? ''

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const list = await fetchCrudList<ReservationListItem>('reservations/reservations', { ids: id, pageSize: 1 })
      const reservation = list?.items?.[0]
      if (!reservation) {
        setNotFound(true)
        return
      }
      const [payments, refunds, balance] = await Promise.all([
        fetchCrudList<PaymentListItem>('reservations/payments', { reservationId: id, pageSize: 100 }),
        fetchCrudList<RefundListItem>('reservations/refunds', { reservationId: id, pageSize: 100 }),
        readApiResultOrThrow<ReservationBalanceDto>(`/api/reservations/reservations/${encodeURIComponent(id)}/balance`),
      ])
      setState({
        reservation,
        payments: (payments as ListResponse<PaymentListItem>).items ?? [],
        refunds: (refunds as ListResponse<RefundListItem>).items ?? [],
        balance,
      })
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : LOAD_FAILED)
    } finally {
      setLoading(false)
    }
  }, [id])

  React.useEffect(() => {
    setLoading(true)
    void load()
  }, [load])

  useAppEvent('reservations.*', (event) => {
    const payload = event.payload as { id?: unknown; reservationId?: unknown } | undefined
    if (payload?.id === id || payload?.reservationId === id) void load()
  })

  const handleDelete = React.useCallback(async () => {
    if (!state) return
    const confirmed = await confirm({
      title: t('reservations.list.confirmDelete', 'Delete reservation {bookingNumber}?', { bookingNumber: state.reservation.bookingNumber }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(state.reservation.updatedAt),
          () => deleteCrud('reservations/reservations', id),
        ),
        mutationPayload: { id },
        context: { formId: CONTEXT_ID, resourceKind: 'reservations.reservation', resourceId: id, retryLastMutation },
      })
      router.push(withFlash(LIST_HREF, t('reservations.flash.deleted', 'Reservation deleted'), 'success'))
    } catch (err) {
      if (surfaceRecordConflict(err, t)) {
        void load()
        return
      }
      flash(err instanceof Error && err.message ? err.message : t('reservations.errors.deleteFailed', 'Failed to delete reservation'), 'error')
    }
  }, [confirm, id, load, retryLastMutation, router, runMutation, state, t])

  const handleRefundTransition = React.useCallback(async (refund: RefundListItem, to: RefundTransitionTarget) => {
    setPendingRefundId(refund.id)
    try {
      const body = { to }
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(refund.updatedAt),
          () => apiCallOrThrow(`/api/reservations/refunds/${encodeURIComponent(refund.id)}/transition`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          }, { errorMessage: t('reservations.refund.errors.transitionFailed', 'Failed to update the refund') }),
        ),
        mutationPayload: { id: refund.id, ...body },
        context: { formId: CONTEXT_ID, resourceKind: 'reservations.refund', resourceId: refund.id, retryLastMutation },
      })
      flash(t(`reservations.refund.flash.${to}`, 'Refund updated'), 'success')
      await load()
    } catch (err) {
      if (surfaceRecordConflict(err, t)) {
        await load()
        return
      }
      flash(err instanceof Error && err.message ? err.message : t('reservations.refund.errors.transitionFailed', 'Failed to update the refund'), 'error')
    } finally {
      setPendingRefundId(null)
    }
  }, [load, retryLastMutation, runMutation, t])

  if (loading) return <LoadingMessage label={t('reservations.detail.loading', 'Loading reservation…')} />
  if (notFound) {
    return (
      <RecordNotFoundState
        label={t('reservations.errors.notFound', 'Reservation not found')}
        backHref={LIST_HREF}
        backLabel={t('reservations.detail.back', 'Back to reservations')}
      />
    )
  }
  if (error || !state) {
    const label = error && error !== LOAD_FAILED ? error : t('reservations.errors.loadFailed', 'Failed to load reservation')
    return <ErrorMessage label={label} />
  }

  const { reservation, payments, refunds, balance } = state
  const currency = reservation.currencyCode
  const canRequestRefund = balance.overpayment > 0

  return (
    <div className="space-y-4">
      <FormHeader
        mode="detail"
        backHref={LIST_HREF}
        backLabel={t('reservations.detail.back', 'Back to reservations')}
        entityTypeLabel={t('reservations.detail.entityLabel', 'Reservation')}
        title={reservation.bookingNumber}
        subtitle={`${reservation.destination} · ${reservation.hotelName}`}
        statusBadge={(
          <div className="flex flex-wrap items-center gap-2">
            <ReservationStatusBadge status={reservation.status} />
            <DepartureBadge daysToDeparture={reservation.daysToDeparture} />
            <BalanceChip balance={balance} currencyCode={currency} />
          </div>
        )}
        menuActions={[
          { id: 'edit', label: t('reservations.detail.actions.edit', 'Edit'), onSelect: () => router.push(`/backend/reservations/${id}/edit`) },
          { id: 'record-payment', label: t('reservations.detail.actions.recordPayment', 'Record payment'), onSelect: () => setPaymentOpen(true) },
          {
            id: 'request-refund',
            label: t('reservations.detail.actions.requestRefund', 'Request refund'),
            onSelect: () => setRefundOpen(true),
            disabled: !canRequestRefund,
          },
        ]}
        onDelete={handleDelete}
        deleteLabel={t('reservations.detail.actions.delete', 'Delete')}
      />

      <div className="grid gap-4 lg:grid-cols-3">
        <Section title={t('reservations.detail.sections.overview', 'Overview')}>
          <dl className="grid grid-cols-2 gap-3">
            <Field label={t('reservations.detail.fields.customer', 'Customer')}>
              <Link className="text-primary hover:underline" href={`/backend/customers/people-v2/${reservation.customerPersonId}`}>
                {reservation.customerName ?? reservation.customerPersonId}
              </Link>
            </Field>
            <Field label={t('reservations.detail.fields.customerEmail', 'Email at booking')}>{reservation.customerEmail ?? '—'}</Field>
            <Field label={t('reservations.detail.fields.departure', 'Departure')}>{reservation.departureDate ?? '—'}</Field>
            <Field label={t('reservations.detail.fields.return', 'Return')}>{reservation.returnDate ?? '—'}</Field>
            <Field label={t('reservations.detail.fields.room', 'Room')}>{reservation.roomType ?? '—'}</Field>
            <Field label={t('reservations.detail.fields.board', 'Board')}>{reservation.boardType ?? '—'}</Field>
            <Field label={t('reservations.detail.fields.travelers', 'Travelers')}>{reservation.travelersCount}</Field>
            <Field label={t('reservations.detail.fields.notes', 'Notes')}>{reservation.notes ?? '—'}</Field>
          </dl>
        </Section>

        <Section title={t('reservations.detail.sections.balance', 'Balance')}>
          <dl className="grid grid-cols-2 gap-3">
            <Field label={t('reservations.balance.totalPrice', 'Total price')}>{formatMoney(balance.totalPrice, currency)}</Field>
            <Field label={t('reservations.balance.paid', 'Paid (booked)')}>{formatMoney(balance.paidTotal, currency)}</Field>
            <Field label={t('reservations.balance.pending', 'Pending payments')}>{formatMoney(balance.pendingPaymentsTotal, currency)}</Field>
            <Field label={t('reservations.balance.refunded', 'Refunds')}>{formatMoney(balance.refundedTotal, currency)}</Field>
            <Field label={t('reservations.balance.outstanding', 'Outstanding')}>{formatMoney(balance.outstanding, currency)}</Field>
            <Field label={t('reservations.balance.overpayment', 'Overpayment')}>
              <span data-testid="reservation-overpayment">{formatMoney(balance.overpayment, currency)}</span>
            </Field>
          </dl>
        </Section>

        <Section
          title={t('reservations.detail.sections.payments', 'Payments')}
          actions={(
            <Button type="button" size="sm" variant="outline" onClick={() => setPaymentOpen(true)}>
              {t('reservations.detail.actions.recordPayment', 'Record payment')}
            </Button>
          )}
        >
          {payments.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('reservations.detail.payments.empty', 'No payments yet.')}</p>
          ) : (
            <ul className="space-y-2">
              {payments.map((payment) => (
                <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{formatMoney(payment.amount, payment.currencyCode)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t(`reservations.paymentMethod.${payment.method}`, payment.method)} · {formatDateTime(payment.paidAt)}
                      {payment.externalReference ? ` · ${payment.externalReference}` : ''}
                    </div>
                  </div>
                  <PaymentStatusBadge status={payment.status} />
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>

      <Section
        title={t('reservations.detail.sections.refunds', 'Refunds')}
        actions={(
          <Button type="button" size="sm" onClick={() => setRefundOpen(true)} disabled={!canRequestRefund}>
            {t('reservations.detail.actions.requestRefund', 'Request refund')}
          </Button>
        )}
      >
        {refunds.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('reservations.detail.refunds.empty', 'No refund requests.')}</p>
        ) : (
          <ul className="space-y-2">
            {refunds.map((refund) => {
              const targets = REFUND_TRANSITIONS[refund.status as RefundStatus] ?? []
              return (
                <li key={refund.id} className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{formatMoney(refund.amount, refund.currencyCode)}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {t('reservations.detail.refunds.account', 'Account ending {last4}', { last4: refund.bankAccountLast4 })} · {formatDateTime(refund.createdAt)}
                      {refund.reason ? ` · ${refund.reason}` : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <RefundStatusBadge status={refund.status} />
                    {targets.map((target) => (
                      <Button
                        key={target}
                        type="button"
                        size="sm"
                        variant={target === 'rejected' ? 'outline' : 'secondary'}
                        disabled={pendingRefundId === refund.id}
                        onClick={() => handleRefundTransition(refund, target as RefundTransitionTarget)}
                      >
                        {t(`reservations.refund.actions.${target}`, target)}
                      </Button>
                    ))}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      {injectedTabs.length > 0 ? (
        <section className="rounded-lg border border-border bg-card p-4" data-testid="reservation-injected-tabs">
          <Tabs value={resolvedActiveTab} onValueChange={setActiveTab} variant="underline">
            <TabsList aria-label={t('reservations.detail.tabs.label', 'Related records')}>
              {injectedTabs.map((tab) => (
                <TabsTrigger key={tab.id} value={tab.id}>{tab.label}</TabsTrigger>
              ))}
            </TabsList>
            {injectedTabs.map((tab) => (
              <TabsContent key={tab.id} value={tab.id} className="pt-4">
                <tab.widget.module.Widget context={injectionContext} data={reservation} />
              </TabsContent>
            ))}
          </Tabs>
        </section>
      ) : null}

      <RefundRequestDialog
        open={refundOpen}
        reservationId={id}
        bookingNumber={reservation.bookingNumber}
        currencyCode={currency}
        overpayment={balance.overpayment}
        onClose={() => setRefundOpen(false)}
        onCreated={() => { void load() }}
      />
      <RecordPaymentDialog
        open={paymentOpen}
        reservationId={id}
        bookingNumber={reservation.bookingNumber}
        currencyCode={currency}
        suggestedAmount={balance.outstanding}
        onClose={() => setPaymentOpen(false)}
        onCreated={() => { void load() }}
      />
      {ConfirmDialogElement}
    </div>
  )
}

export default ReservationDetail
