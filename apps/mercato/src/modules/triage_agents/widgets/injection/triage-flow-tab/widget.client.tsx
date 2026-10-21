"use client"

import * as React from 'react'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { TriageFlowTab } from '../../../components/TriageFlowTab'
import { readTicketWidgetContext } from '../../../components/ticketWidgetContext'

export default function TriageFlowTabWidget({ context, data }: InjectionWidgetComponentProps<Record<string, unknown>, Record<string, unknown>>) {
  const { ticketId } = readTicketWidgetContext(context, data)
  if (!ticketId) return null
  return <TriageFlowTab ticketId={ticketId} />
}
