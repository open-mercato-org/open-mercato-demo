/** @jest-environment node */
import { resolveCustomerLabel, resolveReservationLabel } from '../lib/linkedLabels'

const RES = '11111111-1111-4111-8111-111111111111'
const PERSON = '22222222-2222-4222-8222-222222222222'

const enriched = {
  _reservations: {
    reservation: {
      id: RES,
      bookingNumber: 'BK-2026-1',
      destination: 'Crete, Greece',
      customerPersonId: PERSON,
      customerName: 'Anna Nowak',
    },
  },
}

describe('linked labels', () => {
  it('uses the reservations enrichment for booking number, destination and link', () => {
    expect(resolveReservationLabel({ reservationId: RES, reservationNumberSnapshot: 'OLD', ...enriched })).toEqual({
      id: RES,
      bookingNumber: 'BK-2026-1',
      destination: 'Crete, Greece',
      href: `/backend/reservations/${RES}`,
    })
  })

  it('falls back to the snapshot, then the id, without a link when the enrichment is absent', () => {
    expect(resolveReservationLabel({ reservationId: RES, reservationNumberSnapshot: 'BK-SNAP' })).toEqual({
      id: RES,
      bookingNumber: 'BK-SNAP',
      destination: null,
      href: null,
    })
    expect(resolveReservationLabel({ reservationId: RES, _reservations: { reservation: null } })?.bookingNumber).toBe(RES)
    expect(resolveReservationLabel({ reservationNumberSnapshot: 'BK-ONLY' })?.bookingNumber).toBe('BK-ONLY')
    expect(resolveReservationLabel({})).toBeNull()
  })

  it('ignores an enrichment that belongs to another reservation', () => {
    const other = { _reservations: { reservation: { ...enriched._reservations.reservation, id: PERSON } } }
    expect(resolveReservationLabel({ reservationId: RES, ...other })?.href).toBeNull()
  })

  it('prefers the people label, then the reservation customer name, then the id', () => {
    expect(resolveCustomerLabel({ customerPersonId: PERSON, ...enriched }, { [PERSON]: 'Anna N.' })?.label).toBe('Anna N.')
    expect(resolveCustomerLabel({ customerPersonId: PERSON, ...enriched }, {})).toEqual({
      id: PERSON,
      label: 'Anna Nowak',
      href: `/backend/customers/people-v2/${PERSON}`,
    })
    expect(resolveCustomerLabel({ customerPersonId: PERSON }, {})?.label).toBe(PERSON)
    expect(resolveCustomerLabel({ customerPersonId: null }, {})).toBeNull()
  })
})
