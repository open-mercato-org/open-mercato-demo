"use client"

import * as React from 'react'
import { Flag } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { TICKET_PRIORITIES, TICKET_STATUSES, type TicketPriority, type TicketStatus } from '../data/constants'
import { PRIORITY_BADGE_STYLES, STATUS_BADGE_VARIANTS } from './ticketTypes'

function isPriority(value: string | null | undefined): value is TicketPriority {
  return typeof value === 'string' && (TICKET_PRIORITIES as readonly string[]).includes(value)
}

function isStatus(value: string | null | undefined): value is TicketStatus {
  return typeof value === 'string' && (TICKET_STATUSES as readonly string[]).includes(value)
}

export function usePriorityLabel(): (priority: string | null | undefined) => string {
  const t = useT()
  return React.useCallback((priority) => {
    if (!priority) return t('tickets.priority.unknown', 'Unknown')
    return t(`tickets.priority.${priority}`, priority)
  }, [t])
}

export function useStatusLabel(): (status: string | null | undefined) => string {
  const t = useT()
  return React.useCallback((status) => {
    if (!status) return t('tickets.status.unknown', 'Unknown')
    return t(`tickets.status.${status}`, status)
  }, [t])
}

export function PriorityBadge({ priority, reason }: { priority: string | null | undefined; reason?: string | null }) {
  const label = usePriorityLabel()(priority)
  const style = isPriority(priority) ? PRIORITY_BADGE_STYLES[priority] : { variant: 'neutral' as const }
  const badge = (
    <StatusBadge variant={style.variant} appearance={style.appearance} dot>
      {label}
    </StatusBadge>
  )
  if (!reason) return badge
  return (
    <SimpleTooltip content={reason}>
      <span className="inline-flex">{badge}</span>
    </SimpleTooltip>
  )
}

export function TicketStatusBadge({ status }: { status: string | null | undefined }) {
  const label = useStatusLabel()(status)
  const variant = isStatus(status) ? STATUS_BADGE_VARIANTS[status] : 'neutral'
  return <StatusBadge variant={variant}>{label}</StatusBadge>
}

export function ManualReviewIndicator({
  needsManualReview,
  reason,
  reasonCode,
}: {
  needsManualReview: boolean
  reason?: string | null
  reasonCode?: string | null
}) {
  const t = useT()
  if (!needsManualReview) return null
  const tooltip = reason || reasonCode || t('tickets.manualReview.noReason', 'No reason provided')
  return (
    <SimpleTooltip content={tooltip}>
      <span className="inline-flex">
        <StatusBadge variant="warning">
          <Flag className="size-3" aria-hidden />
          {t('tickets.manualReview.badge', 'Manual review')}
        </StatusBadge>
      </span>
    </SimpleTooltip>
  )
}
