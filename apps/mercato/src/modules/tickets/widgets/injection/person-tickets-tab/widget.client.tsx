"use client"

import * as React from 'react'
import Link from 'next/link'
import { ExternalLink, Ticket as TicketIcon } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime, formatRelativeTime } from '@open-mercato/shared/lib/time'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { ErrorMessage, LoadingMessage } from '@open-mercato/ui/backend/detail'
import { EmptyState } from '@open-mercato/ui/primitives/empty-state'
import { PriorityBadge, TicketStatusBadge } from '../../../components/TicketBadges'
import { ticketDetailPath, type TicketRow } from '../../../components/ticketTypes'

type TicketsResponse = {
  items?: TicketRow[]
  total?: number
}

const PAGE_SIZE = 20

export function resolvePersonId(context: unknown): string | null {
  if (!context || typeof context !== 'object') return null
  const candidate = context as { resourceKind?: unknown; resourceId?: unknown; personId?: unknown }
  if (candidate.resourceKind !== 'customers.person') return null
  const id = typeof candidate.personId === 'string' && candidate.personId
    ? candidate.personId
    : typeof candidate.resourceId === 'string' ? candidate.resourceId : null
  return id && id.trim() ? id.trim() : null
}

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

export default function PersonTicketsTabWidget({ context }: InjectionWidgetComponentProps<unknown, unknown>) {
  const t = useT()
  const personId = resolvePersonId(context)
  const [tickets, setTickets] = React.useState<TicketRow[]>([])
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
  }, [personId, t])

  if (!personId) return null
  if (loading) return <LoadingMessage label={t('tickets.personTab.loading', 'Loading tickets…')} />
  if (error) return <ErrorMessage label={error} />
  if (!tickets.length) {
    return (
      <EmptyState
        size="sm"
        variant="subtle"
        icon={<TicketIcon className="h-5 w-5" aria-hidden />}
        title={t('tickets.personTab.empty.title', 'No tickets for this customer')}
        description={t('tickets.personTab.empty.description', 'Tickets linked to this person through classification appear here.')}
        className="border border-dashed border-border"
      />
    )
  }
  return (
    <ul className="space-y-2" aria-label={t('tickets.personTab.listLabel', 'Customer tickets')}>
      {tickets.map((ticket) => (
        <TicketItem key={ticket.id} ticket={ticket} />
      ))}
    </ul>
  )
}
