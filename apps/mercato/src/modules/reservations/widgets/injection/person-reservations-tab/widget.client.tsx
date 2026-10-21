"use client"

import * as React from 'react'
import Link from 'next/link'
import { Plane, Plus } from 'lucide-react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { BalanceChip, DepartureBadge, ReservationStatusBadge } from '../../../components/ReservationBadges'
import type { ListResponse, ReservationListItem } from '../../../components/types'

function readPersonId(context: unknown): string | null {
  if (!context || typeof context !== 'object') return null
  const candidate = context as { resourceKind?: unknown; resourceId?: unknown }
  if (candidate.resourceKind !== 'customers.person') return null
  return typeof candidate.resourceId === 'string' && candidate.resourceId.trim() ? candidate.resourceId : null
}

export default function PersonReservationsTabWidget({ context }: InjectionWidgetComponentProps<unknown, unknown>) {
  const t = useT()
  const personId = readPersonId(context)
  const [items, setItems] = React.useState<ReservationListItem[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!personId) return
    let cancelled = false
    setLoading(true)
    setError(null)
    const query = new URLSearchParams({
      customerPersonId: personId,
      page: '1',
      pageSize: '20',
      sortField: 'departureDate',
      sortDir: 'asc',
    })
    apiCall<ListResponse<ReservationListItem>>(`/api/reservations/reservations?${query.toString()}`)
      .then((response) => {
        if (cancelled) return
        if (response.ok && response.result) {
          setItems(Array.isArray(response.result.items) ? response.result.items : [])
          return
        }
        if (response.status === 403) {
          setItems([])
          return
        }
        setError(t('reservations.personTab.error', 'Failed to load reservations.'))
      })
      .catch(() => {
        if (!cancelled) setError(t('reservations.personTab.error', 'Failed to load reservations.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [personId, t])

  if (!personId) return null

  const createButton = (
    <Button asChild size="sm" variant="outline">
      <Link href="/backend/reservations/create">
        <Plus className="size-4" aria-hidden />
        {t('reservations.personTab.create', 'New reservation')}
      </Link>
    </Button>
  )

  if (loading) return <LoadingMessage label={t('reservations.personTab.loading', 'Loading reservations…')} />
  if (error) return <ErrorMessage label={error} />
  if (items.length === 0) {
    return (
      <EmptyState
        size="sm"
        variant="subtle"
        icon={<Plane className="size-5" aria-hidden />}
        title={t('reservations.personTab.empty.title', 'No reservations for this customer')}
        description={t('reservations.personTab.empty.description', 'Reservations booked for this person will appear here.')}
        actions={createButton}
        className="border border-dashed border-border"
      />
    )
  }

  return (
    <div className="space-y-3" data-testid="person-reservations-tab">
      <div className="flex justify-end">{createButton}</div>
      <ul className="space-y-2" aria-label={t('reservations.personTab.listLabel', 'Customer reservations')}>
        {items.map((item) => (
          <li key={item.id} className="rounded-md border border-border bg-card px-3 py-2">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <Link
                  href={`/backend/reservations/${item.id}`}
                  className="text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:shadow-focus"
                >
                  {item.bookingNumber}
                </Link>
                <div className="truncate text-xs text-muted-foreground">
                  {item.hotelName} · {item.destination} · {item.departureDate ?? '—'}
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <DepartureBadge daysToDeparture={item.daysToDeparture} />
                <ReservationStatusBadge status={item.status} />
                <BalanceChip balance={item.balance} currencyCode={item.currencyCode} />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  )
}
