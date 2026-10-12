import { createModuleEvents } from '@open-mercato/shared/modules/events'

const events = [
  { id: 'reservations.reservation.created', label: 'Reservation Created', entity: 'reservation', category: 'crud', clientBroadcast: true },
  { id: 'reservations.reservation.updated', label: 'Reservation Updated', entity: 'reservation', category: 'crud', clientBroadcast: true },
  { id: 'reservations.reservation.deleted', label: 'Reservation Deleted', entity: 'reservation', category: 'crud', clientBroadcast: true },
  { id: 'reservations.payment.recorded', label: 'Reservation Payment Recorded', entity: 'payment', category: 'lifecycle', clientBroadcast: true },
  { id: 'reservations.refund.requested', label: 'Reservation Refund Requested', entity: 'refund', category: 'lifecycle', clientBroadcast: true },
  { id: 'reservations.refund.status_changed', label: 'Reservation Refund Status Changed', entity: 'refund', category: 'lifecycle', clientBroadcast: true },
] as const

export const eventsConfig = createModuleEvents({
  moduleId: 'reservations',
  events,
})

export const emitReservationsEvent = eventsConfig.emit

export type ReservationsEventId = typeof events[number]['id']

export default eventsConfig
