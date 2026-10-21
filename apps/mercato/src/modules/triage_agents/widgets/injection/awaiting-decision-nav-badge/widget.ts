import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import { AWAITING_DECISION_FEATURES } from '../../../data/constants'
import AwaitingDecisionNavBadgeWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'triage_agents.injection.awaiting-decision-nav-badge',
    title: 'Awaiting decision count',
    description: 'Publishes the count of tickets awaiting a decision onto the Helpdesk sidebar entry.',
    features: [...AWAITING_DECISION_FEATURES],
    priority: 50,
    enabled: true,
  },
  Widget: AwaitingDecisionNavBadgeWidget,
}

export default widget
