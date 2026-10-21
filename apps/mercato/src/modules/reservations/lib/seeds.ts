import type { AwilixContainer } from 'awilix'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Reservation, ReservationRefund } from '../data/entities'
import type { PaymentMethod, PaymentStatus, ReservationStatus } from '../data/constants'
import { findCustomerPersonByEmail } from './customerLookup'
import { addDaysToDateOnly, resolveReservationsTimeZone, todayInTimeZone, toDateOnlyString } from './dates'

export type DemoSeedScope = {
  tenantId: string
  organizationId: string
}

export type DemoPaymentSeed = {
  amount: number
  status: PaymentStatus
  method: PaymentMethod
  paidOffsetDays: number
  externalReference: string
}

export type DemoReservationSeed = {
  bookingNumber: string
  personaEmail: string
  status: ReservationStatus
  destination: string
  hotelName: string
  roomType: string
  boardType: string
  departureOffsetDays: number
  durationDays: number
  travelersCount: number
  totalPrice: number
  notes: string | null
  payments: DemoPaymentSeed[]
}

export type DemoPersonaSeed = {
  firstName: string
  lastName: string
  email: string
}

export const DEMO_PERSONAS: ReadonlyArray<DemoPersonaSeed> = [
  { firstName: 'Anna', lastName: 'Carter', email: 'anna.carter@example.com' },
  { firstName: 'Peter', lastName: 'Brooks', email: 'peter.brooks@example.com' },
  { firstName: 'Maria', lastName: 'Lopez', email: 'maria.lopez@example.com' },
  { firstName: 'Emma', lastName: 'Wilson', email: 'emma.wilson@example.com' },
  { firstName: 'Tom', lastName: 'Walker', email: 'tom.walker@example.com' },
  { firstName: 'John', lastName: 'Miller', email: 'john.miller@example.com' },
]

export const DEMO_RESERVATIONS: ReadonlyArray<DemoReservationSeed> = [
  {
    bookingNumber: 'ABC123',
    personaEmail: 'anna.carter@example.com',
    status: 'confirmed',
    destination: 'Crete, Greece',
    hotelName: 'Hotel Minos Beach',
    roomType: 'Double room, sea view',
    boardType: 'All inclusive',
    departureOffsetDays: 3,
    durationDays: 7,
    travelersCount: 2,
    totalPrice: 2400,
    notes: 'Customer paid the second instalment twice by mistake.',
    payments: [
      { amount: 2000, status: 'booked', method: 'transfer', paidOffsetDays: -40, externalReference: 'ABC123 deposit' },
      { amount: 750, status: 'booked', method: 'transfer', paidOffsetDays: -10, externalReference: 'ABC123 final payment' },
    ],
  },
  {
    bookingNumber: 'XYZ789',
    personaEmail: 'peter.brooks@example.com',
    status: 'confirmed',
    destination: 'Algarve, Portugal',
    hotelName: 'Hotel Oceano',
    roomType: 'Double room',
    boardType: 'Half board',
    departureOffsetDays: 40,
    durationDays: 10,
    travelersCount: 2,
    totalPrice: 1800,
    notes: null,
    payments: [
      { amount: 1800, status: 'booked', method: 'transfer', paidOffsetDays: -2, externalReference: 'XYZ789 full payment' },
    ],
  },
  {
    bookingNumber: 'MLZ456',
    personaEmail: 'maria.lopez@example.com',
    status: 'pending_payment',
    destination: 'Tenerife, Spain',
    hotelName: 'Hotel Teide Palace',
    roomType: 'Junior suite',
    boardType: 'Breakfast',
    departureOffsetDays: 12,
    durationDays: 7,
    travelersCount: 1,
    totalPrice: 1350,
    notes: null,
    payments: [
      { amount: 1350, status: 'pending', method: 'transfer', paidOffsetDays: -1, externalReference: 'MLZ456 transfer' },
    ],
  },
  {
    bookingNumber: 'AUR901',
    personaEmail: 'emma.wilson@example.com',
    status: 'confirmed',
    destination: 'Rhodes, Greece',
    hotelName: 'Hotel Aurora',
    roomType: 'Family room',
    boardType: 'All inclusive',
    departureOffsetDays: 9,
    durationDays: 7,
    travelersCount: 3,
    totalPrice: 3100,
    notes: null,
    payments: [
      { amount: 3100, status: 'booked', method: 'card', paidOffsetDays: -30, externalReference: 'AUR901 card payment' },
    ],
  },
  {
    bookingNumber: 'SOL902',
    personaEmail: 'emma.wilson@example.com',
    status: 'pending_payment',
    destination: 'Mallorca, Spain',
    hotelName: 'Hotel Sol',
    roomType: 'Double room',
    boardType: 'Half board',
    departureOffsetDays: 120,
    durationDays: 14,
    travelersCount: 2,
    totalPrice: 2600,
    notes: null,
    payments: [
      { amount: 500, status: 'booked', method: 'transfer', paidOffsetDays: -5, externalReference: 'SOL902 deposit' },
    ],
  },
  {
    bookingNumber: 'TWK310',
    personaEmail: 'tom.walker@example.com',
    status: 'completed',
    destination: 'Antalya, Turkey',
    hotelName: 'Hotel Lara Bay',
    roomType: 'Double room',
    boardType: 'All inclusive',
    departureOffsetDays: -14,
    durationDays: 7,
    travelersCount: 2,
    totalPrice: 1900,
    notes: null,
    payments: [
      { amount: 1900, status: 'booked', method: 'transfer', paidOffsetDays: -60, externalReference: 'TWK310 full payment' },
    ],
  },
  {
    bookingNumber: 'JML501',
    personaEmail: 'john.miller@example.com',
    status: 'confirmed',
    destination: 'Sicily, Italy',
    hotelName: 'Hotel Baia Taormina',
    roomType: 'Double room',
    boardType: 'Breakfast',
    departureOffsetDays: 21,
    durationDays: 7,
    travelersCount: 2,
    totalPrice: 2200,
    notes: null,
    payments: [
      { amount: 2200, status: 'booked', method: 'transfer', paidOffsetDays: -20, externalReference: 'JML501 full payment' },
    ],
  },
  {
    bookingNumber: 'JML502',
    personaEmail: 'john.miller@example.com',
    status: 'confirmed',
    destination: 'Madeira, Portugal',
    hotelName: 'Hotel Funchal Garden',
    roomType: 'Single room',
    boardType: 'Half board',
    departureOffsetDays: 55,
    durationDays: 10,
    travelersCount: 1,
    totalPrice: 1650,
    notes: null,
    payments: [
      { amount: 1650, status: 'booked', method: 'card', paidOffsetDays: -15, externalReference: 'JML502 card payment' },
    ],
  },
]

