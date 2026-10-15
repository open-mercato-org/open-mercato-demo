import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { createUserFixture, deleteRoleIfExists, deleteUserIfExists } from '@open-mercato/core/helpers/integration/authFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  DEMO_IBAN,
  cleanupFixtures,
  createPersona,
  emptyFixtures,
  ensureKnowledgeBase,
  sendEmail,
  settled,
  setupTriage,
  startTriage,
  uniqueStamp,
  waitForTriage,
  type Fixtures,
} from './helpers'
import { CONSULTANT_PASSWORD, CONSULTANT_ROLE, decodeOrgId, ensureConsultantRole, loginAs } from './consultantHelpers'

const MENU_ITEM_ID = 'triage_agents-awaiting-decision-open'
const FILTER_PARAM = 'filter.triageDecision=awaiting'

async function readAwaitingCount(request: APIRequestContext, token: string): Promise<number> {
  const response = await apiRequest(request, 'GET', '/api/triage_agents/awaiting-decision', { token })
  expect(response.status(), await response.text()).toBe(200)
  const body = await readJsonSafe<{ total?: number }>(response)
  return Number(body?.total ?? -1)
}

async function readAwaitingTicketIds(request: APIRequestContext, token: string): Promise<{ ids: string[]; total: number }> {
  const response = await apiRequest(request, 'GET', '/api/tickets/tickets?triageDecision=awaiting&pageSize=100', { token })
  expect(response.status(), await response.text()).toBe(200)
  const body = await readJsonSafe<{ items?: Array<{ id: string }>; total?: number }>(response)
  return { ids: (body?.items ?? []).map((item) => item.id), total: Number(body?.total ?? -1) }
}

/**
 * The consultant finds the cases waiting for their decision without the AI-operator
 * Caseload: a Helpdesk sidebar entry "Awaiting decision" with a live count opens the
 * ticket queue pre-filtered (`?filter.triageDecision=awaiting`, narrowed server-side by
 * the triage_agents interceptor), the queue preset toggles the same filter, approving
 * on the ticket page drops the count, and the Caseload proposal page shows no
 * AI-internal links. Scripted LLM provider; skips when the module or the provider is off.
 */
