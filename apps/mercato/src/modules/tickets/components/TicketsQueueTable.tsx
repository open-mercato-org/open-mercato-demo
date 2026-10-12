"use client"

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { SortingState } from '@tanstack/react-table'
import { DataTable } from '@open-mercato/ui/backend/DataTable'
import { RowActions } from '@open-mercato/ui/backend/RowActions'
import { ErrorMessage } from '@open-mercato/ui/backend/detail'
import type { FilterDef, FilterValues } from '@open-mercato/ui/backend/FilterBar'
import { fetchCrudList } from '@open-mercato/ui/backend/utils/crud'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { useOrganizationScopeVersion } from '@open-mercato/shared/lib/frontend/useOrganizationScope'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime, formatRelativeTime } from '@open-mercato/shared/lib/time'
import { TICKET_PRIORITIES, TICKET_STATUSES } from '../data/constants'
import extensionPoints from '../extension-points'
import { ManualReviewIndicator, PriorityBadge, TicketStatusBadge } from './TicketBadges'
import { usePeopleLabels } from './usePeopleLabels'
import { resolveCustomerLabel, resolveReservationLabel } from '../lib/linkedLabels'
import { ticketDetailPath, type TicketQueueOption, type TicketRow } from './ticketTypes'

type TicketsResponse = {
  items: TicketRow[]
  total: number
  page: number
  pageSize: number
  totalPages: number
  totalIsCapped?: boolean
}

type QueueOptionsResponse = {
  items?: TicketQueueOption[]
}

export type TicketQueuePreset = 'all' | 'mine' | 'manualReview' | 'urgent'

const PAGE_SIZE = 25

export function buildQueueQueryParams(input: {
  page: number
  search: string
  preset: TicketQueuePreset
  filters: FilterValues
  sorting: SortingState
}): Record<string, string> {
  const params: Record<string, string> = {
    page: String(input.page),
    pageSize: String(PAGE_SIZE),
  }
  const sort = input.sorting[0]
  if (sort?.id) {
    params.sortField = sort.id
    params.sortDir = sort.desc ? 'desc' : 'asc'
  }
  if (input.search.trim()) params.q = input.search.trim()
  if (input.preset === 'mine') params.mine = 'true'
  if (input.preset === 'manualReview') params.needsManualReview = 'true'
  if (input.preset === 'urgent') params.priority = 'urgent'
  const status = input.filters.status
  if (Array.isArray(status) && status.length) params.status = status.map(String).join(',')
  else if (typeof status === 'string' && status) params.status = status
  const priority = input.filters.priority
  if (!params.priority) {
    if (Array.isArray(priority) && priority.length) params.priority = priority.map(String).join(',')
    else if (typeof priority === 'string' && priority) params.priority = priority
  }
  if (typeof input.filters.queueKey === 'string' && input.filters.queueKey) params.queueKey = input.filters.queueKey
  if (input.filters.needsManualReview === true) params.needsManualReview = 'true'
  return params
}

