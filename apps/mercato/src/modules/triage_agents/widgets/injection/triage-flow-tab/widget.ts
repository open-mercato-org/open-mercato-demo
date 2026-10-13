import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import TriageFlowTabWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'triage_agents.injection.triage-flow-tab',
    title: 'AI triage flow',
    description: 'The process flow of the ticket triage (agent runs, tool calls, disposition, effector results) with every attempt, playback, compare and re-run.',
    features: ['triage_agents.view', 'agent_orchestrator.trace.view'],
    priority: 50,
    enabled: true,
  },
  Widget: TriageFlowTabWidget,
}

export default widget
