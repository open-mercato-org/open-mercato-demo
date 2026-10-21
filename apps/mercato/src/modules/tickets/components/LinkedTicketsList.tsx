"use client"

import * as React from 'react'
import Link from 'next/link'
import { ExternalLink, Ticket as TicketIcon } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime, formatRelativeTime } from '@open-mercato/shared/lib/time'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { PriorityBadge, TicketStatusBadge } from './TicketBadges'
import { ticketDetailPath, type TicketRow } from './ticketTypes'

type TicketsResponse = {
  items?: TicketRow[]
  total?: number
}

const PAGE_SIZE = 20

function TicketItem({ ticket }: { ticket: TicketRow }) {
  const t = useT()
  const locale = useLocale()
  const timestamp = ticket.lastInboundAt ?? ticket.createdAt
  const relative = formatRelativeTime(timestamp, { locale })
  const absolute = formatDateTime(timestamp)
  return (
    <li className="rounded-md border border-border bg-card px-3 py-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link
            href={ticketDetailPath(ticket.id)}
            className="inline-flex max-w-full items-center gap-1.5 text-sm font-medium text-primary hover:underline"
          >
            <span className="truncate">{ticket.number ?? t('tickets.personTab.unnumbered', 'Ticket')}</span>
            <ExternalLink className="size-4 shrink-0" aria-hidden />
          </Link>
          <div className="truncate text-sm">{ticket.subject ?? ''}</div>
          <div className="text-xs text-muted-foreground" title={absolute ?? undefined}>
            {ticket.categoryPathSnapshot ? `${ticket.categoryPathSnapshot} · ` : ''}
            {relative ?? absolute ?? ''}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <TicketStatusBadge status={ticket.status} />
          <PriorityBadge priority={ticket.priority} />
        </div>
      </div>
    </li>
  )
}

export type LinkedTicketsListProps = {
  filterKey: 'customerPersonId' | 'reservationId'
  filterValue: string
  emptyTitle: string
  emptyDescription: string
  listLabel: string
  testId?: string
}

export function LinkedTicketsList({
  filterKey,
  filterValue,
  emptyTitle,
  emptyDescription,
  listLabel,
  testId,
}: LinkedTicketsListProps) {
  const t = useT()
  const [tickets, setTickets] = React.useState<TicketRow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    const query = new URLSearchParams({
      [filterKey]: filterValue,
      page: '1',
      pageSize: String(PAGE_SIZE),
      sortField: 'lastInboundAt',
      sortDir: 'desc',
    })
    apiCall<TicketsResponse>(`/api/tickets/tickets?${query.toString()}`)
      .then((response) => {
        if (cancelled) return
        if (response.ok && response.result) {
          setTickets(Array.isArray(response.result.items) ? response.result.items : [])
          return
        }
        if (response.status === 403) {
          setTickets([])
          return
        }
        setError(t('tickets.personTab.error', 'Failed to load tickets.'))
      })
      .catch(() => {
        if (!cancelled) setError(t('tickets.personTab.error', 'Failed to load tickets.'))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [filterKey, filterValue, t])

  let content: React.ReactNode
  if (loading) {
    content = <LoadingMessage label={t('tickets.personTab.loading', 'Loading tickets…')} />
  } else if (error) {
    content = <ErrorMessage label={error} />
  } else if (!tickets.length) {
    content = (
      <EmptyState
        size="sm"
        variant="subtle"
        icon={<TicketIcon className="h-5 w-5" aria-hidden />}
        title={emptyTitle}
        description={emptyDescription}
        className="border border-dashed border-border"
      />
    )
  } else {
    content = (
      <ul className="space-y-2" aria-label={listLabel}>
        {tickets.map((ticket) => (
          <TicketItem key={ticket.id} ticket={ticket} />
        ))}
      </ul>
    )
  }
  return <div data-testid={testId}>{content}</div>
}

export default LinkedTicketsList
