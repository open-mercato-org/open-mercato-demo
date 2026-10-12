import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'detail:tickets.ticket:header': [
    {
      widgetId: 'triage_agents.injection.triage-summary-card',
      priority: 60,
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
