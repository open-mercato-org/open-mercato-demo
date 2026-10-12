import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import SimulateEmailToolbarWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'tickets.injection.simulate-email',
    title: 'Simulate inbound email',
    description: 'Opens a dialog that feeds a simulated inbound email through the ticket intake.',
    features: ['tickets.intake.simulate'],
    priority: 50,
    enabled: true,
  },
  Widget: SimulateEmailToolbarWidget,
}

export default widget
