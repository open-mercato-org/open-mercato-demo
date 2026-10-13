import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'detail:tickets.ticket:header': [
    {
      widgetId: 'triage_agents.injection.triage-summary-card',
      priority: 60,
    },
  ],
  'detail:tickets.ticket:composer': [
    {
      widgetId: 'triage_agents.injection.triage-decision-card',
      priority: 60,
    },
  ],
  'detail:tickets.ticket:tabs': [
    {
      widgetId: 'triage_agents.injection.triage-flow-tab',
      kind: 'tab',
      groupLabel: 'triage_agents.flow.tabTitle',
      priority: 50,
    },
  ],
  'data-table:tickets.ticket:columns': [
    {
      widgetId: 'triage_agents.injection.triage-queue-column',
      priority: 50,
    },
  ],
  'data-table:tickets.ticket:filters': [
    {
      widgetId: 'triage_agents.injection.triage-queue-filter',
      priority: 50,
    },
  ],
  'data-table:tickets.ticket:toolbar': [
    {
      widgetId: 'triage_agents.injection.triage-scenario-presets',
      priority: 40,
    },
  ],
}

export default injectionTable
