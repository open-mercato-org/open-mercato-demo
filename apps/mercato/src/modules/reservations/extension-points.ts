import {
  defineModuleExtensionPoints,
  injectionExtensionHost,
} from '@open-mercato/shared/modules/widgets/extension-points'

export const RESERVATION_TABS_SPOT_ID = 'detail:reservations.reservation:tabs' as const

export const extensionPoints = defineModuleExtensionPoints({
  moduleId: 'reservations',
  hosts: {
    reservationTabs: injectionExtensionHost({
      family: 'detail',
      spotId: RESERVATION_TABS_SPOT_ID,
      supported: ['render-widget'],
      contextContract: 'reservations.detail.v1',
      source: 'components/ReservationDetail.tsx',
    }),
  },
})

export default extensionPoints
