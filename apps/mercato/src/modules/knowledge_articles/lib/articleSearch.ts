import { sql } from 'kysely'
import type { EntityManager } from '@mikro-orm/postgresql'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { KnowledgeArticle, KnowledgeCategory } from '../data/entities'
import type { KnowledgeAutomationLevel } from '../data/validators'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import type { KnowledgeScope } from './repository'

const logger = createLogger('knowledge_articles').child({ component: 'search' })

export const KNOWLEDGE_ARTICLE_SEARCH_ENTITY = 'knowledge_articles:knowledge_article'
export const KNOWLEDGE_SEARCH_MAX_LIMIT = 5

export type KnowledgeSearchCandidate = {
  id: string
  key: string
  title: string
  summary: string | null
  applicability: string | null
  keywords: string[]
  categoryId: string
  automationLevel: KnowledgeAutomationLevel
  version: number
}

export type KnowledgeSearchHit = {
  key: string
  title: string
  path: string
  summary: string | null
  score: number
  version: number
  automationLevel: KnowledgeAutomationLevel
}

export type KnowledgeSearchResult = {
  source: 'search' | 'fallback'
  items: KnowledgeSearchHit[]
}

export type SearchServiceHit = {
  entityId: string
  recordId: string
  score: number
}

export type KnowledgeSearchDeps = {
  searchRecords: ((query: string, limit: number) => Promise<SearchServiceHit[]>) | null
  loadPublishedByIds: (ids: string[]) => Promise<KnowledgeSearchCandidate[]>
  loadFallbackCandidates: (terms: string[]) => Promise<KnowledgeSearchCandidate[]>
  loadCategoryPaths: () => Promise<Map<string, { path: string; ancestorKeys: string[] }>>
  onSearchError?: (error: unknown) => void
}

export type KnowledgeSearchInput = {
  query: string
  categoryKey?: string | null
  limit?: number | null
}

export function tokenizeQuery(query: string): string[] {
  const seen = new Set<string>()
  for (const raw of query.toLowerCase().split(/[^\p{L}\p{N}_]+/u)) {
    const term = raw.trim()
    if (term.length >= 2) seen.add(term)
    if (seen.size >= 8) break
  }
  return Array.from(seen)
}

export function scoreCandidate(candidate: KnowledgeSearchCandidate, terms: string[]): number {
  if (!terms.length) return 0
  const title = candidate.title.toLowerCase()
  const key = candidate.key.toLowerCase()
  const keywords = candidate.keywords.join(' ').toLowerCase()
  const summary = (candidate.summary ?? '').toLowerCase()
  const applicability = (candidate.applicability ?? '').toLowerCase()
  let total = 0
  for (const term of terms) {
    let best = 0
    if (title.includes(term)) best = Math.max(best, 3)
    if (keywords.includes(term)) best = Math.max(best, 2.5)
    if (key.includes(term)) best = Math.max(best, 2)
    if (summary.includes(term)) best = Math.max(best, 1.5)
    if (applicability.includes(term)) best = Math.max(best, 1)
    total += best
  }
  return Math.round((total / (terms.length * 3)) * 100) / 100
}

function clampLimit(limit: number | null | undefined): number {
  if (typeof limit !== 'number' || !Number.isFinite(limit)) return KNOWLEDGE_SEARCH_MAX_LIMIT
  return Math.min(KNOWLEDGE_SEARCH_MAX_LIMIT, Math.max(1, Math.trunc(limit)))
}

function inCategory(
  candidate: KnowledgeSearchCandidate,
  paths: Map<string, { path: string; ancestorKeys: string[] }>,
  categoryKey: string | null | undefined,
): boolean {
  if (!categoryKey) return true
  const entry = paths.get(candidate.categoryId)
  return Boolean(entry?.ancestorKeys.includes(categoryKey))
}

function toHit(
  candidate: KnowledgeSearchCandidate,
  paths: Map<string, { path: string; ancestorKeys: string[] }>,
  score: number,
): KnowledgeSearchHit {
  return {
    key: candidate.key,
    title: candidate.title,
    path: paths.get(candidate.categoryId)?.path ?? '',
    summary: candidate.summary,
    score,
    version: candidate.version,
    automationLevel: candidate.automationLevel,
  }
}

export async function searchKnowledgeArticles(
  deps: KnowledgeSearchDeps,
  input: KnowledgeSearchInput,
): Promise<KnowledgeSearchResult> {
  const query = input.query.trim()
  const limit = clampLimit(input.limit)
  if (!query.length) return { source: 'fallback', items: [] }
  const paths = await deps.loadCategoryPaths()

  if (deps.searchRecords) {
    try {
      const hits = (await deps.searchRecords(query, limit * 4))
        .filter((hit) => hit.entityId === KNOWLEDGE_ARTICLE_SEARCH_ENTITY)
      const bestScore = new Map<string, number>()
      for (const hit of hits) {
        const previous = bestScore.get(hit.recordId)
        if (previous === undefined || hit.score > previous) bestScore.set(hit.recordId, hit.score)
      }
      if (bestScore.size) {
        const candidates = await deps.loadPublishedByIds(Array.from(bestScore.keys()))
        const items = candidates
          .filter((candidate) => inCategory(candidate, paths, input.categoryKey))
          .map((candidate) => toHit(candidate, paths, Math.round((bestScore.get(candidate.id) ?? 0) * 100) / 100))
          .sort((left, right) => right.score - left.score)
          .slice(0, limit)
        if (items.length) return { source: 'search', items }
      }
    } catch (error) {
      deps.onSearchError?.(error)
      return fallbackSearch(deps, paths, query, input.categoryKey, limit)
    }
  }
  return fallbackSearch(deps, paths, query, input.categoryKey, limit)
}

