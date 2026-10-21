"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { TriageDecisionCard } from '../../../components/TriageDecisionCard'
import { readTicketWidgetContext } from '../../../components/ticketWidgetContext'

export default function TriageDecisionCardWidget({ context, data }: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>) {
  const { ticketId, reload, reloadDrafts } = readTicketWidgetContext(context, data)
  if (!ticketId) return null
  return <TriageDecisionCard ticketId={ticketId} onTicketChanged={reload ?? undefined} onDraftsChanged={reloadDrafts ?? undefined} />
}