export function buildSeedCommandContext(container: AwilixContainer, scope: DemoSeedScope): CommandRuntimeContext {
  return {
    container,
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }
}

export function computeSeedDates(
  seed: Pick<DemoReservationSeed, 'departureOffsetDays' | 'durationDays'>,
  today: string,
): { departureDate: string; returnDate: string } {
  const departureDate = addDaysToDateOnly(today, seed.departureOffsetDays)
  return { departureDate, returnDate: addDaysToDateOnly(departureDate, seed.durationDays) }
}

function offsetTimestamp(now: Date, days: number): string {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000).toISOString()
}

async function resolvePersonaId(
  container: AwilixContainer,
  em: EntityManager,
  scope: DemoSeedScope,
  persona: DemoPersonaSeed,
): Promise<{ id: string; created: boolean }> {
  const fromReservation = await findOneWithDecryption(
    em,
    Reservation,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      customerEmailHash: { $in: lookupHashCandidates(persona.email) },
    } as FilterQuery<Reservation>,
    {},
    scope,
  )
  if (fromReservation?.customerPersonId) return { id: fromReservation.customerPersonId, created: false }
  const existing = await findCustomerPersonByEmail(container, scope, persona.email)
  if (existing) return { id: existing.id, created: false }
  const commandBus = container.resolve('commandBus') as CommandBus
  const { result } = await commandBus.execute<Record<string, unknown>, { entityId?: string }>('customers.people.create', {
    input: {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      firstName: persona.firstName,
      lastName: persona.lastName,
      displayName: `${persona.firstName} ${persona.lastName}`,
      primaryEmail: persona.email,
      status: 'active',
      lifecycleStage: 'customer',
      source: 'reservations_demo',
    },
    ctx: buildSeedCommandContext(container, scope),
  })
  if (!result?.entityId) throw new Error('[internal] customers.people.create returned no entity id')
  return { id: result.entityId, created: true }
}

export async function seedReservationsDemo(
  container: AwilixContainer,
  scope: DemoSeedScope,
  options: { now?: Date; timeZone?: string } = {},
): Promise<{ peopleCreated: number; reservationsCreated: number }> {
  const now = options.now ?? new Date()
  const today = todayInTimeZone(now, options.timeZone ?? resolveReservationsTimeZone())
  const em = (container.resolve('em') as EntityManager).fork()
  const commandBus = container.resolve('commandBus') as CommandBus
  const ctx = buildSeedCommandContext(container, scope)
  const personIds = new Map<string, string>()
  let peopleCreated = 0
  let reservationsCreated = 0

  for (const persona of DEMO_PERSONAS) {
    const resolved = await resolvePersonaId(container, em, scope, persona)
    personIds.set(persona.email, resolved.id)
    if (resolved.created) peopleCreated += 1
  }

  for (const seed of DEMO_RESERVATIONS) {
    const existing = await findOneWithDecryption(
      em,
      Reservation,
      { tenantId: scope.tenantId, organizationId: scope.organizationId, bookingNumber: seed.bookingNumber, deletedAt: null } as FilterQuery<Reservation>,
      {},
      scope,
    )
    if (existing) continue
    const persona = DEMO_PERSONAS.find((entry) => entry.email === seed.personaEmail)
    const personId = personIds.get(seed.personaEmail)
    if (!persona || !personId) continue
    const dates = computeSeedDates(seed, today)
    const { result } = await commandBus.execute<Record<string, unknown>, { reservationId: string }>('reservations.reservation.create', {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        bookingNumber: seed.bookingNumber,
        customerPersonId: personId,
        customerEmail: persona.email,
        customerName: `${persona.firstName} ${persona.lastName}`,
        status: seed.status,
        destination: seed.destination,
        hotelName: seed.hotelName,
        roomType: seed.roomType,
        boardType: seed.boardType,
        departureDate: dates.departureDate,
        returnDate: dates.returnDate,
        travelersCount: seed.travelersCount,
        totalPriceAmount: seed.totalPrice,
        currencyCode: 'EUR',
        notes: seed.notes,
      },
      ctx,
    })
    reservationsCreated += 1
    for (const payment of seed.payments) {
      const paidAt = offsetTimestamp(now, payment.paidOffsetDays)
      await commandBus.execute('reservations.payment.record', {
        input: {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          reservationId: result.reservationId,
          amount: payment.amount,
          currencyCode: 'EUR',
          status: payment.status,
          method: payment.method,
          paidAt,
          bookedAt: payment.status === 'booked' ? paidAt : null,
          externalReference: payment.externalReference,
        },
        ctx,
      })
    }
  }

  return { peopleCreated, reservationsCreated }
}

