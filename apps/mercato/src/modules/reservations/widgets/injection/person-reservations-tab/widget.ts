import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import PersonReservationsTabWidget from './widget.client'

type PersonContext = {
  resourceKind?: string
  resourceId?: string
}

const widget: InjectionWidgetModule<PersonContext, unknown> = {
  metadata: {
    id: 'reservations.injection.person-reservations-tab',
    title: 'Reservations',
    description: 'Travel reservations linked to the current customer person.',
    features: ['reservations.view'],
    requiredModules: ['customers'],
    priority: 35,
    enabled: true,
  },
  Widget: PersonReservationsTabWidget,
}

export default widget
