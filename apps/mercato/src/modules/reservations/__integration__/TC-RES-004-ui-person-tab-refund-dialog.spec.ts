import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import {
  VALID_IBAN,
  cleanupPerson,
  cleanupReservation,
  createPerson,
  createReservation,
  readBalance,
  recordPayment,
  uniqueStamp,
} from './helpers'

test.describe('TC-RES-004: reservations UI', () => {
  test('shows the reservation on the person tab and requests a refund from the detail page', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueStamp()
    const bookingNumber = `UI${stamp.slice(0, 7)}`
    let personId: string | null = null
    let reservationId: string | null = null
    try {
      const person = await createPerson(request, token, stamp)
      personId = person.id
      reservationId = await createReservation(request, token, { personId: person.id, email: person.email, bookingNumber })
      await recordPayment(request, token, reservationId, 2750)

      await login(page, 'admin')
      await page.goto(`/backend/customers/people-v2/${person.id}?tab=reservations.injection.person-reservations-tab`, { waitUntil: 'commit' })
      const tab = page.getByTestId('person-reservations-tab')
      await expect(tab).toBeVisible({ timeout: 20_000 })
      await expect(tab.getByRole('link', { name: bookingNumber })).toBeVisible()

      await page.goto(`/backend/reservations/${reservationId}`, { waitUntil: 'commit' })
      await expect(page.getByTestId('reservation-overpayment')).toContainText('350')
      await page.getByRole('button', { name: 'Request refund' }).first().click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      const ibanInput = dialog.locator('[data-crud-field-id="bankAccountNumber"] input')
      await ibanInput.fill(VALID_IBAN)
      await expect(ibanInput).toHaveValue(VALID_IBAN)
      await dialog.locator('[data-crud-field-id="reason"] textarea').fill('QA overpayment refund')
      await expect(ibanInput).toHaveValue(VALID_IBAN)
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
      await expect(dialog).toBeHidden({ timeout: 15_000 })
      await expect(page.getByText('Requested', { exact: true }).first()).toBeVisible()

      const balance = await readBalance(request, token, reservationId)
      expect(balance.refundedTotal).toBe(350)
      expect(balance.overpayment).toBe(0)
    } finally {
      await cleanupReservation(request, token, reservationId)
      await cleanupPerson(request, token, personId)
    }
  })

  test('closes the refund dialog with Escape without creating a refund', async ({ page, request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueStamp()
    let personId: string | null = null
    let reservationId: string | null = null
    try {
      const person = await createPerson(request, token, stamp)
      personId = person.id
      reservationId = await createReservation(request, token, { personId: person.id, email: person.email, bookingNumber: `ESC${stamp.slice(0, 6)}` })
      await recordPayment(request, token, reservationId, 2500)

      await login(page, 'admin')
      await page.goto(`/backend/reservations/${reservationId}`, { waitUntil: 'commit' })
      await page.getByRole('button', { name: 'Request refund' }).first().click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await page.keyboard.press('Escape')
      await expect(dialog).toBeHidden()
      expect((await readBalance(request, token, reservationId)).refundedTotal).toBe(0)
    } finally {
      await cleanupReservation(request, token, reservationId)
      await cleanupPerson(request, token, personId)
    }
  })
})