export async function reanchorDemoReservationDates(
  container: AwilixContainer,
  options: { tenantId?: string | null; organizationId?: string | null; now?: Date; timeZone?: string } = {},
): Promise<{ updated: number; unchanged: number }> {
  const now = options.now ?? new Date()
  const today = todayInTimeZone(now, options.timeZone ?? resolveReservationsTimeZone())
  const em = (container.resolve('em') as EntityManager).fork()
  const commandBus = container.resolve('commandBus') as CommandBus
  const where: Record<string, unknown> = {
    bookingNumber: { $in: DEMO_RESERVATIONS.map((seed) => seed.bookingNumber) },
    deletedAt: null,
  }
  if (options.tenantId) where.tenantId = options.tenantId
  if (options.organizationId) where.organizationId = options.organizationId
  const reservations = await findWithDecryption(
    em,
    Reservation,
    where as FilterQuery<Reservation>,
    {},
    options.tenantId ? { tenantId: options.tenantId, organizationId: options.organizationId ?? null } : undefined,
  )
  let updated = 0
  let unchanged = 0
  for (const reservation of reservations) {
    const seed = DEMO_RESERVATIONS.find((entry) => entry.bookingNumber === reservation.bookingNumber)
    if (!seed) continue
    const dates = computeSeedDates(seed, today)
    if (
      toDateOnlyString(reservation.departureDate) === dates.departureDate &&
      toDateOnlyString(reservation.returnDate) === dates.returnDate
    ) {
      unchanged += 1
      continue
    }
    const scope = { tenantId: reservation.tenantId, organizationId: reservation.organizationId }
    await commandBus.execute('reservations.reservation.update', {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        id: reservation.id,
        departureDate: dates.departureDate,
        returnDate: dates.returnDate,
      },
      ctx: buildSeedCommandContext(container, scope),
    })
    updated += 1
  }
  return { updated, unchanged }
}

const DEMO_RESET_REFUND_STATUSES = ['requested', 'approved'] as const

export async function resetDemoRefunds(
  container: AwilixContainer,
  options: { tenantId?: string | null; organizationId?: string | null; reason?: string } = {},
): Promise<{ rejected: number }> {
  const em = (container.resolve('em') as EntityManager).fork()
  const commandBus = container.resolve('commandBus') as CommandBus
  const reservationWhere: Record<string, unknown> = {
    bookingNumber: { $in: DEMO_RESERVATIONS.map((seed) => seed.bookingNumber) },
    deletedAt: null,
  }
  if (options.tenantId) reservationWhere.tenantId = options.tenantId
  if (options.organizationId) reservationWhere.organizationId = options.organizationId
  const decryptionScope = options.tenantId ? { tenantId: options.tenantId, organizationId: options.organizationId ?? null } : undefined
  const reservations = await findWithDecryption(em, Reservation, reservationWhere as FilterQuery<Reservation>, {}, decryptionScope)
  if (reservations.length === 0) return { rejected: 0 }
  const refunds = await findWithDecryption(
    em,
    ReservationRefund,
    {
      reservationId: { $in: reservations.map((reservation) => reservation.id) },
      status: { $in: [...DEMO_RESET_REFUND_STATUSES] },
      deletedAt: null,
    } as FilterQuery<ReservationRefund>,
    {},
    decryptionScope,
  )
  let rejected = 0
  for (const refund of refunds) {
    const scope = { tenantId: refund.tenantId, organizationId: refund.organizationId }
    await commandBus.execute('reservations.refund.transition', {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        id: refund.id,
        to: 'rejected',
        reason: options.reason ?? 'Demo reset',
      },
      ctx: buildSeedCommandContext(container, scope),
    })
    rejected += 1
  }
  return { rejected }
}
