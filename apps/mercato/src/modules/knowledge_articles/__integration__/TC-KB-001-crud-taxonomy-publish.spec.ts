import { expect, test } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  ARTICLES_API,
  CATEGORIES_API,
  TAXONOMY_API,
  cleanupTaxonomyFixture,
  createArticle,
  createTaxonomyFixture,
  readArticle,
  refundArticlePayload,
  type KnowledgeFixture,
} from './helpers'

type TaxonomyResponse = {
  items: Array<{
    key: string
    subcategories: Array<{ key: string; topics: Array<{ key: string; automationLevel: string; version: number }> }>
  }>
}

async function readTaxonomy(request: Parameters<typeof apiRequest>[0], token: string, includeDrafts = false) {
  const response = await apiRequest(request, 'GET', `${TAXONOMY_API}${includeDrafts ? '?includeDrafts=1' : ''}`, { token })
  expect(response.ok(), `taxonomy failed: ${response.status()}`).toBeTruthy()
  return (await response.json()) as TaxonomyResponse
}

function topicsFor(taxonomy: TaxonomyResponse, categoryKey: string) {
  const category = taxonomy.items.find((item) => item.key === categoryKey)
  return category?.subcategories.flatMap((sub) => sub.topics) ?? []
}

test.describe('TC-KB-001: knowledge base CRUD, taxonomy, publish and immutable versions', () => {
  test('rejects invalid placement and inconsistent procedure steps', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let fixture: KnowledgeFixture | null = null
    try {
      fixture = await createTaxonomyFixture(request, token)

      const orphanSubcategory = await apiRequest(request, 'POST', CATEGORIES_API, {
        token,
        data: { level: 'subcategory', key: `${fixture.categoryKey}.orphan`, name: 'Orphan' },
      })
      expect(orphanSubcategory.status()).toBe(422)

      const onTopLevel = await apiRequest(request, 'POST', ARTICLES_API, {
        token,
        data: { ...refundArticlePayload(fixture), categoryId: fixture.categoryId },
      })
      expect(onTopLevel.status()).toBe(422)

      const danglingCheck = await apiRequest(request, 'POST', ARTICLES_API, {
        token,
        data: {
          ...refundArticlePayload(fixture),
          procedureSteps: [{ id: 'S1', text: 'Check', checkKey: 'not_declared' }],
        },
      })
      expect(danglingCheck.status()).toBe(422)

      const duplicateSteps = await apiRequest(request, 'POST', ARTICLES_API, {
        token,
        data: {
          ...refundArticlePayload(fixture),
          procedureSteps: [{ id: 'S1', text: 'One' }, { id: 'S1', text: 'Two' }],
        },
      })
      expect(duplicateSteps.status()).toBe(422)

      const firstId = await createArticle(request, token, fixture, refundArticlePayload(fixture))
      expect(firstId).toBeTruthy()
      const duplicateKey = await apiRequest(request, 'POST', ARTICLES_API, { token, data: refundArticlePayload(fixture) })
      expect(duplicateKey.status()).toBe(409)

      const nonEmptyCategory = await apiRequest(request, 'DELETE', `${CATEGORIES_API}?id=${fixture.subcategoryId}`, { token })
      expect(nonEmptyCategory.status()).toBe(422)
    } finally {
      await cleanupTaxonomyFixture(request, token, fixture)
    }
  })

  test('lists drafts only on request, publishes immutable versions and enforces optimistic locking', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let fixture: KnowledgeFixture | null = null
    try {
      fixture = await createTaxonomyFixture(request, token)
      const payload = refundArticlePayload(fixture)
      const articleKey = String(payload.key)
      const articleId = await createArticle(request, token, fixture, payload)

      const draft = await readArticle(request, token, articleId)
      expect(draft.status).toBe('draft')
      expect(draft.version).toBe(0)
      expect(typeof draft.updatedAt).toBe('string')
      expect((draft.procedureSteps as Array<{ id: string }>).map((step) => step.id)).toEqual(['S1', 'S2', 'S3'])

      expect(topicsFor(await readTaxonomy(request, token), fixture.categoryKey)).toEqual([])
      expect(topicsFor(await readTaxonomy(request, token, true), fixture.categoryKey).map((topic) => topic.key))
        .toEqual([articleKey])

      const stalePublish = await apiRequest(request, 'POST', `${ARTICLES_API}/${articleId}/publish`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: '2000-01-01T00:00:00.000Z' },
      })
      expect(stalePublish.status()).toBe(409)

      const publishV1 = await apiRequest(request, 'POST', `${ARTICLES_API}/${articleId}/publish`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: String(draft.updatedAt) },
      })
      expect(publishV1.status(), await publishV1.text()).toBe(200)
      expect(((await publishV1.json()) as { version: number }).version).toBe(1)

      const published = await readArticle(request, token, articleId)
      expect(published.status).toBe('published')
      expect(published.version).toBe(1)
      const topics = topicsFor(await readTaxonomy(request, token), fixture.categoryKey)
      expect(topics).toEqual([expect.objectContaining({ key: articleKey, automationLevel: 'assisted', version: 1 })])

      const staleUpdate = await apiRequest(request, 'PUT', ARTICLES_API, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: String(draft.updatedAt) },
        data: { id: articleId, replyTemplate: 'Stale edit' },
      })
      expect(staleUpdate.status()).toBe(409)

      const edit = await apiRequest(request, 'PUT', ARTICLES_API, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: String(published.updatedAt) },
        data: {
          id: articleId,
          requiredChecks: [
            ...(payload.requiredChecks as Array<Record<string, unknown>>),
            { key: 'finance_review', label: 'Finance review for refunds above 300 EUR' },
          ],
          replyTemplate: 'Refunds above 300 EUR require a finance review. {{refund.amount}}',
        },
      })
      expect(edit.status(), await edit.text()).toBe(200)

      const v1Snapshot = await apiRequest(request, 'GET', `${ARTICLES_API}/${articleKey}/versions/1`, { token })
      expect(v1Snapshot.status()).toBe(200)
      const v1Body = (await v1Snapshot.json()) as { version: number; snapshot: { requiredChecks: Array<{ key: string }> } }
      expect(v1Body.version).toBe(1)
      expect(v1Body.snapshot.requiredChecks.map((check) => check.key)).toEqual(['owner_verified', 'overpayment_confirmed'])

      const edited = await readArticle(request, token, articleId)
      const publishV2 = await apiRequest(request, 'POST', `${ARTICLES_API}/${articleId}/publish`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: String(edited.updatedAt) },
      })
      expect(publishV2.status()).toBe(200)

      const latest = await apiRequest(request, 'GET', `${ARTICLES_API}/${articleKey}/versions/latest`, { token })
      const latestBody = (await latest.json()) as { version: number; snapshot: { requiredChecks: Array<{ key: string }>; procedureSteps: Array<{ id: string }> } }
      expect(latestBody.version).toBe(2)
      expect(latestBody.snapshot.requiredChecks.map((check) => check.key)).toContain('finance_review')
      expect(latestBody.snapshot.procedureSteps.map((step) => step.id)).toEqual(['S1', 'S2', 'S3'])

      const v1Again = (await (await apiRequest(request, 'GET', `${ARTICLES_API}/${articleKey}/versions/1`, { token })).json()) as typeof v1Body
      expect(v1Again.snapshot.requiredChecks.map((check) => check.key)).toEqual(['owner_verified', 'overpayment_confirmed'])

      const missing = await apiRequest(request, 'GET', `${ARTICLES_API}/${articleKey}/versions/99`, { token })
      expect(missing.status()).toBe(404)
    } finally {
      await cleanupTaxonomyFixture(request, token, fixture)
    }
  })
})