async function fallbackSearch(
  deps: KnowledgeSearchDeps,
  paths: Map<string, { path: string; ancestorKeys: string[] }>,
  query: string,
  categoryKey: string | null | undefined,
  limit: number,
): Promise<KnowledgeSearchResult> {
  const terms = tokenizeQuery(query)
  if (!terms.length) return { source: 'fallback', items: [] }
  const candidates = await deps.loadFallbackCandidates(terms)
  const items = candidates
    .filter((candidate) => inCategory(candidate, paths, categoryKey))
    .map((candidate) => toHit(candidate, paths, scoreCandidate(candidate, terms)))
    .filter((hit) => hit.score > 0)
    .sort((left, right) => right.score - left.score || left.title.localeCompare(right.title))
    .slice(0, limit)
  return { source: 'fallback', items }
}

type KnowledgeArticlesTable = {
  id: string
  tenant_id: string
  organization_id: string
  category_id: string
  key: string
  title: string
  summary: string | null
  applicability: string | null
  keywords: string[] | null
  automation_level: string
  status: string
  version: number
  deleted_at: Date | null
}

type KnowledgeSearchDb = {
  knowledge_articles: KnowledgeArticlesTable
}

function toCandidate(article: KnowledgeArticle): KnowledgeSearchCandidate {
  return {
    id: article.id,
    key: article.key,
    title: article.title,
    summary: article.summary ?? null,
    applicability: article.applicability ?? null,
    keywords: article.keywords ?? [],
    categoryId: article.categoryId,
    automationLevel: article.automationLevel,
    version: article.version,
  }
}

export type SearchServiceLike = {
  search: (
    query: string,
    options: { tenantId: string; organizationId?: string | null; entityTypes?: string[]; limit?: number },
  ) => Promise<Array<{ entityId: string; recordId: string; score: number }>>
}

export function createKnowledgeSearchDeps(
  em: EntityManager,
  scope: KnowledgeScope,
  searchService: SearchServiceLike | null,
): KnowledgeSearchDeps {
  return {
    searchRecords: searchService
      ? async (query, limit) => searchService.search(query, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          entityTypes: [KNOWLEDGE_ARTICLE_SEARCH_ENTITY],
          limit,
        })
      : null,
    loadPublishedByIds: async (ids) => {
      if (!ids.length) return []
      const rows = await findWithDecryption(
        em,
        KnowledgeArticle,
        {
          id: { $in: ids },
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          deletedAt: null,
          status: 'published',
        },
        {},
        scope,
      )
      return rows.map(toCandidate)
    },
    loadFallbackCandidates: async (terms) => {
      const db = em.getKysely<KnowledgeSearchDb>()
      const rows = await db
        .selectFrom('knowledge_articles')
        .select('id')
        .where('tenant_id', '=', scope.tenantId)
        .where('organization_id', '=', scope.organizationId)
        .where('deleted_at', 'is', null)
        .where('status', '=', 'published')
        .where((eb) => eb.or(terms.flatMap((term) => {
          const pattern = `%${escapeLikePattern(term)}%`
          return [
            eb('title', 'ilike', pattern),
            eb('key', 'ilike', pattern),
            eb('summary', 'ilike', pattern),
            eb('applicability', 'ilike', pattern),
            eb(sql<string>`array_to_string(keywords, ' ')`, 'ilike', pattern),
          ]
        })))
        .limit(100)
        .execute()
      const ids = rows.map((row) => row.id)
      if (!ids.length) return []
      const articles = await findWithDecryption(
        em,
        KnowledgeArticle,
        { id: { $in: ids }, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
        {},
        scope,
      )
      return articles.map(toCandidate)
    },
    loadCategoryPaths: async () => {
      const categories = await findWithDecryption(
        em,
        KnowledgeCategory,
        { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
        {},
        scope,
      )
      const byId = new Map(categories.map((category) => [category.id, category]))
      const paths = new Map<string, { path: string; ancestorKeys: string[] }>()
      for (const category of categories) {
        const parent = category.parentId ? byId.get(category.parentId) : undefined
        paths.set(category.id, {
          path: parent ? `${parent.name} / ${category.name}` : category.name,
          ancestorKeys: parent ? [parent.key, category.key] : [category.key],
        })
      }
      return paths
    },
    onSearchError: (error) => {
      logger.warn('Search service failed; using the ILIKE fallback', { err: error })
      reportError(error, { module: 'knowledge_articles', code: 'knowledge_articles.search_failed' })
    },
  }
}
