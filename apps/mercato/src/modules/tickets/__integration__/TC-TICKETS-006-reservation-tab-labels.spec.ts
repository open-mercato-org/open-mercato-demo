import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { createPersonFixture, deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteTicketIfExists, simulateEmail, uniqueStamp } from './helpers'

export const integrationMeta = {
  dependsOnModules: ['tickets', 'reservations', 'customers'],
}

function isoDateFromToday(days: number): string {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

test.describe('TC-TICKETS-006: reservation tickets tab and linked labels', () => {
  test('lists the ticket on the reservation tab and shows reservation and customer labels on the ticket', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueStamp('tc-tickets-006')
    const shortStamp = stamp.slice(-8).toUpperCase()
    const bookingNumber = `TT${shortStamp}`
    const displayName = `QA Ticket Traveller ${shortStamp}`
    let personId: string | null = null
    let reservationId: string | null = null
    let ticketId: string | null = null

    try {
      personId = await createPersonFixture(request, token, {
        firstName: 'QA',
        lastName: `Ticket Traveller ${shortStamp}`,
        displayName,
        primaryEmail: `${stamp}@example.com`,
      })
      const reservationResponse = await apiRequest(request, 'POST', '/api/reservations/reservations', {
        token,
        data: {
          bookingNumber,
          customerPersonId: personId,
          customerEmail: `${stamp}@example.com`,
          customerName: displayName,
          status: 'confirmed',
          destination: 'Madeira, Portugal',
          hotelName: 'QA Ocean Hotel',
          departureDate: isoDateFromToday(5),
          returnDate: isoDateFromToday(12),
          travelersCount: 2,
          totalPriceAmount: 1800,
          currencyCode: 'EUR',
        },
      })
      const reservationBody = await readJsonSafe<{ id?: string }>(reservationResponse)
      expect(reservationResponse.status(), JSON.stringify(reservationBody)).toBe(201)
      reservationId = reservationBody?.id as string

      const intake = await simulateEmail(request, token, {
        fromEmail: `${stamp}@example.com`,
        subject: `Transfer question ${stamp}`,
        body: 'Is the airport transfer included?',
      })
      ticketId = intake.ticketId
      const classify = await apiRequest(request, 'POST', `/api/tickets/tickets/${ticketId}/classify`, {
        token,
        data: { reservationId, customerPersonId: personId, reservationNumberSnapshot: bookingNumber, source: 'manual' },
      })
      expect(classify.status(), await classify.text()).toBe(200)

      await login(page, 'admin')
      await page.goto(`/backend/reservations/${reservationId}`, { waitUntil: 'commit' })
      const tabs = page.getByTestId('reservation-injected-tabs')
      await expect(tabs).toBeVisible({ timeout: 30_000 })
      await tabs.getByRole('tab', { name: 'Tickets' }).click()
      const ticketsTab = page.getByTestId('reservation-tickets-tab')
      await expect(ticketsTab.getByRole('link', { name: intake.number })).toBeVisible({ timeout: 20_000 })

      await page.goto(`/backend/tickets/${ticketId}`, { waitUntil: 'commit' })
      const reservationLabel = page.getByTestId('ticket-reservation-label')
      await expect(reservationLabel).toBeVisible({ timeout: 30_000 })
      const reservationLink = reservationLabel.getByRole('link', { name: bookingNumber })
      await expect(reservationLink).toHaveAttribute('href', `/backend/reservations/${reservationId}`)
      await expect(reservationLabel).toContainText('Madeira, Portugal')
      const customerLink = page.getByTestId('ticket-customer-link')
      await expect(customerLink).toHaveText(displayName, { timeout: 20_000 })
      await expect(customerLink).toHaveAttribute('href', `/backend/customers/people-v2/${personId}`)
    } finally {
      await deleteTicketIfExists(request, token, ticketId)
      await deleteEntityIfExists(request, token, '/api/reservations/reservations', reservationId)
      await deleteEntityIfExists(request, token, '/api/customers/people', personId)
    }
  })
})
