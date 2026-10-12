"use client"

import * as React from 'react'
import Link from 'next/link'
import { Flag, Tags } from 'lucide-react'
import { useLocale, useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDateTime, formatRelativeTime } from '@open-mercato/shared/lib/time'
import { Button } from '@open-mercato/ui/primitives/button'
import { ManualReviewIndicator, PriorityBadge } from '../TicketBadges'
import type { TicketRow } from '../ticketTypes'

export type ClassificationPanelProps = {
  ticket: TicketRow
  personLabel: string | null
  canClassify: boolean
  onClassify: () => void
  onFlag: () => void
  onClearFlag: () => void
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-3 gap-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="col-span-2 min-w-0 break-words">{children}</dd>
    </div>
  )
}

export function ClassificationPanel({
  ticket,
  personLabel,
  canClassify,
  onClassify,
  onFlag,
  onClearFlag,
}: ClassificationPanelProps) {
  const t = useT()
  const locale = useLocale()
  const empty = <span className="text-muted-foreground">—</span>
  const classifiedRelative = formatRelativeTime(ticket.classifiedAt, { locale })
  const classifiedAbsolute = formatDateTime(ticket.classifiedAt)

  return (
    <section className="space-y-4 rounded-md border border-border bg-card p-4" aria-labelledby="ticket-classification-heading">
      <div className="flex items-center justify-between gap-2">
        <h2 id="ticket-classification-heading" className="text-sm font-semibold">
          {t('tickets.classification.title', 'Classification')}
        </h2>
        {canClassify ? (
          <Button type="button" size="sm" variant="outline" onClick={onClassify}>
            <Tags className="size-4" aria-hidden />
            {t('tickets.classification.edit', 'Classify')}
          </Button>
        ) : null}
      </div>
      <dl className="space-y-2">
        <Row label={t('tickets.classification.category', 'Category')}>
          {ticket.categoryPathSnapshot ?? ticket.categoryKey ?? empty}
        </Row>
        <Row label={t('tickets.classification.topic', 'Topic key')}>
          {ticket.topicKey ? <code className="text-xs">{ticket.topicKey}</code> : empty}
        </Row>
        <Row label={t('tickets.classification.priority', 'Priority')}>
          <div className="space-y-1">
            <PriorityBadge priority={ticket.priority} />
            {ticket.priorityReason ? <div className="text-xs text-muted-foreground">{ticket.priorityReason}</div> : null}
          </div>
        </Row>
        <Row label={t('tickets.classification.summary', 'Summary')}>
          {ticket.summary ? <span className="whitespace-pre-wrap">{ticket.summary}</span> : empty}
        </Row>
        <Row label={t('tickets.classification.customer', 'Customer')}>
          {ticket.customerPersonId ? (
            <Link href={`/backend/customers/people-v2/${encodeURIComponent(ticket.customerPersonId)}`} className="text-primary hover:underline">
              {personLabel ?? ticket.customerPersonId}
            </Link>
          ) : empty}
        </Row>
        <Row label={t('tickets.classification.reservation', 'Reservation')}>
          {ticket.reservationNumberSnapshot ?? ticket.reservationId ?? empty}
        </Row>
        <Row label={t('tickets.classification.source', 'Source')}>
          {ticket.classificationSource ? (
            <span title={classifiedAbsolute ?? undefined}>
              {t(`tickets.classification.sources.${ticket.classificationSource}`, ticket.classificationSource)}
              {classifiedRelative ? ` · ${classifiedRelative}` : ''}
            </span>
          ) : t('tickets.classification.unclassified', 'Not classified yet')}
        </Row>
      </dl>
      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium">{t('tickets.manualReview.title', 'Manual review')}</span>
          {canClassify ? (
            ticket.needsManualReview ? (
              <Button type="button" size="sm" variant="ghost" onClick={onClearFlag}>
                {t('tickets.manualReview.clear', 'Clear flag')}
              </Button>
            ) : (
              <Button type="button" size="sm" variant="outline" onClick={onFlag}>
                <Flag className="size-4" aria-hidden />
                {t('tickets.manualReview.flag', 'Flag')}
              </Button>
            )
          ) : null}
        </div>
        {ticket.needsManualReview ? (
          <div className="space-y-1">
            <ManualReviewIndicator
              needsManualReview
              reason={ticket.manualReviewReason}
              reasonCode={ticket.manualReviewReasonCode}
            />
            {ticket.manualReviewReasonCode ? <div className="text-xs text-muted-foreground"><code>{ticket.manualReviewReasonCode}</code></div> : null}
            {ticket.manualReviewReason ? <p className="whitespace-pre-wrap text-sm">{ticket.manualReviewReason}</p> : null}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">{t('tickets.manualReview.none', 'No manual review required.')}</p>
        )}
      </div>
    </section>
  )
}
