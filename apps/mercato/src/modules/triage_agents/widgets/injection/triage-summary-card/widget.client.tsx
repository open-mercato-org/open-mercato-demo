"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { TriageSummaryCard } from '../../../components/TriageSummaryCard'

function readTicketId(context: unknown, data: unknown): string | null {
  const candidate = context && typeof context === 'object' ? (context as { resourceKind?: unknown; resourceId?: unknown }) : null
  if (candidate?.resourceKind === 'tickets.ticket' && typeof candidate.resourceId === 'string' && candidate.resourceId) {
    return candidate.resourceId
  }
  const record = data && typeof data === 'object' ? (data as { id?: unknown }) : null
  return typeof record?.id === 'string' && record.id ? record.id : null
}

export default function TriageSummaryCardWidget({ context, data }: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>) {
  const ticketId = readTicketId(context, data)
  if (!ticketId) return null
  const ticket = data && typeof data === 'object' ? (data as Record<string, unknown>) : null
  return <TriageSummaryCard ticketId={ticketId} ticket={ticket} />
}