export default function TicketsQueueTable() {
  const t = useT()
  const locale = useLocale()
  const router = useRouter()
  const queryClient = useQueryClient()
  const scopeVersion = useOrganizationScopeVersion()
  const [search, setSearch] = React.useState('')
  const [preset, setPreset] = React.useState<TicketQueuePreset>('all')
  const [filters, setFilters] = React.useState<FilterValues>({})
  const [sorting, setSorting] = React.useState<SortingState>([])
  const [page, setPage] = React.useState(1)

  const params = React.useMemo(
    () => buildQueueQueryParams({ page, search, preset, filters, sorting }),
    [filters, page, preset, search, sorting],
  )

  const queryKey = React.useMemo(() => ['tickets', 'queue', params, scopeVersion], [params, scopeVersion])
  const { data, isLoading, isFetching, error, refetch } = useQuery<TicketsResponse>({
    queryKey,
    queryFn: () => fetchCrudList<TicketRow>('tickets/tickets', params),
  })

  const invalidate = React.useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['tickets', 'queue'] })
  }, [queryClient])

  useAppEvent('tickets.ticket.*', invalidate, [invalidate])
  useAppEvent('tickets.article.received', invalidate, [invalidate])
  useAppEvent('tickets.reply.sent', invalidate, [invalidate])

  const { data: queueOptions } = useQuery<TicketQueueOption[]>({
    queryKey: ['tickets', 'queues', scopeVersion],
    queryFn: async () => {
      const response = await apiCall<QueueOptionsResponse>('/api/tickets/queues')
      return response.ok && response.result?.items ? response.result.items : []
    },
  })

  const queueLabels = React.useMemo(() => {
    const map: Record<string, string> = {}
    for (const option of queueOptions ?? []) map[option.value] = option.label
    return map
  }, [queueOptions])

  const rows = React.useMemo(() => data?.items ?? [], [data?.items])
  const personLabels = usePeopleLabels(rows.map((row) => row.customerPersonId))

  const filterDefs = React.useMemo<FilterDef[]>(() => [
    {
      id: 'status',
      label: t('tickets.queue.filters.status', 'Status'),
      type: 'select',
      multiple: true,
      options: TICKET_STATUSES.map((status) => ({ value: status, label: t(`tickets.status.${status}`, status) })),
    },
    {
      id: 'priority',
      label: t('tickets.queue.filters.priority', 'Priority'),
      type: 'select',
      multiple: true,
      options: TICKET_PRIORITIES.map((priority) => ({ value: priority, label: t(`tickets.priority.${priority}`, priority) })),
    },
    {
      id: 'queueKey',
      label: t('tickets.queue.filters.queue', 'Queue'),
      type: 'select',
      options: (queueOptions ?? []).map((option) => ({ value: option.value, label: option.label })),
    },
    {
      id: 'needsManualReview',
      label: t('tickets.queue.filters.needsManualReview', 'Needs manual review'),
      type: 'checkbox',
    },
  ], [queueOptions, t])

  const columns = React.useMemo<ColumnDef<TicketRow>[]>(() => [
    {
      accessorKey: 'number',
      header: t('tickets.queue.columns.number', 'Number'),
      meta: { priority: 1 },
      cell: ({ row }) => (
        <Link href={ticketDetailPath(row.original.id)} className="font-medium text-primary hover:underline">
          {row.original.number ?? '—'}
        </Link>
      ),
    },
    {
      accessorKey: 'subject',
      header: t('tickets.queue.columns.subject', 'Subject'),
      enableSorting: false,
      meta: { priority: 1, truncate: true, maxWidth: '320px' },
      cell: ({ row }) => (
        <div className="min-w-0">
          <div className="truncate font-medium">{row.original.subject ?? '—'}</div>
          {row.original.summary ? (
            <div className="truncate text-xs text-muted-foreground">{row.original.summary}</div>
          ) : null}
        </div>
      ),
    },
    {
      accessorKey: 'requesterEmail',
      header: t('tickets.queue.columns.customer', 'Requester / customer'),
      enableSorting: false,
      meta: { priority: 2, truncate: true, maxWidth: '240px' },
      cell: ({ row }) => {
        const ticket = row.original
        const personLabel = resolveCustomerLabel(ticket, personLabels)?.label ?? null
        return (
          <div className="min-w-0">
            <div className="truncate">{personLabel ?? ticket.requesterName ?? ticket.requesterEmail ?? '—'}</div>
            {personLabel || ticket.requesterName ? (
              <div className="truncate text-xs text-muted-foreground">{ticket.requesterEmail ?? ''}</div>
            ) : null}
          </div>
        )
      },
    },
    {
      accessorKey: 'reservationNumberSnapshot',
      header: t('tickets.queue.columns.reservation', 'Reservation'),
      enableSorting: false,
      meta: { priority: 4, truncate: true, maxWidth: '160px' },
      cell: ({ row }) => {
        const reservation = resolveReservationLabel(row.original)
        if (!reservation) return <span className="text-sm">—</span>
        return (
          <div className="min-w-0">
            <div className="truncate text-sm">{reservation.bookingNumber}</div>
            {reservation.destination ? (
              <div className="truncate text-xs text-muted-foreground">{reservation.destination}</div>
            ) : null}
          </div>
        )
      },
    },
    {
      accessorKey: 'categoryPathSnapshot',
      header: t('tickets.queue.columns.category', 'Category'),
      enableSorting: false,
      meta: { priority: 3, truncate: true, maxWidth: '240px' },
      cell: ({ row }) => (
        <span className="text-sm">{row.original.categoryPathSnapshot ?? row.original.topicKey ?? '—'}</span>
      ),
    },
    {
      accessorKey: 'priority',
      header: t('tickets.queue.columns.priority', 'Priority'),
      meta: { priority: 1 },
      cell: ({ row }) => <PriorityBadge priority={row.original.priority} reason={row.original.priorityReason} />,
    },
    {
      accessorKey: 'status',
      header: t('tickets.queue.columns.status', 'Status'),
      enableSorting: false,
      meta: { priority: 2 },
      cell: ({ row }) => (
        <div className="flex flex-wrap items-center gap-1">
          <TicketStatusBadge status={row.original.status} />
          <ManualReviewIndicator
            needsManualReview={row.original.needsManualReview}
            reason={row.original.manualReviewReason}
            reasonCode={row.original.manualReviewReasonCode}
          />
        </div>
      ),
    },
    {
      accessorKey: 'queueKey',
      header: t('tickets.queue.columns.queue', 'Queue'),
      enableSorting: false,
      meta: { priority: 5 },
      cell: ({ row }) => {
        const key = row.original.queueKey
        return <span className="text-sm">{key ? queueLabels[key] ?? key : '—'}</span>
      },
    },
    {
      accessorKey: 'lastInboundAt',
      header: t('tickets.queue.columns.lastInbound', 'Last inbound'),
      meta: { priority: 3 },
      cell: ({ row }) => {
        const value = row.original.lastInboundAt
        const relative = formatRelativeTime(value, { locale })
        const absolute = formatDateTime(value)
        return <span className="text-sm text-muted-foreground" title={absolute ?? undefined}>{relative ?? absolute ?? '—'}</span>
      },
    },
  ], [locale, personLabels, queueLabels, t])

  const handlePresetChange = React.useCallback((value: string) => {
    setPreset(value as TicketQueuePreset)
    setPage(1)
  }, [])

  if (error) {
    return <ErrorMessage label={t('tickets.queue.error', 'Failed to load tickets.')} />
  }

  return (
    <div className="space-y-3">
      <SegmentedControl
        value={preset}
        onValueChange={handlePresetChange}
        aria-label={t('tickets.queue.presets.label', 'Saved filters')}
      >
        <SegmentedControlItem value="all">{t('tickets.queue.presets.all', 'All')}</SegmentedControlItem>
        <SegmentedControlItem value="mine">{t('tickets.queue.presets.mine', 'Mine')}</SegmentedControlItem>
        <SegmentedControlItem value="manualReview">{t('tickets.queue.presets.manualReview', 'Needs manual review')}</SegmentedControlItem>
        <SegmentedControlItem value="urgent">{t('tickets.queue.presets.urgent', 'Urgent')}</SegmentedControlItem>
      </SegmentedControl>
      <DataTable<TicketRow>
        title={t('tickets.queue.title', 'Tickets')}
        titleHeadingLevel={1}
        columns={columns}
        data={rows}
        searchValue={search}
        searchPlaceholder={t('tickets.queue.searchPlaceholder', 'Search by number, category, reservation or email')}
        onSearchChange={(value) => {
          setSearch(value)
          setPage(1)
        }}
        filters={filterDefs}
        filterValues={filters}
        onFiltersApply={(values: FilterValues) => {
          setFilters(values)
          setPage(1)
        }}
        onFiltersClear={() => {
          setFilters({})
          setPage(1)
        }}
        sortable
        sorting={sorting}
        onSortingChange={(next: SortingState) => {
          setSorting(next)
          setPage(1)
        }}
        extensionTableId={extensionPoints.hosts.ticketsTable.tableId}
        perspective={{ tableId: extensionPoints.hosts.ticketsTable.tableId }}
        refreshButton={{
          onRefresh: () => { void refetch() },
          label: t('tickets.queue.refresh', 'Refresh'),
          isRefreshing: isFetching,
        }}
        rowActions={(row) => (
          <RowActions
            items={[
              { id: 'open', label: t('tickets.queue.actions.open', 'Open'), href: ticketDetailPath(row.id) },
            ]}
          />
        )}
        onRowClick={(row) => router.push(ticketDetailPath(row.id))}
        pagination={{
          page,
          pageSize: PAGE_SIZE,
          total: data?.total ?? 0,
          totalPages: data?.totalPages ?? 0,
          totalIsCapped: data?.totalIsCapped === true,
          onPageChange: setPage,
        }}
        isLoading={isLoading}
      />
    </div>
  )
}
