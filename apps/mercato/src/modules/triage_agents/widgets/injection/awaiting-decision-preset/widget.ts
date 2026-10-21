import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { AWAITING_DECISION_FEATURES } from '../../../data/constants'
import AwaitingDecisionPresetWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'triage_agents.injection.awaiting-decision-preset',
    title: 'Awaiting decision preset',
    description: 'One-click queue preset for tickets whose AI proposal awaits a human decision, with the pending count.',
    features: [...AWAITING_DECISION_FEATURES],
    priority: 60,
    enabled: true,
  },
  Widget: AwaitingDecisionPresetWidget,
}

export default widget
