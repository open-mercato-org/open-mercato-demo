import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { defineAiTool } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/ai-tool-definition'
import type { AiToolDefinition, McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import type { KnowledgeArticleSnapshot } from './data/validators'
import { articleKeySchema, categoryKeySchema } from './data/validators'
import { loadTaxonomy, resolveArticleVersion, type KnowledgeScope } from './lib/repository'
import type { TaxonomyNode } from './lib/taxonomy'
import {
  KNOWLEDGE_SEARCH_MAX_LIMIT,
  createKnowledgeSearchDeps,
  searchKnowledgeArticles,
  type KnowledgeSearchResult,
  type SearchServiceLike,
} from './lib/articleSearch'

export function requireToolScope(context: Pick<McpToolContext, 'tenantId' | 'organizationId'>): KnowledgeScope {
  const tenantId = typeof context.tenantId === 'string' ? context.tenantId.trim() : ''
  const organizationId = typeof context.organizationId === 'string' ? context.organizationId.trim() : ''
  if (!tenantId || !organizationId) {
    throw new Error('[internal] knowledge_articles AI tools require a tenant- and organization-scoped context')
  }
  return { tenantId, organizationId }
}

function tryResolveSearchService(context: McpToolContext): SearchServiceLike | null {
  try {
    const service = context.container.resolve<SearchServiceLike>('searchService')
    return service && typeof service.search === 'function' ? service : null
  } catch {
    return null
  }
}

export const browseTaxonomyInputSchema = z.object({})

export const searchInputSchema = z.object({
  query: z.string().trim().min(1).max(500).describe('What the customer is asking about, in plain words'),
  categoryKey: categoryKeySchema.optional().describe('Optional category or subcategory key to narrow the search, e.g. payments or payments.refunds'),
  limit: z.number().int().min(1).max(KNOWLEDGE_SEARCH_MAX_LIMIT).optional().describe('Maximum results (1-5, default 5)'),
})

export const getArticleInputSchema = z.object({
  key: articleKeySchema.describe('Stable article key, e.g. payments.refunds.overpayment_refund'),
  version: z.number().int().min(1).optional().describe('Published version to read; omit for the latest published version'),
})

export type GetArticleToolResult =
  | { found: true; key: string; version: number; citation: string; publishedAt: string; article: KnowledgeArticleSnapshot }
  | { found: false; key: string; version: number | null }

const browseTaxonomyTool: AiToolDefinition = defineAiTool<unknown, { categories: TaxonomyNode[] }>({
  name: 'knowledge_articles.browse_taxonomy',
  displayName: 'Knowledge base — browse taxonomy',
  description:
    'Return the knowledge base tree (category → subcategory → topic) with each published topic key, title, automation level, current version and a short applicability note. Use it to classify a request into a topic key.',
  tags: ['read', 'knowledge_articles'],
  isMutation: false,
  requiredFeatures: ['knowledge_articles.view'],
  inputSchema: browseTaxonomyInputSchema,
  async handler(_input, context) {
    const scope = requireToolScope(context)
    const em = context.container.resolve<EntityManager>('em')
    const categories = await loadTaxonomy(em, scope, { includeApplicability: true, applicabilityMaxLength: 200 })
    return { categories }
  },
})

const searchTool: AiToolDefinition = defineAiTool<unknown, KnowledgeSearchResult>({
  name: 'knowledge_articles.search',
  displayName: 'Knowledge base — search topics',
  description:
    'Search published knowledge base topics. Returns up to 5 matches with key, title, category path, summary, score and version. Falls back to keyword matching when no search engine is configured.',
  tags: ['read', 'knowledge_articles', 'search'],
  isMutation: false,
  requiredFeatures: ['knowledge_articles.view'],
  inputSchema: searchInputSchema,
  async handler(input, context) {
    const scope = requireToolScope(context)
    const parsed = searchInputSchema.parse(input)
    const em = context.container.resolve<EntityManager>('em')
    const deps = createKnowledgeSearchDeps(em, scope, tryResolveSearchService(context))
    return searchKnowledgeArticles(deps, {
      query: parsed.query,
      categoryKey: parsed.categoryKey ?? null,
      limit: parsed.limit ?? KNOWLEDGE_SEARCH_MAX_LIMIT,
    })
  },
})

const getArticleTool: AiToolDefinition = defineAiTool<unknown, GetArticleToolResult>({
  name: 'knowledge_articles.get_article',
  displayName: 'Knowledge base — get article',
  description:
    'Return the immutable published snapshot of a knowledge article: procedure steps (S1, S2, …), required checks, recommended actions, automation level, manual reason, target queue, priority floor and reply template. Cite it as key@version#S2 or key@version#check:<key>.',
  tags: ['read', 'knowledge_articles'],
  isMutation: false,
  requiredFeatures: ['knowledge_articles.view'],
  inputSchema: getArticleInputSchema,
  async handler(input, context) {
    const scope = requireToolScope(context)
    const parsed = getArticleInputSchema.parse(input)
    const em = context.container.resolve<EntityManager>('em')
    const row = await resolveArticleVersion(em, scope, parsed.key, parsed.version ?? null)
    if (!row) return { found: false, key: parsed.key, version: parsed.version ?? null }
    return {
      found: true,
      key: row.articleKey,
      version: row.version,
      citation: `${row.articleKey}@${row.version}`,
      publishedAt: row.createdAt.toISOString(),
      article: row.snapshot,
    }
  },
})

export const aiTools: AiToolDefinition[] = [browseTaxonomyTool, searchTool, getArticleTool]

export default aiTools
