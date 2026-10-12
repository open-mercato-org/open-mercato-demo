/** @jest-environment node */
import { resolvePersonId, resolveReservationId } from '../lib/injectionContext'

const ID = '22222222-2222-4222-8222-222222222222'

describe('injection context resolvers', () => {
  it('resolves the reservation id from the reservation detail context', () => {
    expect(resolveReservationId({ resourceKind: 'reservations.reservation', resourceId: ID })).toBe(ID)
    expect(resolveReservationId({ resourceKind: 'reservations.reservation', resourceId: 'x', reservationId: ` ${ID} ` })).toBe(ID)
  })

  it('ignores contexts of other hosts or without an id', () => {
    expect(resolveReservationId({ resourceKind: 'customers.person', resourceId: ID })).toBeNull()
    expect(resolveReservationId({ resourceKind: 'reservations.reservation', resourceId: '  ' })).toBeNull()
    expect(resolveReservationId(null)).toBeNull()
    expect(resolveReservationId('reservations.reservation')).toBeNull()
  })

  it('resolves the person id from the person detail context', () => {
    expect(resolvePersonId({ resourceKind: 'customers.person', resourceId: ID })).toBe(ID)
    expect(resolvePersonId({ resourceKind: 'customers.person', personId: ID, resourceId: 'other' })).toBe(ID)
    expect(resolvePersonId({ resourceKind: 'reservations.reservation', resourceId: ID })).toBeNull()
  })
})
