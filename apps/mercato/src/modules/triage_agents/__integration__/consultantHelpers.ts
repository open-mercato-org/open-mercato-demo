import { expect, type APIRequestContext, type Page } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { createRoleFixture, setRoleAclFeatures } from '@open-mercato/core/helpers/integration/authFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const CONSULTANT_ROLE = 'support_consultant'
export const CONSULTANT_PASSWORD = 'Consultant-Passw0rd!'
export const CONSULTANT_FEATURES = [
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
export const OPERATOR_ONLY_FEATURES = [
  'agent_orchestrator.trace.view',
  'agent_orchestrator.agents.view',
  'agent_orchestrator.processes.view',
  'triage_agents.run',
  'tickets.intake.simulate',
]
export const HIDDEN_AGENT_PAGES = ['/backend/caseload', '/backend/overview', '/backend/audit']

type RoleRow = { id: string; name: string }

export function decodeOrgId(token: string): string {
  const [, payload] = token.split('.')
  const claims = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { orgId?: string }
  return String(claims.orgId)
}

async function findRole(request: APIRequestContext, token: string): Promise<RoleRow | null> {
  const response = await apiRequest(request, 'GET', `/api/auth/roles?search=${CONSULTANT_ROLE}&pageSize=50`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: RoleRow[] }>(response)
  return body?.items?.find((role) => role.name === CONSULTANT_ROLE) ?? null
}

/**
 * The role is seeded by `triage_agents` `seedDefaults` (with the ACL every module
 * declares for it and the sidebar preference); a database initialised before that
 * existed gets the same state from the test, which then removes it again.
 */
export async function ensureConsultantRole(request: APIRequestContext, token: string): Promise<{ roleId: string; created: boolean }> {
  const existing = await findRole(request, token)
  if (existing) return { roleId: existing.id, created: false }
  const roleId = await createRoleFixture(request, token, { name: CONSULTANT_ROLE })
  await setRoleAclFeatures(request, token, { roleId, features: CONSULTANT_FEATURES })
  const sidebar = await apiRequest(request, 'PUT', '/api/auth/sidebar/preferences', {
    token,
    data: { hiddenItems: HIDDEN_AGENT_PAGES, scope: { type: 'role', roleId } },
  })
  expect(sidebar.status(), `role sidebar preference failed: ${await sidebar.text()}`).toBe(200)
  return { roleId, created: true }
}

export async function loginAs(page: Page, email: string, password: string): Promise<string> {
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
