export const RESERVATION_STATUSES = ['pending_payment', 'confirmed', 'cancelled', 'completed'] as const
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number]

export const PAYMENT_STATUSES = ['pending', 'booked', 'failed'] as const
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number]

export const PAYMENT_METHODS = ['transfer', 'card', 'cash', 'other'] as const
export type PaymentMethod = (typeof PAYMENT_METHODS)[number]

export const REFUND_STATUSES = ['requested', 'approved', 'executed', 'rejected', 'cancelled'] as const
export type RefundStatus = (typeof REFUND_STATUSES)[number]

export const REFUND_TRANSITION_TARGETS = ['approved', 'executed', 'rejected'] as const
export type RefundTransitionTarget = (typeof REFUND_TRANSITION_TARGETS)[number]

export const REFUND_COUNTED_STATUSES: ReadonlyArray<RefundStatus> = ['requested', 'approved', 'executed']

export const REFUND_TRANSITIONS: Readonly<Record<RefundStatus, ReadonlyArray<RefundStatus>>> = {
  requested: ['approved', 'rejected'],
  approved: ['executed', 'rejected'],
  executed: [],
  rejected: [],
  cancelled: [],
}

export const RESERVATION_ENTITY_ID = 'reservations:reservation' as const
export const RESERVATION_PAYMENT_ENTITY_ID = 'reservations:reservation_payment' as const
export const RESERVATION_REFUND_ENTITY_ID = 'reservations:reservation_refund' as const

export const RESERVATION_RESOURCE_KIND = 'reservations.reservation' as const
export const RESERVATION_PAYMENT_RESOURCE_KIND = 'reservations.reservation_payment' as const
export const RESERVATION_REFUND_RESOURCE_KIND = 'reservations.reservation_refund' as const

export const CUSTOMER_ENTITY_ID = 'customers:customer_entity' as const

export const DEFAULT_CURRENCY_CODE = 'EUR'
export const DEPARTURE_SOON_DAYS = 3
export const MAX_CUSTOMER_RESERVATIONS = 20
