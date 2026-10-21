import type { ModuleInjectionTable } from '@open-mercato/shared/modules/widgets/injection'

export const injectionTable: ModuleInjectionTable = {
  'detail:customers.person:tabs': [
    {
      widgetId: 'tickets.injection.person-tickets-tab',
      kind: 'tab',
      groupLabel: 'tickets.personTab.title',
      priority: 35,
    },
  ],
  'detail:reservations.reservation:tabs': [
    {
      widgetId: 'tickets.injection.reservation-tickets-tab',
      kind: 'tab',
      groupLabel: 'tickets.reservationTab.title',
      priority: 35,
    },
  ],
  'data-table:tickets.ticket:toolbar': [
    {
      widgetId: 'tickets.injection.simulate-email',
      priority: 50,
    },
  ],
}

export default injectionTable
