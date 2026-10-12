import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PersonTicketsTabWidget from './widget.client'

type PersonTicketsContext = {
  resourceKind: string
  resourceId: string
}

const widget: InjectionWidgetModule<PersonTicketsContext, unknown> = {
  metadata: {
    id: 'tickets.injection.person-tickets-tab',
    title: 'Tickets',
    description: 'Helpdesk tickets linked to the current customer person.',
    features: ['tickets.view'],
    priority: 35,
    enabled: true,
  },
  Widget: PersonTicketsTabWidget,
}

export default widget
