import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'detail:customers.person:tabs': [
    {
      widgetId: 'reservations.injection.person-reservations-tab',
      kind: 'tab',
      groupLabel: 'reservations.personTab.title',
      priority: 35,
    },
  ],
}

export default injectionTable
