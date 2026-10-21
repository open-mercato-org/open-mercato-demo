import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'

export const OPTIMISTIC_LOCK_HEADER = 'x-om-ext-optimistic-lock-expected-updated-at'

export type TicketItem = {
  id: string
  number: string
  subject: string | null
  status: string
  priority: string
  queueKey: string | null
  requesterEmail: string | null
  customerPersonId: string | null
  topicKey: string | null
  categoryPathSnapshot: string | null
  summary: string | null
  needsManualReview: boolean
  manualReviewReasonCode: string | null
  manualReviewReason: string | null
  classificationSource: string | null
  updatedAt: string | null
}

export type ArticleItem = {
  id: string
  direction: string
  bodyText: string
  messageId: string | null
  deliveryStatus: string
}

export type SimulateResult = {
  ticketId: string
  number: string
  created: boolean
  articleId: string | null
  messageId: string
  match: string
}

export function uniqueStamp(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`
}

export async function simulateEmail(
  request: APIRequestContext,
  token: string,
  data: { fromEmail: string; subject: string; body: string; fromName?: string; inReplyTo?: string; messageId?: string },
): Promise<SimulateResult> {
  const response = await apiRequest(request, 'POST', '/api/tickets/intake/simulate', { token, data })
  expect([200, 201], `simulate intake should succeed: ${response.status()}`).toContain(response.status())
  const body = await readJsonSafe<SimulateResult>(response)
  expect(body?.ticketId).toBeTruthy()
  return body as SimulateResult
}

export async function getTicket(request: APIRequestContext, token: string, id: string): Promise<TicketItem | null> {
  const response = await apiRequest(request, 'GET', `/api/tickets/tickets?id=${encodeURIComponent(id)}&pageSize=1`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: TicketItem[] }>(response)
  return body?.items?.[0] ?? null
}

export async function listArticles(request: APIRequestContext, token: string, id: string): Promise<ArticleItem[]> {
  const response = await apiRequest(request, 'GET', `/api/tickets/tickets/${encodeURIComponent(id)}/articles`, { token })
  expect(response.status()).toBe(200)
  const body = await readJsonSafe<{ items?: ArticleItem[] }>(response)
  return body?.items ?? []
}

export async function deleteTicketIfExists(request: APIRequestContext, token: string | null, id: string | null): Promise<void> {
  if (!token || !id) return
  try {
    await apiRequest(request, 'DELETE', `/api/tickets/tickets?id=${encodeURIComponent(id)}`, { token })
  } catch {
    return
  }
}
