import type { Reservation } from '../data/entities'
import {
  findReservationByBookingNumber,
  getReservationDetails,
  listReservationsForCustomer,
  resolveOwnerMatch,
  type ReservationsToolDeps,
} from '../lib/aiToolHandlers'
import { requireToolScope } from '../ai-tools'

const scope = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const now = new Date('2026-10-12T09:00:00Z')

function buildReservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    id: '33333333-3333-4333-8333-333333333333',
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    bookingNumber: 'ABC123',
    customerPersonId: '44444444-4444-4444-8444-444444444444',
    customerEmailSnapshot: 'anna.carter@example.com',
    customerEmailHash: 'hash',
    customerNameSnapshot: 'Anna Carter',
    status: 'confirmed',
    destination: 'Crete, Greece',
    hotelName: 'Hotel Minos Beach',
    roomType: 'Double room',
    boardType: 'All inclusive',
    departureDate: '2026-10-15',
    returnDate: '2026-10-22',
    travelersCount: 2,
    totalPriceAmount: '2400.00',
    currencyCode: 'EUR',
    notes: 'Paid twice',
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    ...overrides,
  } as Reservation
}

function buildDeps(overrides: Partial<ReservationsToolDeps> = {}): ReservationsToolDeps {
  return {
    findByBookingNumber: jest.fn(async () => buildReservation()),
    listForCustomerPerson: jest.fn(async () => [buildReservation()]),
    listForEmail: jest.fn(async () => [buildReservation()]),
    getDetails: jest.fn(async () => null),
    loadPersonContact: jest.fn(async () => ({ id: '44444444-4444-4444-8444-444444444444', displayName: 'Anna Carter', primaryEmail: 'anna.new@example.com' })),
    now: () => now,
    ...overrides,
  }
}

describe('reservations.find_by_booking_number', () => {
  it('returns the reservation when the sender matches the email stored at booking time', async () => {
    const result = await findReservationByBookingNumber(buildDeps(), scope, {
      bookingNumber: 'abc-123',
      senderEmail: 'Anna.Carter@Example.com',
    })
    expect(result.found).toBe(true)
    expect(result.ownerMatch).toBe('match')
    expect(result.reservation?.bookingNumber).toBe('ABC123')
    expect(result.reservation?.daysToDeparture).toBe(3)
  })

  it('also matches the customer person\'s current primary email', async () => {
    const result = await findReservationByBookingNumber(buildDeps(), scope, {
      bookingNumber: 'ABC123',
      senderEmail: 'anna.new@example.com',
    })
    expect(result.ownerMatch).toBe('match')
    expect(result.reservation).toBeDefined()
  })

  it('withholds every reservation detail on an owner mismatch', async () => {
    const result = await findReservationByBookingNumber(buildDeps(), scope, {
      bookingNumber: 'ABC123',
      senderEmail: 'attacker@example.com',
    })
    expect(result).toEqual({ found: true, ownerMatch: 'mismatch' })
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain('Anna')
    expect(serialized).not.toContain('anna')
    expect(serialized).not.toContain('Crete')
    expect(serialized).not.toContain('Minos')
    expect(serialized).not.toContain('2400')
  })

  it('reports not found without an owner verdict', async () => {
    const result = await findReservationByBookingNumber(
      buildDeps({ findByBookingNumber: jest.fn(async () => null) }),
      scope,
      { bookingNumber: 'NOPE1', senderEmail: 'anna.carter@example.com' },
    )
    expect(result).toEqual({ found: false, ownerMatch: 'unknown' })
  })

  it('returns ownerMatch unknown when no sender email is given', async () => {
    const deps = buildDeps()
    const result = await findReservationByBookingNumber(deps, scope, { bookingNumber: 'ABC123' })
    expect(result.ownerMatch).toBe('unknown')
    expect(result.reservation?.id).toBe('33333333-3333-4333-8333-333333333333')
    expect(deps.loadPersonContact).not.toHaveBeenCalled()
  })

  it('treats a failed person lookup as a snapshot-only comparison', async () => {
    const result = await findReservationByBookingNumber(
      buildDeps({ loadPersonContact: jest.fn(async () => { throw new Error('boom') }) }),
      scope,
      { bookingNumber: 'ABC123', senderEmail: 'someone@example.com' },
    )
    expect(result).toEqual({ found: true, ownerMatch: 'mismatch' })
  })
})

describe('resolveOwnerMatch', () => {
  it('is unknown without a sender or without stored emails', () => {
    expect(resolveOwnerMatch(null, ['a@example.com'])).toBe('unknown')
    expect(resolveOwnerMatch('a@example.com', [null, undefined])).toBe('unknown')
  })
})

describe('reservations.list_for_customer', () => {
  it('lists by person id and returns summaries only', async () => {
    const deps = buildDeps()
    const result = await listReservationsForCustomer(deps, scope, { customerPersonId: '44444444-4444-4444-8444-444444444444' })
    expect(deps.listForCustomerPerson).toHaveBeenCalledWith(scope, '44444444-4444-4444-8444-444444444444')
    expect(result.customerPersonId).toBe('44444444-4444-4444-8444-444444444444')
    expect(result.reservations[0]).toEqual({
      id: '33333333-3333-4333-8333-333333333333',
      bookingNumber: 'ABC123',
      destination: 'Crete, Greece',
      hotelName: 'Hotel Minos Beach',
      departureDate: '2026-10-15',
      returnDate: '2026-10-22',
      status: 'confirmed',
      daysToDeparture: 3,
    })
  })

  it('lists by email through the hashed lookup and derives the person id', async () => {
    const deps = buildDeps()
    const result = await listReservationsForCustomer(deps, scope, { email: 'anna.carter@example.com' })
    expect(deps.listForEmail).toHaveBeenCalledWith(scope, 'anna.carter@example.com')
    expect(result.customerPersonId).toBe('44444444-4444-4444-8444-444444444444')
  })

  it('caps the result at 20 reservations', async () => {
    const many = Array.from({ length: 25 }, (_, index) => buildReservation({ id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}` }))
    const result = await listReservationsForCustomer(buildDeps({ listForEmail: jest.fn(async () => many) }), scope, { email: 'anna.carter@example.com' })
    expect(result.reservations).toHaveLength(20)
  })

  it('requires a person id or an email', async () => {
    await expect(listReservationsForCustomer(buildDeps(), scope, {})).rejects.toThrow()
  })
})

describe('reservations.get_details', () => {
  it('returns found false for unknown reservations', async () => {
    const result = await getReservationDetails(buildDeps(), scope, { reservationId: '33333333-3333-4333-8333-333333333333' })
    expect(result).toEqual({ found: false })
  })
})

describe('requireToolScope', () => {
  it('fails closed without tenant or organization', () => {
    expect(() => requireToolScope({ tenantId: null, organizationId: scope.organizationId })).toThrow()
    expect(() => requireToolScope({ tenantId: scope.tenantId, organizationId: '' })).toThrow()
    expect(requireToolScope(scope)).toEqual(scope)
  })
})
