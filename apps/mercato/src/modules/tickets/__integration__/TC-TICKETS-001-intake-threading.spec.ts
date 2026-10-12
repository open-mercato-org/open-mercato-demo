import { expect, test } from '@playwright/test'
import { getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { deleteTicketIfExists, getTicket, listArticles, simulateEmail, uniqueStamp } from './helpers'

test.describe('TC-TICKETS-001: simulated email intake and threading', () => {
  test('creates a ticket, threads follow-ups by In-Reply-To and subject token, and ignores redelivery', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueStamp('tc-tickets-001')
    const fromEmail = `${stamp}@example.com`
    let ticketId: string | null = null
    let strayTicketId: string | null = null

    try {
      const first = await simulateEmail(request, token, {
        fromEmail,
        fromName: 'QA Requester',
        subject: `Overpayment refund ${stamp}`,
        body: 'I paid twice for booking ABC123. Please refund the overpayment.',
      })
      ticketId = first.ticketId
      expect(first.created).toBe(true)
      expect(first.match).toBe('new')
      expect(first.number).toMatch(/^TCK-\d{6,}$/)

      const created = await getTicket(request, token, first.ticketId)
      expect(created?.status).toBe('new')
      expect(created?.priority).toBe('normal')
      expect(created?.requesterEmail).toBe(fromEmail)
      expect(created?.updatedAt).toBeTruthy()

      const byReply = await simulateEmail(request, token, {
        fromEmail,
        subject: `Re: Overpayment refund ${stamp}`,
        body: 'My IBAN is DE00 0000 0000 0000.',
        inReplyTo: first.messageId,
      })
      expect(byReply.created).toBe(false)
      expect(byReply.match).toBe('message')
      expect(byReply.ticketId).toBe(first.ticketId)

      const byToken = await simulateEmail(request, token, {
        fromEmail,
        subject: `Another note [${first.number}]`,
        body: 'One more detail.',
      })
      expect(byToken.created).toBe(false)
      expect(byToken.match).toBe('token')
      expect(byToken.ticketId).toBe(first.ticketId)

      const redelivered = await simulateEmail(request, token, {
        fromEmail,
        subject: `Another note [${first.number}]`,
        body: 'One more detail.',
        messageId: byToken.messageId,
      })
      expect(redelivered.created).toBe(false)
      expect(redelivered.ticketId).toBe(first.ticketId)
      expect(redelivered.articleId).toBe(byToken.articleId)

      const articles = await listArticles(request, token, first.ticketId)
      expect(articles.filter((article) => article.direction === 'inbound')).toHaveLength(3)

      const unrelated = await simulateEmail(request, token, {
        fromEmail,
        subject: `Different topic ${stamp}`,
        body: 'A brand new question.',
      })
      strayTicketId = unrelated.ticketId
      expect(unrelated.created).toBe(true)
      expect(unrelated.ticketId).not.toBe(first.ticketId)
    } finally {
      await deleteTicketIfExists(request, token, ticketId)
      await deleteTicketIfExists(request, token, strayTicketId)
    }
  })
})
