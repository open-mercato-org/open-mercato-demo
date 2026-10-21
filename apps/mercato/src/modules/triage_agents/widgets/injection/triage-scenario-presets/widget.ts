import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import TriageScenarioPresetsWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'triage_agents.injection.triage-scenario-presets',
    title: 'Send demo scenario',
    description: 'Sends one of the six demo customer emails through the simulated inbound intake.',
    features: ['tickets.intake.simulate', 'triage_agents.view'],
    priority: 40,
    enabled: true,
  },
  Widget: TriageScenarioPresetsWidget,
}

export default widget
