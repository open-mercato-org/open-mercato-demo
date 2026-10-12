import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import {
  createOrganizationFixture,
  createRoleFixture,
  createUserFixture,
  deleteOrganizationIfExists,
  deleteRoleIfExists,
  deleteUserIfExists,
  setRoleAclFeatures,
} from '@open-mercato/core/helpers/integration/authFixtures'
import { getTokenScope, readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteTicketIfExists, simulateEmail, uniqueStamp } from './helpers'

test.describe('TC-TICKETS-004: tickets organization isolation', () => {
  test('hides tickets of organization A from a user of organization B', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenScope(adminToken)
    const stamp = uniqueStamp('tc-tickets-004')
    const orgBEmail = `${stamp}@test.invalid`
    const orgBPassword = 'Valid1!Pass'
    let ticketId: string | null = null
    let orgBId: string | null = null
    let roleId: string | null = null
    let userId: string | null = null

    try {
      const intake = await simulateEmail(request, adminToken, {
        fromEmail: `${stamp}@example.com`,
        subject: `Isolation check ${stamp}`,
        body: 'Org A only.',
      })
      ticketId = intake.ticketId

      orgBId = await createOrganizationFixture(request, superadminToken, { tenantId, name: `QA Tickets Org B ${stamp}` })
      roleId = await createRoleFixture(request, superadminToken, { tenantId, name: `QA Tickets Org B ${stamp}` })
      await setRoleAclFeatures(request, superadminToken, {
        roleId,
        features: ['tickets.view', 'tickets.manage', 'tickets.classify', 'tickets.reply'],
        organizations: [orgBId],
      })
      userId = await createUserFixture(request, superadminToken, {
        email: orgBEmail,
        password: orgBPassword,
        organizationId: orgBId,
        roles: [roleId],
        name: `QA Tickets Org B ${stamp}`,
      })
      const orgBToken = await getAuthToken(request, orgBEmail, orgBPassword)

      const list = await apiRequest(request, 'GET', `/api/tickets/tickets?ids=${encodeURIComponent(ticketId)}&pageSize=10`, { token: orgBToken })
      expect(list.status()).toBe(200)
      const listBody = await readJsonSafe<{ items?: Array<{ id: string }> }>(list)
      expect(listBody?.items ?? []).toHaveLength(0)

      const articles = await apiRequest(request, 'GET', `/api/tickets/tickets/${ticketId}/articles`, { token: orgBToken })
      expect(articles.status()).toBe(404)

      const classify = await apiRequest(request, 'POST', `/api/tickets/tickets/${ticketId}/classify`, {
        token: orgBToken,
        data: { priority: 'urgent', source: 'manual' },
      })
      expect(classify.status()).toBe(404)

      const reply = await apiRequest(request, 'POST', `/api/tickets/tickets/${ticketId}/reply`, {
        token: orgBToken,
        data: { body: 'Should never be sent' },
      })
      expect(reply.status()).toBe(404)
    } finally {
      await deleteTicketIfExists(request, adminToken, ticketId)
      await deleteUserIfExists(request, superadminToken, userId)
      await deleteRoleIfExists(request, superadminToken, roleId)
      await deleteOrganizationIfExists(request, superadminToken, orgBId)
    }
  })
})
