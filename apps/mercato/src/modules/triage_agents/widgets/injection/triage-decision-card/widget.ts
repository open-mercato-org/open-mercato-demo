import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import TriageDecisionCardWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'triage_agents.injection.triage-decision-card',
    title: 'AI proposal',
    description: 'The pending AI triage proposal of the ticket as an embedded decision card: facts, checks, knowledge-base citations, editable actions, approve & send or reject.',
    features: ['triage_agents.view', 'agent_orchestrator.proposals.view'],
    priority: 60,
    enabled: true,
  },
  Widget: TriageDecisionCardWidget,
}

export default widget
