import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteTicketIfExists, getTicket, simulateEmail, uniqueStamp } from './helpers'

export const integrationMeta = {
  dependsOnModules: ['tickets'],
}

test.describe('TC-TICKETS-008: delete tickets from the UI', () => {
  test('deletes a ticket from the detail page actions menu', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueStamp('tc-tickets-008-detail')
    let ticketId: string | null = null
    try {
      const intake = await simulateEmail(request, token, {
        fromEmail: `${stamp}@example.com`,
        subject: `Delete me from detail ${stamp}`,
        body: 'Hello,\n\nPlease ignore this message.',
      })
      ticketId = intake.ticketId

      await login(page, 'admin')
      await page.goto(`/backend/tickets/${ticketId}`, { waitUntil: 'commit' })
      await page.getByRole('button', { name: 'Actions', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Delete ticket' }).click()
      const dialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
      await expect(dialog).toBeVisible()
      await dialog.getByRole('button', { name: 'Delete ticket' }).click()

      await expect(page).toHaveURL(/\/backend\/tickets$/, { timeout: 20_000 })
      await expect.poll(() => getTicket(request, token, ticketId as string)).toBeNull()
      ticketId = null
    } finally {
      await deleteTicketIfExists(request, token, ticketId)
    }
  })

  test('deletes a ticket from the queue row actions and keeps it on cancel', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueStamp('tc-tickets-008-queue')
    const subject = `Delete me from queue ${stamp}`
    let ticketId: string | null = null
    try {
      const intake = await simulateEmail(request, token, {
        fromEmail: `${stamp}@example.com`,
        subject,
        body: 'Hello,\n\nPlease ignore this message.',
      })
      ticketId = intake.ticketId

      await login(page, 'admin')
      await page.goto('/backend/tickets', { waitUntil: 'commit' })
      const row = page.getByRole('row').filter({ hasText: intake.number })
      await expect(row).toBeVisible({ timeout: 20_000 })

      await row.getByRole('button', { name: 'Open actions' }).click()
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).or(page.getByRole('button', { name: 'Delete', exact: true })).first().click()
      const cancelDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
      await cancelDialog.getByRole('button', { name: 'Cancel' }).click()
      expect(await getTicket(request, token, ticketId)).not.toBeNull()

      await row.getByRole('button', { name: 'Open actions' }).click()
      await page.getByRole('menuitem', { name: 'Delete', exact: true }).or(page.getByRole('button', { name: 'Delete', exact: true })).first().click()
      const confirmDialog = page.getByRole('alertdialog').or(page.getByRole('dialog'))
      await confirmDialog.getByRole('button', { name: 'Delete ticket' }).click()

      await expect(page.getByRole('row').filter({ hasText: intake.number })).toHaveCount(0, { timeout: 20_000 })
      await expect.poll(() => getTicket(request, token, ticketId as string)).toBeNull()
      ticketId = null
    } finally {
      await deleteTicketIfExists(request, token, ticketId)
    }
  })
})
