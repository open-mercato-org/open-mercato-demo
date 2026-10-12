import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { OPTIMISTIC_LOCK_HEADER_NAME } from '@open-mercato/shared/lib/crud/optimistic-lock-headers'
import {
  ARTICLES_API,
  cleanupTaxonomyFixture,
  createArticle,
  createTaxonomyFixture,
  readArticle,
  refundArticlePayload,
  type KnowledgeFixture,
} from './helpers'

const TOOLS_EXECUTE_API = '/api/ai_assistant/tools/execute'

type ExecuteResult = { success?: boolean; result?: Record<string, unknown>; error?: string }

async function executeTool(
  request: APIRequestContext,
  token: string,
  toolName: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await apiRequest(request, 'POST', TOOLS_EXECUTE_API, { token, data: { toolName, args } })
  expect(response.ok(), `${toolName} failed: ${response.status()} ${await response.text()}`).toBeTruthy()
  const body = (await response.json()) as ExecuteResult
  expect(body.success, body.error).not.toBe(false)
  return body.result ?? {}
}

test.describe('TC-KB-002: knowledge base AI read tools', () => {
  test('search finds the published refund article for "refund overpayment" and get_article returns its snapshot', async ({ request }) => {
    const token = await getAuthToken(request, 'admin')
    let fixture: KnowledgeFixture | null = null
    try {
      fixture = await createTaxonomyFixture(request, token)
      const payload = refundArticlePayload(fixture)
      const articleKey = String(payload.key)
      const articleId = await createArticle(request, token, fixture, payload)

      const draftSearch = await executeTool(request, token, 'knowledge_articles.search', {
        query: 'refund overpayment',
        categoryKey: fixture.categoryKey,
      })
      expect(draftSearch.items).toEqual([])

      const draft = await readArticle(request, token, articleId)
      const publish = await apiRequest(request, 'POST', `${ARTICLES_API}/${articleId}/publish`, {
        token,
        headers: { [OPTIMISTIC_LOCK_HEADER_NAME]: String(draft.updatedAt) },
      })
      expect(publish.status()).toBe(200)

      const search = await executeTool(request, token, 'knowledge_articles.search', {
        query: 'refund overpayment',
        categoryKey: fixture.categoryKey,
        limit: 3,
      })
      const items = search.items as Array<{ key: string; path: string; version: number; score: number }>
      expect(items[0]).toMatchObject({ key: articleKey, version: 1 })
      expect(items[0].path).toContain(`Refunds ${fixture.suffix}`)
      expect(['search', 'fallback']).toContain(search.source)

      const taxonomy = await executeTool(request, token, 'knowledge_articles.browse_taxonomy', {})
      const categories = taxonomy.categories as Array<{ key: string; subcategories: Array<{ topics: Array<{ key: string; applicability?: string | null }> }> }>
      const ours = categories.find((category) => category.key === fixture?.categoryKey)
      expect(ours?.subcategories[0]?.topics[0]).toMatchObject({ key: articleKey })
      expect(ours?.subcategories[0]?.topics[0]?.applicability).toContain('paying too much')

      const article = await executeTool(request, token, 'knowledge_articles.get_article', { key: articleKey })
      expect(article).toMatchObject({ found: true, version: 1, citation: `${articleKey}@1` })
      const snapshot = article.article as { procedureSteps: Array<{ id: string }>; automationLevel: string; replyTemplate: string }
      expect(snapshot.procedureSteps.map((step) => step.id)).toEqual(['S1', 'S2', 'S3'])
      expect(snapshot.automationLevel).toBe('assisted')
      expect(snapshot.replyTemplate).toContain('{{refund.amount}}')

      const unknown = await executeTool(request, token, 'knowledge_articles.get_article', { key: articleKey, version: 7 })
      expect(unknown).toMatchObject({ found: false })
    } finally {
      await cleanupTaxonomyFixture(request, token, fixture)
    }
  })
})
