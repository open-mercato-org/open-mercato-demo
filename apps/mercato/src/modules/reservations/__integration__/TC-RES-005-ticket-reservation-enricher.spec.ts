import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { cleanupPerson, cleanupReservation, createPerson, createReservation, uniqueStamp } from './helpers'

export const integrationMeta = {
  dependsOnModules: ['reservations', 'customers', 'tickets'],
}

type EnrichedTicket = {
  id: string
  reservationId: string | null
  _reservations?: {
    reservation: {
      id: string
      bookingNumber: string
      destination: string
      customerPersonId: string
      customerName: string | null
    } | null
  }
}

async function simulateTicket(request: APIRequestContext, token: string, stamp: string): Promise<string> {
  const response = await apiRequest(request, 'POST', '/api/tickets/intake/simulate', {
    token,
    data: {
      fromEmail: `qa.res.ticket.${stamp.toLowerCase()}@example.com`,
      subject: `Refund question ${stamp}`,
      body: 'I paid too much for my booking.',
    },
  })
  const body = await readJsonSafe<{ ticketId?: string }>(response)
  expect([200, 201], `simulate failed: ${JSON.stringify(body)}`).toContain(response.status())
  return body?.ticketId as string
}

async function readTicket(request: APIRequestContext, token: string, id: string): Promise<EnrichedTicket> {
  const response = await apiRequest(request, 'GET', `/api/tickets/tickets?id=${encodeURIComponent(id)}&pageSize=1`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: EnrichedTicket[] }>(response)
  expect(body?.items?.length).toBe(1)
  return body!.items![0]
}

test.describe('TC-RES-005: reservations enrich tickets responses', () => {
  test('adds booking number, destination and customer name to a ticket linked to a reservation', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueStamp()
    const bookingNumber = `TK${stamp.slice(0, 7)}`
    let personId: string | null = null
    let reservationId: string | null = null
    let linkedTicketId: string | null = null
    let unlinkedTicketId: string | null = null
    try {
      const person = await createPerson(request, token, stamp)
      personId = person.id
      reservationId = await createReservation(request, token, { personId: person.id, email: person.email, bookingNumber })
      linkedTicketId = await simulateTicket(request, token, `${stamp}A`)
      unlinkedTicketId = await simulateTicket(request, token, `${stamp}B`)

      const classify = await apiRequest(request, 'POST', `/api/tickets/tickets/${linkedTicketId}/classify`, {
        token,
        data: { reservationId, customerPersonId: person.id, source: 'manual' },
      })
      expect(classify.status(), await classify.text()).toBe(200)

      const linked = await readTicket(request, token, linkedTicketId)
      expect(linked.reservationId).toBe(reservationId)
      expect(linked._reservations?.reservation).toMatchObject({
        id: reservationId,
        bookingNumber,
        destination: 'Crete, Greece',
        customerPersonId: person.id,
        customerName: 'QA Traveller',
      })

      const unlinked = await readTicket(request, token, unlinkedTicketId)
      expect(unlinked._reservations?.reservation ?? null).toBeNull()

      const filtered = await apiRequest(request, 'GET', `/api/tickets/tickets?reservationId=${reservationId}&pageSize=10`, { token })
      const filteredBody = await readJsonSafe<{ items?: EnrichedTicket[] }>(filtered)
      expect(filteredBody?.items?.map((item) => item.id)).toEqual([linkedTicketId])
    } finally {
      for (const ticketId of [linkedTicketId, unlinkedTicketId]) {
        if (ticketId) await apiRequest(request, 'DELETE', `/api/tickets/tickets?id=${ticketId}`, { token }).catch(() => undefined)
      }
      await cleanupReservation(request, token, reservationId)
      await cleanupPerson(request, token, personId)
    }
  })
})
