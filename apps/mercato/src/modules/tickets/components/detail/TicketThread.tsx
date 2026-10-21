"use client"

import { ArrowDownLeft, ArrowUpRight, StickyNote } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime, formatRelativeTime } from '@open-mercato/shared/lib/time'
import { cn } from '@open-mercato/shared/lib/utils'
import { StatusBadge, type StatusBadgeVariant } from '@open-mercato/ui/primitives/status-badge'
import { TabEmptyState } from '@open-mercato/ui/backend/detail'
import type { TicketArticleRow } from '../ticketTypes'

const DELIVERY_VARIANTS: Record<string, StatusBadgeVariant> = {
  queued: 'neutral',
  sent: 'success',
  simulated: 'info',
  failed: 'error',
}

function DirectionIcon({ direction }: { direction: TicketArticleRow['direction'] }) {
  if (direction === 'inbound') return <ArrowDownLeft className="size-4 text-muted-foreground" aria-hidden />
  if (direction === 'outbound') return <ArrowUpRight className="size-4 text-muted-foreground" aria-hidden />
  return <StickyNote className="size-4 text-muted-foreground" aria-hidden />
}

function ArticleItem({ article }: { article: TicketArticleRow }) {
  const t = useT()
  const locale = useLocale()
  const timestamp = article.sentAt ?? article.createdAt
  const relative = formatRelativeTime(timestamp, { locale })
  const absolute = formatDateTime(timestamp)
  const directionLabel = t(`tickets.article.direction.${article.direction}`, article.direction)
  const party = article.direction === 'inbound'
    ? article.fromEmail
    : article.direction === 'outbound'
      ? article.toEmail
      : null
  return (
    <li
      className={cn(
        'rounded-md border border-border px-4 py-3',
        article.direction === 'internal_note' ? 'bg-muted/40' : 'bg-card',
        article.direction === 'outbound' ? 'ml-6' : undefined,
      )}
      data-testid={`ticket-article-${article.direction}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2 text-sm">
          <DirectionIcon direction={article.direction} />
          <span className="font-medium">{directionLabel}</span>
          {party ? <span className="truncate text-muted-foreground">{party}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          {article.direction === 'outbound' ? (
            <StatusBadge variant={DELIVERY_VARIANTS[article.deliveryStatus] ?? 'neutral'}>
              {t(`tickets.article.delivery.${article.deliveryStatus}`, article.deliveryStatus)}
            </StatusBadge>
          ) : null}
          <span className="text-xs text-muted-foreground" title={absolute ?? undefined}>{relative ?? absolute ?? ''}</span>
        </div>
      </div>
      {article.subject ? <div className="mt-2 text-sm font-medium">{article.subject}</div> : null}
      <div className="mt-2 whitespace-pre-wrap break-words text-sm">{article.bodyText}</div>
    </li>
  )
}

export function TicketThread({ articles }: { articles: TicketArticleRow[] }) {
  const t = useT()
  if (!articles.length) {
    return (
      <TabEmptyState
        title={t('tickets.thread.empty.title', 'No messages yet')}
        description={t('tickets.thread.empty.description', 'Inbound emails, replies and internal notes appear here.')}
      />
    )
  }
  return (
    <ol className="space-y-3" aria-label={t('tickets.thread.label', 'Ticket thread')}>
      {articles.map((article) => (
        <ArticleItem key={article.id} article={article} />
      ))}
    </ol>
  )
}
