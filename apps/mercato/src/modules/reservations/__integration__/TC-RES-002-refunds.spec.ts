import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import {
  REFUNDS_API,
  VALID_IBAN,
  cleanupPerson,
  cleanupReservation,
  createPerson,
  createReservation,
  readBalance,
  recordPayment,
  uniqueStamp,
} from './helpers'

type RefundItem = { id: string; status: string; amount: string; bankAccountLast4: string; updatedAt: string | null }

async function listRefunds(request: Parameters<typeof apiRequest>[0], token: string, reservationId: string): Promise<RefundItem[]> {
  const response = await apiRequest(request, 'GET', `${REFUNDS_API}?reservationId=${reservationId}`, { token })
  expect(response.ok()).toBeTruthy()
  const body = await readJsonSafe<{ items?: RefundItem[] }>(response)
  return body?.items ?? []
}

test.describe('TC-RES-002: refund requests', () => {
  test('enforces overpayment and IBAN rules, supports undo and the refund transitions', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueStamp()
    let personId: string | null = null
    let reservationId: string | null = null
    try {
      const person = await createPerson(request, token, stamp)
      personId = person.id
      reservationId = await createReservation(request, token, { personId: person.id, email: person.email, bookingNumber: `RF${stamp.slice(0, 7)}` })
      await recordPayment(request, token, reservationId, 2750)

      const tooMuch = await apiRequest(request, 'POST', REFUNDS_API, {
        token,
        data: { reservationId, amount: 350.01, bankAccountNumber: VALID_IBAN },
      })
      expect(tooMuch.status()).toBe(422)
      expect(await readJsonSafe<{ code?: string }>(tooMuch)).toMatchObject({ code: 'refund_exceeds_overpayment' })

      const badIban = await apiRequest(request, 'POST', REFUNDS_API, {
        token,
        data: { reservationId, amount: 100, bankAccountNumber: 'DE88 3704 0044 0532 0130 00' },
      })
      expect(badIban.status()).toBe(422)
      expect(await readJsonSafe<{ code?: string }>(badIban)).toMatchObject({ code: 'invalid_iban' })

      const requested = await apiRequest(request, 'POST', REFUNDS_API, {
        token,
        data: { reservationId, amount: 350, bankAccountNumber: VALID_IBAN, reason: 'Overpayment', sourceType: 'qa' },
      })
      expect(requested.status(), await requested.text()).toBe(201)
      const operation = expectOperation(requested, 'refund request')
      const requestedBody = await readJsonSafe<{ id?: string; status?: string }>(requested)
      expect(requestedBody?.status).toBe('requested')

      let refunds = await listRefunds(request, token, reservationId)
      expect(refunds).toHaveLength(1)
      expect(refunds[0]).toMatchObject({ status: 'requested', amount: '350.00', bankAccountLast4: '3000' })
      expect(JSON.stringify(refunds[0])).not.toContain('370400440532013000')
      expect((await readBalance(request, token, reservationId)).overpayment).toBe(0)

      const second = await apiRequest(request, 'POST', REFUNDS_API, {
        token,
        data: { reservationId, amount: 1, bankAccountNumber: VALID_IBAN },
      })
      expect(second.status()).toBe(422)

      await undoOk(request, token, operation.undoToken, 'refund request')
      refunds = await listRefunds(request, token, reservationId)
      expect(refunds[0]?.status).toBe('cancelled')
      expect((await readBalance(request, token, reservationId)).overpayment).toBe(350)

      const again = await apiRequest(request, 'POST', REFUNDS_API, {
        token,
        data: { reservationId, amount: 200, bankAccountNumber: VALID_IBAN },
      })
      expect(again.status()).toBe(201)
      const againId = (await readJsonSafe<{ id: string }>(again))!.id

      const invalidTransition = await apiRequest(request, 'POST', `${REFUNDS_API}/${againId}/transition`, {
        token,
        data: { to: 'executed' },
      })
      expect(invalidTransition.status()).toBe(422)

      const approved = await apiRequest(request, 'POST', `${REFUNDS_API}/${againId}/transition`, {
        token,
        data: { to: 'approved' },
      })
      expect(approved.status(), await approved.text()).toBe(200)
      const executed = await apiRequest(request, 'POST', `${REFUNDS_API}/${againId}/transition`, {
        token,
        data: { to: 'executed' },
      })
      expect(executed.status()).toBe(200)

      refunds = await listRefunds(request, token, reservationId)
      expect(refunds.find((refund) => refund.id === againId)?.status).toBe('executed')
      const balance = await readBalance(request, token, reservationId)
      expect(balance.refundedTotal).toBe(200)
      expect(balance.overpayment).toBe(150)
    } finally {
      await cleanupReservation(request, token, reservationId)
      await cleanupPerson(request, token, personId)
    }
  })
})
