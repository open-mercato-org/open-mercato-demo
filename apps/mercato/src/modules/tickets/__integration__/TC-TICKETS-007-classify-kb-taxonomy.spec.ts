import { expect, test, type APIRequestContext } from '@playwright/test'
import { apiRequest, getAuthToken } from '@open-mercato/core/helpers/integration/api'
import { login } from '@open-mercato/core/helpers/integration/auth'
import { deleteEntityIfExists } from '@open-mercato/core/helpers/integration/crmFixtures'
import { readJsonSafe } from '@open-mercato/core/helpers/integration/generalFixtures'
import { OPTIMISTIC_LOCK_HEADER, deleteTicketIfExists, getTicket, simulateEmail, uniqueStamp } from './helpers'

export const integrationMeta = {
  dependsOnModules: ['tickets', 'knowledge_articles'],
}

const CATEGORIES_API = '/api/knowledge_articles/categories'
const ARTICLES_API = '/api/knowledge_articles/articles'

async function createKbRecord(request: APIRequestContext, token: string, path: string, data: Record<string, unknown>): Promise<string> {
  const response = await apiRequest(request, 'POST', path, { token, data })
  const body = await readJsonSafe<{ id?: string }>(response)
  expect(response.status(), `create ${path} failed: ${JSON.stringify(body)}`).toBe(201)
  return body?.id as string
}

async function publishArticle(request: APIRequestContext, token: string, id: string): Promise<void> {
  const read = await apiRequest(request, 'GET', `${ARTICLES_API}?ids=${id}&pageSize=1`, { token })
  const body = await readJsonSafe<{ items?: Array<{ updatedAt?: string }> }>(read)
  const publish = await apiRequest(request, 'POST', `${ARTICLES_API}/${id}/publish`, {
    token,
    headers: { [OPTIMISTIC_LOCK_HEADER]: String(body?.items?.[0]?.updatedAt ?? '') },
  })
  expect(publish.status(), await publish.text()).toBe(200)
}

test.describe('TC-TICKETS-007: classify with the KB taxonomy selects', () => {
  test('picks category, subcategory and topic from cascading selects and stores the label path', async ({ page, request }) => {
    test.slow()
    const token = await getAuthToken(request, 'admin')
    const stamp = uniqueStamp('tc-tickets-007')
    const suffix = stamp.slice(-8).replace(/[^a-z0-9]/gi, '').toLowerCase()
    const categoryKey = `tc_tk_${suffix}`
    const subcategoryKey = `${categoryKey}.refunds`
    const topicKey = `${subcategoryKey}.overpayment`
    const categoryName = `TC Payments ${suffix}`
    const subcategoryName = `TC Refunds ${suffix}`
    const topicTitle = `TC Overpayment ${suffix}`
    let categoryId: string | null = null
    let subcategoryId: string | null = null
    let articleId: string | null = null
    let ticketId: string | null = null

    try {
      categoryId = await createKbRecord(request, token, CATEGORIES_API, { level: 'category', key: categoryKey, name: categoryName })
      subcategoryId = await createKbRecord(request, token, CATEGORIES_API, {
        level: 'subcategory',
        parentId: categoryId,
        key: subcategoryKey,
        name: subcategoryName,
      })
      articleId = await createKbRecord(request, token, ARTICLES_API, {
        categoryId: subcategoryId,
        key: topicKey,
        title: topicTitle,
        summary: 'The customer paid more than the booking total.',
        keywords: ['refund'],
        applicability: 'Use when the customer paid too much.',
        procedureSteps: [{ id: 'S1', text: 'Confirm the overpayment.' }],
        requiredChecks: [],
        recommendedActions: [],
        automationLevel: 'assisted',
        replyTemplate: 'We registered your refund request.',
      })
      await publishArticle(request, token, articleId)

      const intake = await simulateEmail(request, token, {
        fromEmail: `${stamp}@example.com`,
        subject: `Overpaid ${stamp}`,
        body: 'I paid twice for my booking.',
      })
      ticketId = intake.ticketId

      await login(page, 'admin')
      await page.goto(`/backend/tickets/${ticketId}`, { waitUntil: 'commit' })
      await page.getByRole('button', { name: 'Classify' }).click()
      const dialog = page.getByRole('dialog')
      await expect(dialog).toBeVisible()

      await dialog.getByTestId('classify-categoryKey').click()
      await page.getByRole('option', { name: categoryName }).click()
      await dialog.getByTestId('classify-subcategoryKey').click()
      await page.getByRole('option', { name: subcategoryName }).click()
      await dialog.getByTestId('classify-topicKey').click()
      await page.getByRole('option', { name: topicTitle }).click()
      await expect(dialog.getByTestId('classify-topicKey')).toContainText(topicTitle)

      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Enter' : 'Control+Enter')
      await expect(dialog).toBeHidden({ timeout: 15_000 })

      const ticket = await getTicket(request, token, ticketId)
      expect(ticket?.topicKey).toBe(topicKey)
      expect(ticket?.categoryPathSnapshot).toBe(`${categoryName} / ${subcategoryName} / ${topicTitle}`)
      expect(ticket?.classificationSource).toBe('manual')
    } finally {
      await deleteTicketIfExists(request, token, ticketId)
      await deleteEntityIfExists(request, token, ARTICLES_API, articleId)
      await deleteEntityIfExists(request, token, CATEGORIES_API, subcategoryId)
      await deleteEntityIfExists(request, token, CATEGORIES_API, categoryId)
    }
  })
})
