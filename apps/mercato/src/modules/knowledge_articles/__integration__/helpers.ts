import { randomUUID } from 'node:crypto'
import { expect, type APIRequestContext } from '@playwright/test'
import { apiRequest } from '@open-mercato/core/helpers/integration/api'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'

export const CATEGORIES_API = '/api/knowledge_articles/categories'
export const ARTICLES_API = '/api/knowledge_articles/articles'
export const TAXONOMY_API = '/api/knowledge_articles/taxonomy'

export type KnowledgeFixture = {
  suffix: string
  categoryId: string
  categoryKey: string
  subcategoryId: string
  subcategoryKey: string
  articleIds: string[]
}

export function uniqueSuffix(): string {
  return randomUUID().replaceAll('-', '').slice(0, 10)
}

export async function createCategory(
  request: APIRequestContext,
  token: string,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', CATEGORIES_API, { token, data })
  expect(response.status(), `create category failed: ${await response.text()}`).toBe(201)
  const body = (await response.json()) as { id?: string }
  expect(body.id).toBeTruthy()
  return body.id as string
}

export async function createTaxonomyFixture(request: APIRequestContext, token: string): Promise<KnowledgeFixture> {
  const suffix = uniqueSuffix()
  const categoryKey = `tc_kb_${suffix}`
  const subcategoryKey = `${categoryKey}.refunds`
  const categoryId = await createCategory(request, token, {
    level: 'category',
    key: categoryKey,
    name: `TC KB ${suffix}`,
  })
  const subcategoryId = await createCategory(request, token, {
    level: 'subcategory',
    parentId: categoryId,
    key: subcategoryKey,
    name: `Refunds ${suffix}`,
  })
  return { suffix, categoryId, categoryKey, subcategoryId, subcategoryKey, articleIds: [] }
}

export function refundArticlePayload(fixture: KnowledgeFixture): Record<string, unknown> {
  return {
    categoryId: fixture.subcategoryId,
    key: `${fixture.subcategoryKey}.overpayment_refund`,
    title: `Overpayment refund ${fixture.suffix}`,
    summary: 'The customer paid more than the booking total and asks for the difference back.',
    keywords: ['refund', 'overpayment', 'money back'],
    applicability: 'Use when the customer reports paying too much for an existing booking.',
    procedureSteps: [
      { id: 'S1', text: 'Verify that the requester owns the booking.', checkKey: 'owner_verified' },
      { id: 'S2', text: 'Confirm the overpayment from the payment ledger.', checkKey: 'overpayment_confirmed' },
      { id: 'S3', text: 'Request the refund for the overpaid amount only.', actionKey: 'reservations.refund.request' },
    ],
    requiredChecks: [
      { key: 'owner_verified', label: 'Requester owns the booking' },
      { key: 'overpayment_confirmed', label: 'Overpayment confirmed' },
    ],
    recommendedActions: [
      { actionKey: 'reservations.refund.request', label: 'Request refund', requiresApproval: true },
    ],
    automationLevel: 'assisted',
    replyTemplate: 'We confirm that we have registered your request to refund the overpayment of {{refund.amount}}.',
  }
}

export async function createArticle(
  request: APIRequestContext,
  token: string,
  fixture: KnowledgeFixture,
  data: Record<string, unknown>,
): Promise<string> {
  const response = await apiRequest(request, 'POST', ARTICLES_API, { token, data })
  expect(response.status(), `create article failed: ${await response.text()}`).toBe(201)
  const id = ((await response.json()) as { id?: string }).id as string
  fixture.articleIds.push(id)
  return id
}

export async function readArticle(
  request: APIRequestContext,
  token: string,
  id: string,
): Promise<Record<string, unknown>> {
  const response = await apiRequest(request, 'GET', `${ARTICLES_API}?ids=${id}&pageSize=1`, { token })
  expect(response.ok(), `read article failed: ${response.status()}`).toBeTruthy()
  const body = (await response.json()) as { items?: Array<Record<string, unknown>> }
  expect(body.items?.length).toBe(1)
  return body.items?.[0] ?? {}
}

export async function cleanupTaxonomyFixture(
  request: APIRequestContext,
  token: string | null,
  fixture: KnowledgeFixture | null,
): Promise<void> {
  if (!fixture) return
  for (const id of fixture.articleIds) await deleteEntityIfExists(request, token, ARTICLES_API, id)
  await deleteEntityIfExists(request, token, CATEGORIES_API, fixture.subcategoryId)
  await deleteEntityIfExists(request, token, CATEGORIES_API, fixture.categoryId)
}
