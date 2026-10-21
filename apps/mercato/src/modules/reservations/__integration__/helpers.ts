import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const RESERVATIONS_API = '/api/reservations/reservations'
export const PAYMENTS_API = '/api/reservations/payments'
export const REFUNDS_API = '/api/reservations/refunds'
export const VALID_IBAN = 'DE89 3704 0044 0532 0130 00'

export type ReservationItem = {
  id: string
  bookingNumber: string
  customerPersonId: string
  customerName: string | null
  status: string
  departureDate: string | null
  totalPriceAmount: string
  currencyCode: string
  daysToDeparture: number | null
  balance?: { overpayment?: number; outstanding?: number } | null
  updatedAt: string | null
}

export type BalanceBody = {
  totalPrice: number
  paidTotal: number
  pendingPaymentsTotal: number
  refundedTotal: number
  outstanding: number
  overpayment: number
  currencyCode: string
  daysToDeparture: number | null
}

export function uniqueStamp(): string {
  return randomUUID().replaceAll('-', '').slice(0, 10).toUpperCase()
}

export function isoDateFromToday(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

export async function createPerson(request: APIRequestContext, token: string, stamp: string): Promise<{ id: string; email: string }> {
  const email = `qa.res.${stamp.toLowerCase()}@example.com`
  const id = await createPersonFixture(request, token, {
    firstName: 'QA',
    lastName: `Traveller ${stamp}`,
    displayName: `QA Traveller ${stamp}`,
    primaryEmail: email,
  })
  return { id, email }
}

export async function createReservation(
  request: APIRequestContext,
  token: string,
  input: { personId: string; email: string; bookingNumber: string; totalPrice?: number; departureInDays?: number },
): Promise<string> {
  const response = await apiRequest(request, 'POST', RESERVATIONS_API, {
    token,
    data: {
      bookingNumber: input.bookingNumber,
      customerPersonId: input.personId,
      customerEmail: input.email,
      customerName: 'QA Traveller',
      status: 'confirmed',
      destination: 'Crete, Greece',
      hotelName: 'QA Hotel',
      departureDate: isoDateFromToday(input.departureInDays ?? 3),
      returnDate: isoDateFromToday((input.departureInDays ?? 3) + 7),
      travelersCount: 2,
      totalPriceAmount: input.totalPrice ?? 2400,
      currencyCode: 'EUR',
    },
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), `create reservation failed: ${JSON.stringify(body)}`).toBe(201)
  expect(typeof body?.id).toBe('string')
  return body!.id as string
}

export async function recordPayment(
  request: APIRequestContext,
  token: string,
  reservationId: string,
  amount: number,
  status: 'booked' | 'pending' = 'booked',
): Promise<string> {
  const response = await apiRequest(request, 'POST', PAYMENTS_API, {
    token,
    data: { reservationId, amount, status, method: 'transfer', externalReference: 'QA transfer' },
  })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), `record payment failed: ${JSON.stringify(body)}`).toBe(201)
  return body!.id as string
}

export async function readReservation(request: APIRequestContext, token: string, id: string): Promise<ReservationItem | null> {
  const response = await apiRequest(request, 'GET', `${RESERVATIONS_API}?ids=${encodeURIComponent(id)}&pageSize=1`, { token })
  expect(response.ok()).toBeTruthy()
  const body = await readJsonSafe<{ items?: ReservationItem[] }>(response)
  return body?.items?.[0] ?? null
}

export async function readBalance(request: APIRequestContext, token: string, id: string): Promise<BalanceBody> {
  const response = await apiRequest(request, 'GET', `${RESERVATIONS_API}/${encodeURIComponent(id)}/balance`, { token })
  const body = await readJsonSafe<BalanceBody>(response)
  expect(response.status(), `balance failed: ${JSON.stringify(body)}`).toBe(200)
  return body as BalanceBody
}

export async function cleanupReservation(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  await deleteEntityIfExists(request, token, RESERVATIONS_API, id)
}

export async function cleanupPerson(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  await deleteEntityIfExists(request, token, '/api/customers/people', id)
}
