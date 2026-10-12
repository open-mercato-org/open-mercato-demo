import {
  dataTableExtensionHost,
  defineModuleExtensionPoints,
  injectionExtensionHost,
} from '@open-mercato/shared/modules/widgets/extension-points'

const DETAIL_SOURCE = 'backend/tickets/[id]/page.tsx'

const detailHost = (spotId: string) => injectionExtensionHost({
  family: 'detail',
  spotId,
  supported: ['render-widget'],
  contextContract: 'tickets.detail.v1',
  source: DETAIL_SOURCE,
})

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'tickets',
  hosts: {
    ticketsTable: dataTableExtensionHost({
      tableId: 'tickets.ticket',
      source: 'components/TicketsQueueTable.tsx',
    }),
    ticketHeader: detailHost('detail:tickets.ticket:header'),
    ticketSidebar: detailHost('detail:tickets.ticket:sidebar'),
    ticketTabs: detailHost('detail:tickets.ticket:tabs'),
    ticketComposer: injectionExtensionHost({
      family: 'detail',
      spotId: 'detail:tickets.ticket:composer',
      supported: ['render-widget'],
      contextContract: 'tickets.composer.v1',
      source: DETAIL_SOURCE,
    }),
  },
})

export default extensionPoints
