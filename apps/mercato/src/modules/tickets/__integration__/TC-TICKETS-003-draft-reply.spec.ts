import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { deleteTicketIfExists, getTicket, listArticles, simulateEmail, uniqueStamp } from './helpers'

type DraftResponse = { draftId: string; created: boolean }
type ReplyResponse = { articleId: string; deliveryStatus: string; alreadySent: boolean; status: string }

test.describe('TC-TICKETS-003: reply drafts and simulated reply delivery', () => {
  test('saves and edits a draft, sends it once as a simulated outbound article and stays idempotent', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueStamp('tc-tickets-003')
    let ticketId: string | null = null

    try {
      const intake = await simulateEmail(request, token, {
        fromEmail: `${stamp}@example.com`,
        subject: `Payment confirmation ${stamp}`,
        body: 'Did you receive my payment?',
      })
      ticketId = intake.ticketId

      const createDraft = await apiRequest(request, 'POST', `/api/tickets/tickets/${ticketId}/drafts`, {
        token,
        data: { body: 'Hello, we received your payment.', sourceType: 'workflow', sourceRef: `proposal-${stamp}` },
      })
      expect(createDraft.status()).toBe(201)
      const draft = await readJsonSafe<DraftResponse>(createDraft)
      expect(draft?.created).toBe(true)

      const updateDraft = await apiRequest(request, 'PUT', `/api/tickets/tickets/${ticketId}/drafts`, {
        token,
        data: { draftId: draft?.draftId, body: 'Hello, we confirm your payment was booked.' },
      })
      expect(updateDraft.status()).toBe(200)

      const draftsResponse = await apiRequest(request, 'GET', `/api/tickets/tickets/${ticketId}/drafts`, { token })
      const drafts = await readJsonSafe<{ items: Array<{ id: string; body: string; sourceType: string | null }> }>(draftsResponse)
      expect(drafts?.items).toHaveLength(1)
      expect(drafts?.items[0].body).toBe('Hello, we confirm your payment was booked.')
      expect(drafts?.items[0].sourceType).toBe('workflow')

      const send = await apiRequest(request, 'POST', `/api/tickets/tickets/${ticketId}/reply`, {
        token,
        data: { draftId: draft?.draftId },
      })
      expect(send.status()).toBe(200)
      const sent = await readJsonSafe<ReplyResponse>(send)
      expect(sent?.alreadySent).toBe(false)
      expect(['simulated', 'sent']).toContain(sent?.deliveryStatus)
      expect(sent?.status).toBe('pending_customer')

      const resend = await apiRequest(request, 'POST', `/api/tickets/tickets/${ticketId}/reply`, {
        token,
        data: { draftId: draft?.draftId },
      })
      expect(resend.status()).toBe(200)
      const resent = await readJsonSafe<ReplyResponse>(resend)
      expect(resent?.alreadySent).toBe(true)
      expect(resent?.articleId).toBe(sent?.articleId)

      const editSent = await apiRequest(request, 'PUT', `/api/tickets/tickets/${ticketId}/drafts`, {
        token,
        data: { draftId: draft?.draftId, body: 'Too late' },
      })
      expect(editSent.status()).toBe(409)

      const articles = await listArticles(request, token, ticketId)
      const outbound = articles.filter((article) => article.direction === 'outbound')
      expect(outbound).toHaveLength(1)
      expect(['simulated', 'sent']).toContain(outbound[0].deliveryStatus)

      const ticket = await getTicket(request, token, ticketId)
      expect(ticket?.status).toBe('pending_customer')

      const note = await apiRequest(request, 'POST', `/api/tickets/tickets/${ticketId}/articles`, {
        token,
        data: { body: 'Internal: verified in the bank statement.' },
      })
      expect(note.status()).toBe(201)
      const withNote = await listArticles(request, token, ticketId)
      expect(withNote.some((article) => article.direction === 'internal_note')).toBe(true)

      const customerReply = await simulateEmail(request, token, {
        fromEmail: `${stamp}@example.com`,
        subject: `Re: Payment confirmation [${intake.number}]`,
        body: 'Thank you!',
      })
      expect(customerReply.ticketId).toBe(ticketId)
      expect((await getTicket(request, token, ticketId))?.status).toBe('open')
    } finally {
      await deleteTicketIfExists(request, token, ticketId)
    }
  })
})
