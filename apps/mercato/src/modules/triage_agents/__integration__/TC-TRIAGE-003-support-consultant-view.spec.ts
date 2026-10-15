import { expect, test, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createRoleFixture,
  createUserFixture,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
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

const ROLE = 'support_consultant'
const PASSWORD = 'Consultant-Passw0rd!'
const CONSULTANT_FEATURES = [
  'tickets.view',
  'tickets.manage',
  'tickets.classify',
  'tickets.reply',
  'reservations.view',
  'knowledge_articles.view',
  'triage_agents.view',
  'agent_orchestrator.proposals.view',
  'agent_orchestrator.proposals.dispose',
  'customers.people.view',
  'customers.companies.view',
]
const OPERATOR_ONLY_FEATURES = [
  'agent_orchestrator.trace.view',
  'agent_orchestrator.agents.view',
  'agent_orchestrator.processes.view',
  'triage_agents.run',
  'tickets.intake.simulate',
]
const HIDDEN_AGENT_PAGES = ['/backend/caseload', '/backend/overview', '/backend/audit']
const AI_INTERNAL_PAGES = ['/backend/agents', '/backend/playground', '/backend/processes', '/backend/traces']

type RoleRow = { id: string; name: string }

function decodeOrgId(token: string): string {
  const [, payload] = token.split('.')
  const claims = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { orgId?: string }
  return String(claims.orgId)
}

async function findRole(request: APIRequestContext, token: string): Promise<RoleRow | null> {
  const response = await apiRequest(request, 'GET', `/api/auth/roles?search=${ROLE}&pageSize=50`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: RoleRow[] }>(response)
  return body?.items?.find((role) => role.name === ROLE) ?? null
}

/**
 * The role is seeded by `triage_agents` `seedDefaults` (with the ACL every module
 * declares for it and the sidebar preference); a database initialised before that
 * existed gets the same state from the test, which then removes it again.
 */
async function ensureConsultantRole(request: APIRequestContext, token: string): Promise<{ roleId: string; created: boolean }> {
  const existing = await findRole(request, token)
  if (existing) return { roleId: existing.id, created: false }
  const roleId = await createRoleFixture(request, token, { name: ROLE })
  await setRoleAclFeatures(request, token, { roleId, features: CONSULTANT_FEATURES })
  const sidebar = await apiRequest(request, 'PUT', '/api/auth/sidebar/preferences', {
    token,
    data: { hiddenItems: HIDDEN_AGENT_PAGES, scope: { type: 'role', roleId } },
  })
  expect(sidebar.status(), `role sidebar preference failed: ${await sidebar.text()}`).toBe(200)
  return { roleId, created: true }
}

async function loginAs(page: Page, email: string, password: string): Promise<string> {
  const form = new URLSearchParams({ email, password })
  const response = await page.request.post('/api/auth/login', {
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    data: form.toString(),
  })
  expect(response.status(), `consultant login failed: ${await response.text()}`).toBe(200)
  const body = (await response.json()) as { token: string }
  const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
  await page.context().addCookies([{ name: 'om_selected_org', value: decodeOrgId(body.token), url: baseUrl, sameSite: 'Lax' }])
  return body.token
}

/**
 * A helpdesk consultant (`support_consultant`) works a triaged ticket: the summary
 * card and the decision card (facts from `decision_context`, KB citations) are there
 * and approving works, while every AI-internal surface — flow tab, Caseload / Open
 * flow / Re-run links, Agents sidebar entries, run/agent/flow APIs, the AO admin
 * pages — is absent or refused. Scripted LLM provider; skips when the module or the
 * provider is off.
 */
test.describe('TC-TRIAGE-003: support consultant sees the decision, not the AI internals', () => {
  test('approves a refund proposal from the ticket page without AI-operator access', async ({ page, request }) => {
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

      const aclResponse = await apiRequest(request, 'GET', `/api/auth/roles/acl?roleId=${roleId}`, { token })
      expect(aclResponse.status()).toBe(200)
      const acl = await readJsonSafe<{ features?: string[] }>(aclResponse)
      expect(acl?.features ?? []).toEqual(expect.arrayContaining(CONSULTANT_FEATURES))
      for (const feature of OPERATOR_ONLY_FEATURES) expect(acl?.features ?? []).not.toContain(feature)

      const email = `qa.consultant.${uniqueStamp()}@example.com`
      userId = await createUserFixture(request, token, { email, password: PASSWORD, organizationId: decodeOrgId(token), roles: [ROLE] })

      await ensureKnowledgeBase(request, token, fixtures)
      const anna = await createPersona(request, token, fixtures, 'anna3', [
        { departureInDays: 3, totalPrice: 2400, payments: [{ amount: 2000, status: 'booked' }, { amount: 750, status: 'booked' }] },
      ])
      const booking = anna.reservations[0].bookingNumber
      const ticketId = await sendEmail(request, token, fixtures, anna, {
        subject: `Refund of overpayment for booking ${booking}`,
        body: `Hello,\n\nI paid the second instalment for booking ${booking} twice by mistake. Please refund the overpayment on booking ${booking} to my account ${DEMO_IBAN}.\n\nThank you`,
      })
      if (!setup?.autoStart) await startTriage(request, token, ticketId)
      const triaged = await waitForTriage(request, token, ticketId, settled)
      expect(triaged.stage, JSON.stringify(triaged)).toBe('awaiting_approval')
      const proposalId = triaged.proposalId as string

      const consultantToken = await loginAs(page, email, PASSWORD)
      for (const path of ['/api/agent_orchestrator/runs', '/api/agent_orchestrator/agents', `/api/agent_orchestrator/executions/${triaged.executionId}/flow`]) {
        const denied = await apiRequest(request, 'GET', path, { token: consultantToken })
        expect(denied.status(), `${path} must be refused`).toBe(403)
      }
      const rerun = await apiRequest(request, 'POST', `/api/triage_agents/tickets/${ticketId}/rerun`, { token: consultantToken, data: {} })
      expect(rerun.status()).toBe(403)
      const proposalResponse = await apiRequest(request, 'GET', `/api/agent_orchestrator/proposals?id=${proposalId}`, { token: consultantToken })
      expect(proposalResponse.status()).toBe(200)
      const proposalBody = await readJsonSafe<{ items?: Array<{ decision_context?: { agentLabel: string | null; facts: Array<{ label: string }> } }> }>(proposalResponse)
      const decisionContext = proposalBody?.items?.[0]?.decision_context
      expect(decisionContext?.agentLabel).toBeTruthy()
      expect(decisionContext?.facts.map((fact) => fact.label)).toEqual(expect.arrayContaining(['Booking number', 'Topic']))

      await page.goto(`/backend/tickets/${ticketId}`, { waitUntil: 'domcontentloaded' })
      const summary = page.getByTestId('triage-summary-card')
      await expect(summary).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('triage-review-proposal')).toBeVisible()
      const decision = page.getByTestId('triage-decision-card')
      const card = decision.getByTestId('ao-proposal-decision-card')
      await expect(card).toHaveAttribute('data-proposal-id', proposalId, { timeout: 30_000 })
      const facts = card.getByTestId('ao-proposal-facts')
      await expect(facts).toBeVisible()
      await expect(facts.getByText(booking, { exact: true })).toBeVisible()
      const citations = card.getByTestId('ao-decision-citations')
      await expect(citations.getByRole('link', { name: /Overpayment refund \(v\d+\)/ })).toBeVisible()
      await expect(citations.getByText(/Verify that the requester owns the booking/)).toBeVisible()
      await expect(summary.getByTestId('triage-open-caseload')).toHaveCount(0)
      await expect(summary.getByTestId('triage-open-flow')).toHaveCount(0)
      await expect(summary.getByTestId('triage-rerun')).toHaveCount(0)
      await expect(page.getByTestId('triage-flow-tab')).toHaveCount(0)

      const sidebarLinks = page.locator('aside a[href^="/backend/"]')
      await expect(sidebarLinks.first()).toBeVisible({ timeout: 20_000 })
      for (const href of [...HIDDEN_AGENT_PAGES, ...AI_INTERNAL_PAGES]) {
        await expect(page.locator(`aside a[href="${href}"]`)).toHaveCount(0)
      }

      await card.getByRole('button', { name: 'Approve & send' }).click()
      const done = await waitForTriage(request, token, ticketId, (entry) => entry.stage === 'done' || entry.stage === 'failed')
      expect(done, JSON.stringify(done)).toMatchObject({ stage: 'done', disposition: 'approved', draftState: 'sent' })
      await expect(page.getByTestId('triage-decision-card')).toHaveCount(0, { timeout: 20_000 })

      await page.goto('/backend/tickets', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('link', { name: anna.name }).or(page.getByText(`Refund of overpayment for booking ${booking}`)).first()).toBeVisible({ timeout: 30_000 })
      await expect(page.getByTestId('tickets-simulate-email')).toHaveCount(0)
      await expect(page.getByTestId('triage-send-scenario')).toHaveCount(0)

      for (const path of AI_INTERNAL_PAGES) {
        await page.goto(path, { waitUntil: 'domcontentloaded' })
        await expect(page.getByText('Access Denied')).toBeVisible({ timeout: 20_000 })
      }
    } finally {
      await deleteUserIfExists(request, token, userId)
      await deleteRoleIfExists(request, token, createdRoleId)
      await cleanupFixtures(request, token, fixtures)
    }
  })
})
