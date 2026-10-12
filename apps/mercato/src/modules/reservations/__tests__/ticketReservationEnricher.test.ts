/** @jest-environment node */
const findWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

import type { EnricherContext } from '@open-mercato/shared/lib/crud/response-enricher'
import type { Reservation } from '../data/entities'
import {
  enrichTicketsWithReservations,
  loadReservationsForEnricher,
  readTicketReservationId,
  ticketReservationEnricher,
} from '../lib/ticketReservationEnricher'

const RES_A = '11111111-1111-4111-8111-111111111111'
const RES_B = '22222222-2222-4222-8222-222222222222'
const TENANT = '33333333-3333-4333-8333-333333333333'
const ORG = '44444444-4444-4444-8444-444444444444'

function reservation(id: string, bookingNumber: string): Reservation {
  return {
    id,
    bookingNumber,
    destination: 'Crete, Greece',
    hotelName: 'QA Hotel',
    status: 'confirmed',
    departureDate: '2026-11-01',
    customerPersonId: '55555555-5555-4555-8555-555555555555',
    customerNameSnapshot: 'Anna Nowak',
  } as unknown as Reservation
}

function context(overrides: Partial<EnricherContext> = {}): EnricherContext {
  const fork = jest.fn(() => ({ forked: true }))
  return {
    organizationId: ORG,
    tenantId: TENANT,
    userId: 'user-1',
    em: { fork },
    container: {},
    ...overrides,
  }
}

describe('ticket reservation enricher', () => {
  beforeEach(() => {
    findWithDecryption.mockReset()
  })

  it('declares a namespaced, ACL-gated, non-cacheable enricher for tickets', () => {
    expect(ticketReservationEnricher.targetEntity).toBe('tickets.ticket')
    expect(ticketReservationEnricher.features).toEqual(['reservations.view'])
    expect(ticketReservationEnricher.cacheableOnListHit).toBeFalsy()
    expect(ticketReservationEnricher.fallback).toEqual({ _reservations: { reservation: null } })
  })

  it('reads the reservation id from camelCase or snake_case records', () => {
    expect(readTicketReservationId({ reservationId: RES_A })).toBe(RES_A)
    expect(readTicketReservationId({ reservation_id: RES_B })).toBe(RES_B)
    expect(readTicketReservationId({ reservationId: 'not-a-uuid' })).toBeNull()
    expect(readTicketReservationId({})).toBeNull()
  })

  it('batch-loads distinct reservations once and attaches labels', async () => {
    const loader = jest.fn(async () => [reservation(RES_A, 'BK-1')])
    const records = [
      { id: 't1', reservationId: RES_A },
      { id: 't2', reservationId: RES_A },
      { id: 't3', reservationId: RES_B },
      { id: 't4', reservationId: null },
    ]
    const enriched = await enrichTicketsWithReservations(records, context(), loader)
    expect(loader).toHaveBeenCalledTimes(1)
    expect(loader.mock.calls[0][0]).toEqual([RES_A, RES_B])
    expect(enriched[0]._reservations.reservation).toEqual({
      id: RES_A,
      bookingNumber: 'BK-1',
      destination: 'Crete, Greece',
      hotelName: 'QA Hotel',
      status: 'confirmed',
      departureDate: '2026-11-01',
      customerPersonId: '55555555-5555-4555-8555-555555555555',
      customerName: 'Anna Nowak',
    })
    expect(enriched[1]._reservations.reservation?.bookingNumber).toBe('BK-1')
    expect(enriched[2]._reservations.reservation).toBeNull()
    expect(enriched[3]._reservations.reservation).toBeNull()
    expect(enriched[0].id).toBe('t1')
  })

  it('skips the lookup when no ticket references a reservation', async () => {
    const loader = jest.fn(async () => [])
    const enriched = await enrichTicketsWithReservations([{ id: 't1' }], context(), loader)
    expect(loader).not.toHaveBeenCalled()
    expect(enriched[0]._reservations.reservation).toBeNull()
  })

  it('scopes the default loader by tenant and organization', async () => {
    findWithDecryption.mockResolvedValue([])
    await loadReservationsForEnricher([RES_A], context())
    const [, , where, , scope] = findWithDecryption.mock.calls[0]
    expect(where).toEqual({ id: { $in: [RES_A] }, tenantId: TENANT, organizationId: ORG, deletedAt: null })
    expect(scope).toEqual({ tenantId: TENANT, organizationId: ORG })
  })

  it('returns nothing without a tenant', async () => {
    expect(await loadReservationsForEnricher([RES_A], context({ tenantId: '' }))).toEqual([])
    expect(findWithDecryption).not.toHaveBeenCalled()
  })
})
