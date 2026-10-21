/** @jest-environment node */
import {
  KNOWLEDGE_ARTICLE_SEARCH_ENTITY,
  scoreCandidate,
  searchKnowledgeArticles,
  tokenizeQuery,
  type KnowledgeSearchCandidate,
  type KnowledgeSearchDeps,
} from '../lib/articleSearch'

const refund: KnowledgeSearchCandidate = {
  id: 'article-refund',
  key: 'payments.refunds.overpayment_refund',
  title: 'Overpayment refund',
  summary: 'The customer paid more than the booking total and asks for the difference back.',
  applicability: 'Use when the customer reports paying too much.',
  keywords: ['refund', 'overpayment', 'money back'],
  categoryId: 'sub-refunds',
  automationLevel: 'assisted',
  version: 3,
}

const payment: KnowledgeSearchCandidate = {
  id: 'article-payment',
  key: 'payments.incoming.payment_confirmation',
  title: 'Payment confirmation',
  summary: 'The customer asks whether their payment has been received.',
  applicability: null,
  keywords: ['payment', 'transfer'],
  categoryId: 'sub-incoming',
  automationLevel: 'assisted',
  version: 1,
}

const complaint: KnowledgeSearchCandidate = {
  id: 'article-complaint',
  key: 'complaints.service.hotel_service_complaint',
  title: 'Hotel service complaint',
  summary: 'Complaints about the hotel.',
  applicability: null,
  keywords: ['complaint'],
  categoryId: 'sub-service',
  automationLevel: 'manual_only',
  version: 1,
}

const paths = new Map([
  ['sub-refunds', { path: 'Payments / Refunds', ancestorKeys: ['payments', 'payments.refunds'] }],
  ['sub-incoming', { path: 'Payments / Incoming payments', ancestorKeys: ['payments', 'payments.incoming'] }],
  ['sub-service', { path: 'Complaints / Service', ancestorKeys: ['complaints', 'complaints.service'] }],
])

function makeDeps(overrides: Partial<KnowledgeSearchDeps> = {}): KnowledgeSearchDeps {
  const all = [refund, payment, complaint]
  return {
    searchRecords: null,
    loadPublishedByIds: jest.fn(async (ids: string[]) => all.filter((item) => ids.includes(item.id))),
    loadFallbackCandidates: jest.fn(async () => all),
    loadCategoryPaths: jest.fn(async () => paths),
    ...overrides,
  }
}

describe('knowledge_articles search helpers', () => {
  it('tokenizes queries into unique lowercase terms', () => {
    expect(tokenizeQuery('Refund the OVERPAYMENT, refund!')).toEqual(['refund', 'the', 'overpayment'])
    expect(tokenizeQuery('a b')).toEqual([])
  })

  it('scores title and keyword matches above body-only matches', () => {
    expect(scoreCandidate(refund, ['refund', 'overpayment'])).toBe(1)
    expect(scoreCandidate(payment, ['refund', 'overpayment'])).toBe(0)
  })
})

describe('searchKnowledgeArticles', () => {
  it('uses the ILIKE fallback when no search service is configured', async () => {
    const deps = makeDeps()
    const result = await searchKnowledgeArticles(deps, { query: 'refund overpayment' })
    expect(result.source).toBe('fallback')
    expect(result.items[0]).toMatchObject({
      key: 'payments.refunds.overpayment_refund',
      path: 'Payments / Refunds',
      version: 3,
    })
    expect(result.items.every((item) => item.score > 0)).toBe(true)
    expect(deps.loadFallbackCandidates).toHaveBeenCalledWith(['refund', 'overpayment'])
  })

  it('falls back when the search service throws and reports the error', async () => {
    const onSearchError = jest.fn()
    const deps = makeDeps({
      searchRecords: jest.fn(async () => {
        throw new Error('meilisearch down')
      }),
      onSearchError,
    })
    const result = await searchKnowledgeArticles(deps, { query: 'refund overpayment' })
    expect(result.source).toBe('fallback')
    expect(result.items[0].key).toBe('payments.refunds.overpayment_refund')
    expect(onSearchError).toHaveBeenCalledTimes(1)
  })

  it('falls back when the search service returns nothing usable', async () => {
    const deps = makeDeps({
      searchRecords: jest.fn(async () => [{ entityId: 'customers:customer_person_profile', recordId: 'x', score: 0.9 }]),
    })
    const result = await searchKnowledgeArticles(deps, { query: 'payment received' })
    expect(result.source).toBe('fallback')
    expect(result.items[0].key).toBe('payments.incoming.payment_confirmation')
  })

  it('returns search service hits ordered by score, published only, filtered by category', async () => {
    const deps = makeDeps({
      searchRecords: jest.fn(async () => [
        { entityId: KNOWLEDGE_ARTICLE_SEARCH_ENTITY, recordId: 'article-payment', score: 0.4 },
        { entityId: KNOWLEDGE_ARTICLE_SEARCH_ENTITY, recordId: 'article-refund', score: 0.91234 },
        { entityId: KNOWLEDGE_ARTICLE_SEARCH_ENTITY, recordId: 'article-complaint', score: 0.95 },
        { entityId: KNOWLEDGE_ARTICLE_SEARCH_ENTITY, recordId: 'article-draft', score: 0.99 },
      ]),
    })
    const result = await searchKnowledgeArticles(deps, { query: 'money', categoryKey: 'payments' })
    expect(result.source).toBe('search')
    expect(result.items.map((item) => item.key)).toEqual([
      'payments.refunds.overpayment_refund',
      'payments.incoming.payment_confirmation',
    ])
    expect(result.items[0].score).toBe(0.91)
  })

  it('clamps the limit to five results and ignores blank queries', async () => {
    const many = Array.from({ length: 8 }, (_unused, index) => ({ ...refund, id: `a${index}`, key: `payments.refunds.topic_${index}` }))
    const deps = makeDeps({ loadFallbackCandidates: jest.fn(async () => many) })
    const result = await searchKnowledgeArticles(deps, { query: 'refund', limit: 50 })
    expect(result.items).toHaveLength(5)
    const blank = await searchKnowledgeArticles(makeDeps(), { query: '   ' })
    expect(blank.items).toEqual([])
  })
})
