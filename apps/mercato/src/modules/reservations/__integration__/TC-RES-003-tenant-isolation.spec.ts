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
import {
  REFUNDS_API,
  RESERVATIONS_API,
  VALID_IBAN,
  cleanupPerson,
  cleanupReservation,
  createPerson,
  createReservation,
  recordPayment,
  uniqueStamp,
} from './helpers'

test.describe('TC-RES-003: reservations organization isolation', () => {
  test('a user of another organization cannot resolve, read or refund the reservation', async ({ request }) => {
    const adminToken = await getAuthToken(request, 'admin')
    const superadminToken = await getAuthToken(request, 'superadmin')
    const { tenantId } = getTokenScope(adminToken)
    const stamp = uniqueStamp()
    const bookingNumber = `ISO${stamp.slice(0, 7)}`
    const orgBEmail = `qa.res.iso.${stamp.toLowerCase()}@test.invalid`
    const orgBPassword = 'Valid1!Pass'
    let personId: string | null = null
    let reservationId: string | null = null
    let orgBId: string | null = null
    let orgBRoleId: string | null = null
    let orgBUserId: string | null = null
    try {
      const person = await createPerson(request, adminToken, stamp)
      personId = person.id
      reservationId = await createReservation(request, adminToken, { personId: person.id, email: person.email, bookingNumber })
      await recordPayment(request, adminToken, reservationId, 2750)

      orgBId = await createOrganizationFixture(request, superadminToken, { tenantId, name: `QA RES Org B ${stamp}` })
      orgBRoleId = await createRoleFixture(request, superadminToken, { tenantId, name: `QA RES Org B ${stamp}` })
      await setRoleAclFeatures(request, superadminToken, {
        roleId: orgBRoleId,
        features: ['reservations.*'],
        organizations: [orgBId],
      })
      orgBUserId = await createUserFixture(request, superadminToken, {
        email: orgBEmail,
        password: orgBPassword,
        organizationId: orgBId,
        roles: [orgBRoleId],
        name: `QA RES Org B ${stamp}`,
      })
      const orgBToken = await getAuthToken(request, orgBEmail, orgBPassword)

      const byBooking = await apiRequest(request, 'GET', `${RESERVATIONS_API}?bookingNumber=${bookingNumber}`, { token: orgBToken })
      expect(byBooking.ok()).toBeTruthy()
      expect((await readJsonSafe<{ items?: unknown[] }>(byBooking))?.items ?? []).toHaveLength(0)

      const byIds = await apiRequest(request, 'GET', `${RESERVATIONS_API}?ids=${reservationId}`, { token: orgBToken })
      expect((await readJsonSafe<{ items?: unknown[] }>(byIds))?.items ?? []).toHaveLength(0)

      const balance = await apiRequest(request, 'GET', `${RESERVATIONS_API}/${reservationId}/balance`, { token: orgBToken })
      expect(balance.status()).toBe(404)

      const refund = await apiRequest(request, 'POST', REFUNDS_API, {
        token: orgBToken,
        data: { reservationId, amount: 10, bankAccountNumber: VALID_IBAN },
      })
      expect(refund.status()).toBe(404)

      const update = await apiRequest(request, 'PUT', RESERVATIONS_API, {
        token: orgBToken,
        data: { id: reservationId, hotelName: 'Hijacked' },
      })
      expect([403, 404]).toContain(update.status())
    } finally {
      await deleteUserIfExists(request, superadminToken, orgBUserId)
      await deleteRoleIfExists(request, superadminToken, orgBRoleId)
      await deleteOrganizationIfExists(request, superadminToken, orgBId)
      await cleanupReservation(request, adminToken, reservationId)
      await cleanupPerson(request, adminToken, personId)
    }
  })
})
