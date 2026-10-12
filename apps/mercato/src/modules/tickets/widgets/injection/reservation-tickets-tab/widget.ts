import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import ReservationTicketsTabWidget from './widget.client'

type ReservationTicketsContext = {
  resourceKind: string
  resourceId: string
  reservationId?: string
}

const widget: InjectionWidgetModule<ReservationTicketsContext, unknown> = {
  metadata: {
    id: 'tickets.injection.reservation-tickets-tab',
    title: 'Tickets',
    description: 'Helpdesk tickets linked to the current reservation.',
    features: ['tickets.view'],
    priority: 35,
    enabled: true,
  },
  Widget: ReservationTicketsTabWidget,
}

export default widget
