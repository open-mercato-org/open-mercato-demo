"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import type { FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { Button } from '@open-mercato/ui/primitives/button'
import { fetchCrudList, deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { RESERVATION_STATUSES } from '../data/constants'
import { BalanceChip, DepartureBadge, ReservationStatusBadge, formatMoney } from './ReservationBadges'
import type { ListResponse, ReservationListItem } from './types'

const PAGE_SIZE = 50
const LIST_PATH = 'reservations/reservations'

type Translate = ReturnType<typeof useT>

function buildColumns(t: Translate): ColumnDef<ReservationListItem>[] {
  return [
    {
      accessorKey: 'bookingNumber',
      header: t('reservations.list.columns.bookingNumber', 'Booking'),
      meta: { priority: 1 },
      cell: ({ row }) => <span className="font-medium">{row.original.bookingNumber}</span>,
    },
    {
      accessorKey: 'customerName',
      header: t('reservations.list.columns.customer', 'Customer'),
      enableSorting: false,
      meta: { priority: 2, truncate: true, maxWidth: '14rem' },
      cell: ({ row }) => row.original.customerName ?? '—',
    },
    {
      accessorKey: 'destination',
      header: t('reservations.list.columns.destination', 'Destination / hotel'),
      meta: { priority: 3, truncate: true, maxWidth: '18rem' },
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate">{row.original.destination}</div>
          <div className="truncate text-xs text-muted-foreground">{row.original.hotelName}</div>
        </div>
      ),
    },
    {
      accessorKey: 'departureDate',
      header: t('reservations.list.columns.departure', 'Departure'),
      meta: { priority: 2 },
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-2">
          <span>{row.original.departureDate ?? '—'}</span>
          <DepartureBadge daysToDeparture={row.original.daysToDeparture} />
        </div>
      ),
    },
    {
      accessorKey: 'status',
      header: t('reservations.list.columns.status', 'Status'),
      meta: { priority: 2 },
      cell: ({ row }) => <ReservationStatusBadge status={row.original.status} />,
    },
    {
      accessorKey: 'totalPriceAmount',
      header: t('reservations.list.columns.total', 'Total'),
      meta: { priority: 4 },
      cell: ({ row }) => formatMoney(row.original.totalPriceAmount, row.original.currencyCode),
    },
    {
      id: 'balance',
      header: t('reservations.list.columns.balance', 'Balance'),
      enableSorting: false,
      meta: { priority: 3 },
      cell: ({ row }) => <BalanceChip balance={row.original.balance} currencyCode={row.original.currencyCode} />,
    },
  ]
}

export default function ReservationsTable() {
  const t = useT()
  const router = useRouter()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const [search, setSearch] = React.useState('')
  const [filterValues, setFilterValues] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([{ id: 'departureDate', desc: false }])
  const [page, setPage] = React.useState(1)

  const params = React.useMemo(() => {
    const next: Record<string, string> = {
      page: String(page),
      pageSize: String(PAGE_SIZE),
      sortField: sorting[0]?.id ?? 'departureDate',
      sortDir: sorting[0]?.desc ? 'desc' : 'asc',
    }
    if (search.trim()) next.search = search.trim()
    const status = filterValues.status
    if (typeof status === 'string' && status) next.status = status
    const departure = filterValues.departure
    if (departure && typeof departure === 'object') {
      const range = departure as { from?: string; to?: string }
      if (range.from) next.departureFrom = range.from
      if (range.to) next.departureTo = range.to
    }
    return next
  }, [filterValues, page, search, sorting])

  const { data, isLoading, error } = useQuery<ListResponse<ReservationListItem>>({
    queryKey: ['reservations', 'list', params, scopeVersion],
    queryFn: async () => fetchCrudList<ReservationListItem>(LIST_PATH, params),
  })

  const columns = React.useMemo(() => buildColumns(t), [t])

  const statusOptions = React.useMemo(
    () => RESERVATION_STATUSES.map((status) => ({ value: status, label: t(`reservations.status.${status}`, status) })),
    [t],
  )

  const handleDelete = React.useCallback(async (row: ReservationListItem) => {
    const confirmed = await confirm({
      title: t('reservations.list.confirmDelete', 'Delete reservation {bookingNumber}?', { bookingNumber: row.bookingNumber }),
      variant: 'destructive',
    })
    if (!confirmed) return
    try {
      await withScopedApiRequestHeaders(buildOptimisticLockHeader(row.updatedAt), () => deleteCrud(LIST_PATH, row.id))
      flash(t('reservations.flash.deleted', 'Reservation deleted'), 'success')
      await queryClient.invalidateQueries({ queryKey: ['reservations'] })
    } catch (err) {
      if (surfaceRecordConflict(err, t)) {
        await queryClient.invalidateQueries({ queryKey: ['reservations'] })
        return
      }
      flash(err instanceof Error && err.message ? err.message : t('reservations.errors.deleteFailed', 'Failed to delete reservation'), 'error')
    }
  }, [confirm, queryClient, t])

  if (error) {
    return <ErrorMessage label={t('reservations.list.error', 'Failed to load reservations')} />
  }

  return (
    <>
      <DataTable<ReservationListItem>
        title={t('reservations.list.title', 'Reservations')}
        titleHeadingLevel={1}
        actions={(
          <Button asChild>
            <Link href="/backend/reservations/create">{t('reservations.list.actions.create', 'New reservation')}</Link>
          </Button>
        )}
        columns={columns}
        data={data?.items ?? []}
        searchValue={search}
        searchPlaceholder={t('reservations.list.searchPlaceholder', 'Search booking number, destination or hotel')}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        searchAlign="right"
        filters={[
          { id: 'status', label: t('reservations.list.filters.status', 'Status'), type: 'select', options: statusOptions },
          { id: 'departure', label: t('reservations.list.filters.departure', 'Departure'), type: 'dateRange' },
        ]}
        filterValues={filterValues}
        onFiltersApply={(values: FilterValues) => {
          setFilterValues(values)
          setPage(1)
        }}
        onFiltersClear={() => {
          setFilterValues({})
          setPage(1)
        }}
        entityId="reservations:reservation"
        sortable
        sorting={sorting}
        onSortingChange={(next) => {
          setSorting(next)
          setPage(1)
        }}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'open', label: t('reservations.list.actions.open', 'Open'), href: `/backend/reservations/${row.id}` },
              { id: 'edit', label: t('reservations.list.actions.edit', 'Edit'), href: `/backend/reservations/${row.id}/edit` },
              {
                id: 'delete',
                label: t('reservations.list.actions.delete', 'Delete'),
                destructive: true,
                onSelect: () => handleDelete(row),
              },
            ]}
          />
        )}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.total ?? 0,
          totalPages: data?.totalPages ?? Math.max(1, Math.ceil((data?.total ?? 0) / PAGE_SIZE)),
          totalIsCapped: data?.totalIsCapped === true,
          onPageChange: setPage,
        }}
        isLoading={isLoading}
        onRowClick={(row) => router.push(`/backend/reservations/${row.id}`)}
      />
      {ConfirmDialogElement}
    </>
  )
}
