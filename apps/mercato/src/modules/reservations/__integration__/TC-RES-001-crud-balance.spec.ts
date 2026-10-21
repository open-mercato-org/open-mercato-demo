import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  PAYMENTS_API,
  RESERVATIONS_API,
  cleanupPerson,
  cleanupReservation,
  createPerson,
  createReservation,
  readBalance,
  readReservation,
  recordPayment,
  uniqueStamp,
} from './helpers'

test.describe('TC-RES-001: reservations CRUD, payments and balance', () => {
  test('creates a reservation with a normalized booking number, records payments and derives the overpayment', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueStamp()
    let personId: string | null = null
    let reservationId: string | null = null
    try {
      const person = await createPerson(request, token, stamp)
      personId = person.id
      reservationId = await createReservation(request, token, {
        personId: person.id,
        email: person.email,
        bookingNumber: `qa-${stamp.slice(0, 6)}`,
      })

      const created = await readReservation(request, token, reservationId)
      expect(created?.bookingNumber).toBe(`QA${stamp.slice(0, 6)}`)
      expect(created?.customerPersonId).toBe(person.id)
      expect(Math.abs((created?.daysToDeparture ?? 99) - 3)).toBeLessThanOrEqual(1)
      expect(typeof created?.updatedAt).toBe('string')

      const byBooking = await apiRequest(request, 'GET', `${RESERVATIONS_API}?bookingNumber=${encodeURIComponent(`qa ${stamp.slice(0, 6)}`)}`, { token })
      const byBookingBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(byBooking)
      expect(byBookingBody?.items?.map((item) => item.id)).toEqual([reservationId])

      const byPerson = await apiRequest(request, 'GET', `${RESERVATIONS_API}?customerPersonId=${person.id}`, { token })
      const byPersonBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(byPerson)
      expect(byPersonBody?.items?.some((item) => item.id === reservationId)).toBe(true)

      const duplicate = await apiRequest(request, 'POST', RESERVATIONS_API, {
        token,
        data: {
          bookingNumber: `QA-${stamp.slice(0, 6)}`,
          customerPersonId: person.id,
          destination: 'Rhodes',
          hotelName: 'Duplicate',
          departureDate: '2030-01-01',
          returnDate: '2030-01-08',
          totalPriceAmount: 100,
        },
      })
      expect(duplicate.status()).toBe(409)

      await recordPayment(request, token, reservationId, 2000)
      await recordPayment(request, token, reservationId, 750)
      await recordPayment(request, token, reservationId, 99, 'pending')

      const payments = await apiRequest(request, 'GET', `${PAYMENTS_API}?reservationId=${reservationId}`, { token })
      const paymentsBody = await readJsonSafe<{ items?: Array<{ amount: string; status: string }> }>(payments)
      expect(paymentsBody?.items).toHaveLength(3)

      const balance = await readBalance(request, token, reservationId)
      expect(balance).toMatchObject({
        totalPrice: 2400,
        paidTotal: 2750,
        pendingPaymentsTotal: 99,
        refundedTotal: 0,
        outstanding: 0,
        overpayment: 350,
        currencyCode: 'EUR',
      })

      const listed = await readReservation(request, token, reservationId)
      expect(listed?.balance?.overpayment).toBe(350)
    } finally {
      await cleanupReservation(request, token, reservationId)
      await cleanupPerson(request, token, personId)
    }
  })

  test('updates with the current version and refuses a stale one with 409', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueStamp()
    let personId: string | null = null
    let reservationId: string | null = null
    try {
      const person = await createPerson(request, token, stamp)
      personId = person.id
      reservationId = await createReservation(request, token, { personId: person.id, email: person.email, bookingNumber: `LCK${stamp.slice(0, 6)}` })
      const before = await readReservation(request, token, reservationId)
      const staleVersion = before?.updatedAt as string

      const fresh = await apiRequest(request, 'PUT', RESERVATIONS_API, {
        token,
        data: { id: reservationId, hotelName: 'QA Hotel Updated' },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: staleVersion },
      })
      expect(fresh.status(), `update failed: ${await fresh.text()}`).toBe(200)

      const stale = await apiRequest(request, 'PUT', RESERVATIONS_API, {
        token,
        data: { id: reservationId, hotelName: 'QA Hotel Stale' },
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: staleVersion },
      })
      expect(stale.status()).toBe(409)

      const after = await readReservation(request, token, reservationId)
      expect(after).not.toBeNull()

      const deleted = await apiRequest(request, 'DELETE', `${RESERVATIONS_API}?id=${reservationId}`, { token })
      expect(deleted.ok()).toBeTruthy()
      expect(await readReservation(request, token, reservationId)).toBeNull()
      reservationId = null
    } finally {
      await cleanupReservation(request, token, reservationId)
      await cleanupPerson(request, token, personId)
    }
  })

  test('validates the payload and 404s the balance of an unknown reservation', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const invalid = await apiRequest(request, 'POST', RESERVATIONS_API, {
      token,
      data: { bookingNumber: '---', customerPersonId: 'not-a-uuid' },
    })
    expect(invalid.status()).toBe(400)
    const missing = await apiRequest(request, 'GET', `${RESERVATIONS_API}/00000000-0000-4000-8000-000000000000/balance`, { token })
    expect(missing.status()).toBe(404)
  })
})
