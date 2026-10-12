"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { InjectionWidgetComponentProps } from '@open-mercato/shared/modules/widgets/injection'
import { LinkedTicketsList } from '../../../components/LinkedTicketsList'
import { resolveReservationId } from '../../../lib/injectionContext'

export default function ReservationTicketsTabWidget({ context }: InjectionWidgetComponentProps<unknown, unknown>) {
  const t = useT()
  const reservationId = resolveReservationId(context)
  if (!reservationId) return null
  return (
    <LinkedTicketsList
      filterKey="reservationId"
      filterValue={reservationId}
      emptyTitle={t('tickets.reservationTab.empty.title', 'No tickets for this reservation')}
      emptyDescription={t('tickets.reservationTab.empty.description', 'Tickets linked to this reservation through classification appear here.')}
      listLabel={t('tickets.reservationTab.listLabel', 'Reservation tickets')}
      testId="reservation-tickets-tab"
    />
  )
}
