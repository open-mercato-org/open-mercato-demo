import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteTicketIfExists, listArticles, simulateEmail, uniqueStamp } from './helpers'

test.describe('TC-TICKETS-005: tickets queue and detail UI', () => {
  test('lists the ticket in the queue, opens the detail and sends a reply with Cmd/Ctrl+Enter', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueStamp('tc-tickets-005')
    let ticketId: string | null = null

    try {
      const intake = await simulateEmail(request, token, {
        fromEmail: `${stamp}@example.com`,
        subject: `UI check ${stamp}`,
        body: 'Hello from the UI test.',
      })
      ticketId = intake.ticketId

      await login(page, 'admin')
      await page.goto('/backend/tickets', { waitUntil: 'commit' })
      await expect(page.getByRole('link', { name: intake.number })).toBeVisible({ timeout: 30_000 })

      await page.goto(`/backend/tickets/${intake.ticketId}`, { waitUntil: 'commit' })
      await expect(page.getByText('Hello from the UI test.')).toBeVisible({ timeout: 30_000 })

      const composer = page.getByTestId('ticket-composer')
      await expect(composer).toBeVisible()
      const body = composer.locator('#ticket-composer-body')
      await body.fill('Thanks, we are on it.')
      await body.press('Escape')
      await expect(body).toHaveValue('')

      await body.fill('Thanks, we are on it.')
      await body.press('ControlOrMeta+Enter')
      await expect(page.getByTestId('ticket-article-outbound')).toBeVisible({ timeout: 30_000 })

      const articles = await listArticles(request, token, intake.ticketId)
      expect(articles.some((article) => article.direction === 'outbound' && article.bodyText === 'Thanks, we are on it.')).toBe(true)
    } finally {
      await deleteTicketIfExists(request, token, ticketId)
    }
  })
})
