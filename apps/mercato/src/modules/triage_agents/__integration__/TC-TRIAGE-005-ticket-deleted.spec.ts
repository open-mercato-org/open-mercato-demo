import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import {
  DEMO_IBAN,
  cleanupFixtures,
  createPersona,
  emptyFixtures,
  ensureKnowledgeBase,
  readTriage,
  sendEmail,
  settled,
  setupTriage,
  startTriage,
  waitForTriage,
  type Fixtures,
} from './helpers'

async function readAwaitingCount(request: APIRequestContext, token: string): Promise<number> {
  const response = await apiRequest(request, 'GET', '/api/triage_agents/awaiting-decision', { token })
  expect(response.status(), await response.text()).toBe(200)
  const body = await readJsonSafe<{ total?: number }>(response)
  return Number(body?.total ?? -1)
}

async function readProposalDisposition(request: APIRequestContext, token: string, proposalId: string): Promise<{ disposition: string | null; reason: string | null }> {
  const response = await apiRequest(request, 'GET', `/api/agent_orchestrator/proposals?id=${proposalId}`, { token })
  expect(response.status(), await response.text()).toBe(200)
  const body = await readJsonSafe<{ items?: Array<Record<string, unknown>> }>(response)
  const row = body?.items?.find((item) => item.id === proposalId)
  const disposition = row?.disposition
  const reason = row?.dispositionReason ?? row?.disposition_reason
  return { disposition: typeof disposition === 'string' ? disposition : null, reason: typeof reason === 'string' ? reason : null }
}

async function findDeleteUndoToken(request: APIRequestContext, token: string, ticketId: string): Promise<string | null> {
  const response = await apiRequest(
    request,
    'GET',
    `/api/audit_logs/audit-logs/actions?resourceKind=tickets.ticket&resourceId=${encodeURIComponent(ticketId)}`,
    { token },
  )
  if (response.status() !== 200) return null
  const body = await readJsonSafe<{ items?: Array<{ commandId?: string; undoToken?: string | null; executionState?: string }> }>(response)
  const entry = (body?.items ?? []).find((item) => item.commandId === 'tickets.ticket.delete' && item.executionState === 'done')
  return entry?.undoToken ?? null
}

/**
 * Deleting a ticket whose AI proposal awaits a decision cancels its triage: the
 * ticket-deleted subscriber rejects the pending AO proposal (`ticket_deleted`), the
 * projection ends in `cancelled`, and the awaiting-decision count no longer includes it.
 * Undoing the delete restores the ticket with the cancelled projection, from which a
 * re-run triages it again. Scripted LLM provider; skips when the module or the provider is off.
 */
test.describe('TC-TRIAGE-005: deleting a ticket cancels its triage', () => {
  test('pending proposal is rejected, count drops, undo allows a re-run', async ({ request }) => {
    test.setTimeout(300_000)
    const token = await getAuthToken(request, 'admin')
    const setup = await setupTriage(request, token)
    test.skip(!setup, 'triage_agents is disabled (needs OM_ENABLE_ENTERPRISE_MODULES and OM_ENABLE_ENTERPRISE_MODULES_AGENTS)')
    test.skip(!setup?.scriptedProviderActive, 'the scripted LLM provider is not active (OM_AI_PROVIDER=scripted)')

    const fixtures: Fixtures = emptyFixtures()
    try {
      await ensureKnowledgeBase(request, token, fixtures)
      const anna = await createPersona(request, token, fixtures, 'anna5', [
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
      const pendingBefore = await readAwaitingCount(request, token)
      expect(pendingBefore).toBeGreaterThanOrEqual(1)

      const deleted = await apiRequest(request, 'DELETE', `/api/tickets/tickets?id=${encodeURIComponent(ticketId)}`, { token })
      expect(deleted.status(), await deleted.text()).toBe(200)

      const cancelled = await waitForTriage(request, token, ticketId, (entry) => entry.stage === 'cancelled')
      expect(cancelled, JSON.stringify(cancelled)).toMatchObject({ stage: 'cancelled', reasonCode: 'ticket_deleted', proposalId: null })
      await expect.poll(() => readAwaitingCount(request, token), { timeout: 30_000 }).toBeLessThan(pendingBefore)
      await expect.poll(async () => (await readProposalDisposition(request, token, proposalId)).disposition, { timeout: 30_000 }).toBe('rejected')
      expect((await readProposalDisposition(request, token, proposalId)).reason).toBe('ticket_deleted')

      const undoToken = await findDeleteUndoToken(request, token, ticketId)
      test.skip(!undoToken, 'the delete action log carries no undo token')
      const undone = await apiRequest(request, 'POST', '/api/audit_logs/audit-logs/actions/undo', { token, data: { undoToken } })
      expect(undone.status(), await undone.text()).toBe(200)
      if (!setup?.autoStart) {
        expect((await readTriage(request, token, ticketId))?.stage).toBe('cancelled')
        await startTriage(request, token, ticketId)
      }
      const retriaged = await waitForTriage(request, token, ticketId, (entry) => entry.stage !== 'cancelled' && settled(entry))
      expect(retriaged.stage, JSON.stringify(retriaged)).toBe('awaiting_approval')
      expect(retriaged.proposalId).not.toBe(proposalId)
    } finally {
      await cleanupFixtures(request, token, fixtures)
    }
  })
})