test.describe('TC-TRIAGE-004: consultant decision inbox', () => {
  test('sidebar entry, filtered queue and preset lead the consultant to pending decisions', async ({ page, request }) => {
    test.setTimeout(300_000)
    const token = await getAuthToken(request, 'admin')
    const setup = await setupTriage(request, token)
    test.skip(!setup, 'triage_agents is disabled (needs OM_ENABLE_ENTERPRISE_MODULES and OM_ENABLE_ENTERPRISE_MODULES_AGENTS)')
    test.skip(!setup?.scriptedProviderActive, 'the scripted LLM provider is not active (OM_AI_PROVIDER=scripted)')

    const fixtures: Fixtures = emptyFixtures()
    let userId: string | null = null
    let createdRoleId: string | null = null
    try {
      const { roleId, created } = await ensureConsultantRole(request, token)
      if (created) createdRoleId = roleId
      const email = `qa.consultant.inbox.${uniqueStamp()}@example.com`
      userId = await createUserFixture(request, token, { email, password: CONSULTANT_PASSWORD, organizationId: decodeOrgId(token), roles: [CONSULTANT_ROLE] })

      await ensureKnowledgeBase(request, token, fixtures)
      const anna = await createPersona(request, token, fixtures, 'anna4', [
        { departureInDays: 3, totalPrice: 2400, payments: [{ amount: 2000, status: 'booked' }, { amount: 750, status: 'booked' }] },
      ])
      const booking = anna.reservations[0].bookingNumber
      const subject = `Refund of overpayment for booking ${booking}`
      const ticketId = await sendEmail(request, token, fixtures, anna, {
        subject,
        body: `Hello,\n\nI paid the second instalment for booking ${booking} twice by mistake. Please refund the overpayment on booking ${booking} to my account ${DEMO_IBAN}.\n\nThank you`,
      })
      if (!setup?.autoStart) await startTriage(request, token, ticketId)
      const triaged = await waitForTriage(request, token, ticketId, settled)
      expect(triaged.stage, JSON.stringify(triaged)).toBe('awaiting_approval')
      const proposalId = triaged.proposalId as string

      const consultantToken = await loginAs(page, email, CONSULTANT_PASSWORD)
      const pendingBefore = await readAwaitingCount(request, consultantToken)
      expect(pendingBefore).toBeGreaterThanOrEqual(1)
      const filtered = await readAwaitingTicketIds(request, consultantToken)
      expect(filtered.ids).toContain(ticketId)
      expect(filtered.total).toBe(filtered.ids.length)

      await page.goto('/backend/tickets', { waitUntil: 'domcontentloaded' })
      const menuItem = page.locator(`aside a[data-menu-item-id="${MENU_ITEM_ID}"]`)
      await expect(menuItem).toBeVisible({ timeout: 30_000 })
      await expect(menuItem).toHaveAttribute('href', `/backend/tickets?${FILTER_PARAM}`)
      await expect(menuItem).toContainText(/Awaiting decision/)
      await expect(menuItem).toContainText(/\d+/, { timeout: 20_000 })

      const preset = page.getByTestId('triage-awaiting-decision-preset')
      await expect(preset).toBeVisible({ timeout: 30_000 })
      await expect(preset).toHaveAttribute('aria-pressed', 'false')
      await expect(preset.getByTestId('triage-awaiting-decision-count')).toHaveText(/\d+/, { timeout: 20_000 })

      await menuItem.click()
      await expect(page).toHaveURL(new RegExp(FILTER_PARAM.replace('.', '\\.')), { timeout: 20_000 })
      await expect(preset).toHaveAttribute('aria-pressed', 'true', { timeout: 20_000 })
      await expect(page.getByText(subject).first()).toBeVisible({ timeout: 30_000 })

      await preset.click()
      await expect(page).not.toHaveURL(/filter\.triageDecision/, { timeout: 20_000 })
      await expect(preset).toHaveAttribute('aria-pressed', 'false')
      await preset.click()
      await expect(page).toHaveURL(new RegExp(FILTER_PARAM.replace('.', '\\.')), { timeout: 20_000 })
      await expect(page.getByText(subject).first()).toBeVisible({ timeout: 30_000 })

      await page.goto(`/backend/caseload/${proposalId}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: 'Back to caseload' })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('button', { name: 'Open full trace' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Open process' })).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Inspect run' })).toHaveCount(0)

      await page.goto(`/backend/tickets/${ticketId}`, { waitUntil: 'domcontentloaded' })
      const card = page.getByTestId('triage-decision-card').getByTestId('ao-proposal-decision-card')
      await expect(card).toHaveAttribute('data-proposal-id', proposalId, { timeout: 30_000 })
      await card.getByRole('button', { name: 'Approve & send' }).click()
      const done = await waitForTriage(request, token, ticketId, (entry) => entry.stage === 'done' || entry.stage === 'failed')
      expect(done, JSON.stringify(done)).toMatchObject({ stage: 'done', disposition: 'approved' })

      await expect.poll(async () => (await readAwaitingTicketIds(request, consultantToken)).ids.includes(ticketId), { timeout: 30_000 }).toBe(false)
      await expect.poll(() => readAwaitingCount(request, consultantToken), { timeout: 30_000 }).toBeLessThan(pendingBefore)

      await page.goto(`/backend/tickets?${FILTER_PARAM}`, { waitUntil: 'domcontentloaded' })
      await expect(page.getByTestId('triage-awaiting-decision-preset')).toHaveAttribute('aria-pressed', 'true', { timeout: 30_000 })
      await expect(page.getByText(subject)).toHaveCount(0, { timeout: 30_000 })
    } finally {
      await deleteUserIfExists(request, token, userId)
      await deleteRoleIfExists(request, token, createdRoleId)
      await cleanupFixtures(request, token, fixtures)
    }
  })
})
