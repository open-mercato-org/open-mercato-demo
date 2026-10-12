import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property } from '@mikro-orm/decorators/legacy'
import type {
  PaymentMethod,
  PaymentStatus,
  RefundStatus,
  ReservationStatus,
} from './constants'

@Entity({ tableName: 'reservations' })
@Index({ name: 'reservations_customer_idx', properties: ['organizationId', 'customerPersonId'] })
@Index({ name: 'reservations_departure_idx', properties: ['organizationId', 'departureDate'] })
@Index({ name: 'reservations_email_hash_idx', properties: ['organizationId', 'customerEmailHash'] })
@Index({
  name: 'reservations_booking_number_unique',
  expression:
    'create unique index "reservations_booking_number_unique" on "reservations" ("organization_id", "booking_number") where "deleted_at" is null',
})
export class Reservation {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'status' | 'travelersCount'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'booking_number', type: 'varchar', length: 32 })
  bookingNumber!: string

  @Property({ name: 'customer_person_id', type: 'uuid' })
  customerPersonId!: string

  @Property({ name: 'customer_email_snapshot', type: 'text', nullable: true })
  customerEmailSnapshot?: string | null

  @Property({ name: 'customer_email_hash', type: 'text', nullable: true })
  customerEmailHash?: string | null

  @Property({ name: 'customer_name_snapshot', type: 'text', nullable: true })
  customerNameSnapshot?: string | null

  @Property({ name: 'status', type: 'text', default: 'pending_payment' })
  status: ReservationStatus = 'pending_payment'

  @Property({ name: 'destination', type: 'varchar', length: 200 })
  destination!: string

  @Property({ name: 'hotel_name', type: 'varchar', length: 200 })
  hotelName!: string

  @Property({ name: 'room_type', type: 'varchar', length: 120, nullable: true })
  roomType?: string | null

  @Property({ name: 'board_type', type: 'varchar', length: 120, nullable: true })
  boardType?: string | null

  @Property({ name: 'departure_date', type: 'date' })
  departureDate!: string

  @Property({ name: 'return_date', type: 'date' })
  returnDate!: string

  @Property({ name: 'travelers_count', type: 'int', default: 1 })
  travelersCount: number = 1

  @Property({ name: 'total_price_amount', type: 'numeric', precision: 14, scale: 2 })
  totalPriceAmount!: string

  @Property({ name: 'currency_code', type: 'varchar', length: 3 })
  currencyCode!: string

  @Property({ name: 'notes', type: 'text', nullable: true })
  notes?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'reservation_payments' })
@Index({ name: 'reservation_payments_reservation_idx', properties: ['organizationId', 'reservationId'] })
export class ReservationPayment {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'status' | 'method'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'reservation_id', type: 'uuid' })
  reservationId!: string

  @Property({ name: 'amount', type: 'numeric', precision: 14, scale: 2 })
  amount!: string

  @Property({ name: 'currency_code', type: 'varchar', length: 3 })
  currencyCode!: string

  @Property({ name: 'status', type: 'text', default: 'pending' })
  status: PaymentStatus = 'pending'

  @Property({ name: 'method', type: 'text', default: 'transfer' })
  method: PaymentMethod = 'transfer'

  @Property({ name: 'paid_at', type: Date, nullable: true })
  paidAt?: Date | null

  @Property({ name: 'booked_at', type: Date, nullable: true })
  bookedAt?: Date | null

  @Property({ name: 'external_reference', type: 'varchar', length: 200, nullable: true })
  externalReference?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'reservation_refunds' })
@Index({ name: 'reservation_refunds_reservation_idx', properties: ['organizationId', 'reservationId'] })
export class ReservationRefund {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt' | 'status'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'reservation_id', type: 'uuid' })
  reservationId!: string

  @Property({ name: 'amount', type: 'numeric', precision: 14, scale: 2 })
  amount!: string

  @Property({ name: 'currency_code', type: 'varchar', length: 3 })
  currencyCode!: string

  @Property({ name: 'bank_account_number', type: 'text' })
  bankAccountNumber!: string

  @Property({ name: 'bank_account_last4', type: 'varchar', length: 4 })
  bankAccountLast4!: string

  @Property({ name: 'reason', type: 'text', nullable: true })
  reason?: string | null

  @Property({ name: 'status', type: 'text', default: 'requested' })
  status: RefundStatus = 'requested'

  @Property({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId?: string | null

  @Property({ name: 'source_type', type: 'varchar', length: 64, nullable: true })
  sourceType?: string | null

  @Property({ name: 'source_ref', type: 'varchar', length: 200, nullable: true })
  sourceRef?: string | null

  @Property({ name: 'related_ticket_id', type: 'uuid', nullable: true })
  relatedTicketId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}
