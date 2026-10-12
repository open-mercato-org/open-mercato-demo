import type { InjectionWidgetModule } from '@open-mercato/shared/modules/widgets/injection'
import TriageSummaryCardWidget from './widget.client'

const widget: InjectionWidgetModule<Record<string, unknown>, Record<string, unknown>> = {
  metadata: {
    id: 'triage_agents.injection.triage-summary-card',
    title: 'AI triage summary',
    description: 'The AI triage result of the ticket: customer and reservation match, category, priority, recommended action, AI status and uncertainty.',
    features: ['triage_agents.view'],
    priority: 60,
    enabled: true,
  },
  Widget: TriageSummaryCardWidget,
}

export default widget
