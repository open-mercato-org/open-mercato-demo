import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { expectOperation, skipIfUndoTestsDisabled, undoOk } from '@open-mercato/core/helpers/integration/undoHarness'
import { OPTIMISTIC_LOCK_HEADER, deleteTicketIfExists, getTicket, simulateEmail, uniqueStamp } from './helpers'

test.describe('TC-TICKETS-002: classification, manual-review flag, undo and optimistic locking', () => {
  test('classifies a ticket, undoes it, enforces the manual-vs-workflow rule and rejects stale versions', async ({ request }) => {
    skipIfUndoTestsDisabled()
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueStamp('tc-tickets-002')
    let ticketId: string | null = null

    try {
      const intake = await simulateEmail(request, token, {
        fromEmail: `${stamp}@example.com`,
        subject: `Quiet room please ${stamp}`,
        body: 'Could we get a quiet room?',
      })
      ticketId = intake.ticketId
      const initial = await getTicket(request, token, ticketId)
      expect(initial?.classificationSource).toBeNull()

      const classify = await apiRequest(request, 'POST', `/api/tickets/tickets/${ticketId}/classify`, {
        token,
        data: {
          categoryKey: 'booking',
          subcategoryKey: 'booking.special_requests',
          topicKey: 'booking.special_requests.room_preference',
          categoryPathSnapshot: 'Booking / Special requests / Room preference',
          priority: 'high',
          priorityReason: 'departure in 3 days',
          summary: 'Customer asks for a quiet room.',
          source: 'manual',
        },
        headers: { [OPTIMISTIC_LOCK_HEADER]: initial?.updatedAt ?? '' },
      })
      expect(classify.status()).toBe(200)
      const operation = expectOperation(classify, 'classify')

      const classified = await getTicket(request, token, ticketId)
      expect(classified?.topicKey).toBe('booking.special_requests.room_preference')
      expect(classified?.priority).toBe('high')
      expect(classified?.classificationSource).toBe('manual')

      const workflowOverwrite = await apiRequest(request, 'POST', `/api/tickets/tickets/${ticketId}/classify`, {
        token,
        data: { topicKey: 'other.topic', source: 'workflow' },
      })
      expect(workflowOverwrite.status()).toBe(409)

      const stale = await apiRequest(request, 'POST', `/api/tickets/tickets/${ticketId}/classify`, {
        token,
        data: { priority: 'low', source: 'manual' },
        headers: { [OPTIMISTIC_LOCK_HEADER]: initial?.updatedAt ?? '' },
      })
      expect(stale.status()).toBe(409)
      const staleBody = await readJsonSafe<{ code?: string }>(stale)
      expect(staleBody?.code).toBe('optimistic_lock_conflict')

      await undoOk(request, token, operation.undoToken, 'undo classify')
      const restored = await getTicket(request, token, ticketId)
      expect(restored?.topicKey).toBeNull()
      expect(restored?.priority).toBe('normal')
      expect(restored?.classificationSource).toBeNull()

      const flag = await apiRequest(request, 'POST', `/api/tickets/tickets/${ticketId}/flag-manual-review`, {
        token,
        data: { reasonCode: 'manual_only_topic', reason: 'Room preferences need a consultant.', targetQueueKey: 'bookings' },
      })
      expect(flag.status()).toBe(200)
      const flagged = await getTicket(request, token, ticketId)
      expect(flagged?.needsManualReview).toBe(true)
      expect(flagged?.manualReviewReasonCode).toBe('manual_only_topic')
      expect(flagged?.queueKey).toBe('bookings')

      const statusViaCrud = await apiRequest(request, 'PUT', '/api/tickets/tickets', {
        token,
        data: { id: ticketId, status: 'closed' },
      })
      expect(statusViaCrud.status()).toBe(400)

      const invalidTransition = await apiRequest(request, 'POST', `/api/tickets/tickets/${ticketId}/transition`, {
        token,
        data: { to: 'closed' },
      })
      expect(invalidTransition.status()).toBe(400)

      const transition = await apiRequest(request, 'POST', `/api/tickets/tickets/${ticketId}/transition`, {
        token,
        data: { to: 'open' },
      })
      expect(transition.status()).toBe(200)
      expect((await getTicket(request, token, ticketId))?.status).toBe('open')
    } finally {
      await deleteTicketIfExists(request, token, ticketId)
    }
  })
})
