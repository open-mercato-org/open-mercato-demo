"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { LinkedTicketsList } from '../../../components/LinkedTicketsList'
import { resolvePersonId } from '../../../lib/injectionContext'

export { resolvePersonId }

export default function PersonTicketsTabWidget({ context }: InjectionWidgetComponentProps<unknown, unknown>) {
  const t = useT()
  const personId = resolvePersonId(context)
  if (!personId) return null
  return (
    <LinkedTicketsList
      filterKey="customerPersonId"
      filterValue={personId}
      emptyTitle={t('tickets.personTab.empty.title', 'No tickets for this customer')}
      emptyDescription={t('tickets.personTab.empty.description', 'Tickets linked to this person through classification appear here.')}
      listLabel={t('tickets.personTab.listLabel', 'Customer tickets')}
      testId="person-tickets-tab"
    />
  )
}
