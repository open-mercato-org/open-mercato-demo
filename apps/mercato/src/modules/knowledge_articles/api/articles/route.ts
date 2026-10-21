import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { isIdsParamProvided, parseIdsParam } from '@open-mercato/shared/lib/crud/ids'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { Where, WhereValue } from '@open-mercato/shared/lib/query/types'
import { KnowledgeArticle } from '../../data/entities'
import {
  articleCreateSchema,
  articleUpdateSchema,
  knowledgeArticleStatusSchema,
  knowledgeAutomationLevelSchema,
  knowledgePriorityFloorSchema,
  procedureStepSchema,
  recommendedActionSchema,
  requiredCheckSchema,
} from '../../data/validators'
import { KNOWLEDGE_ARTICLE_ENTITY_ID, articleCrudEvents, articleCrudIndexer } from '../../commands/shared'
import {
  readJsonArray,
  readNumber,
  readString,
  readStringArray,
  toIso,
  toRecord,
} from '../../lib/serialization'
import {
  createKnowledgeCrudOpenApi,
  createKnowledgePagedListResponseSchema,
  knowledgeCreatedSchema,
  knowledgeOkSchema,
} from '../openapi'

const querySchema = z
  .object({
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(50),
    sortField: z.enum(['title', 'key', 'status', 'automationLevel', 'version', 'createdAt', 'updatedAt']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    categoryId: z.string().uuid().optional(),
    categoryIds: z.string().optional(),
    key: z.string().trim().max(160).optional(),
    status: knowledgeArticleStatusSchema.optional(),
    automationLevel: knowledgeAutomationLevelSchema.optional(),
    q: z.string().trim().max(200).optional(),
  })
  .passthrough()

type Query = z.infer<typeof querySchema>

const rawBodySchema = z.object({}).passthrough()

const NO_MATCH_ID = '00000000-0000-0000-0000-000000000000'

const listFields = [
  'id',
  'organization_id',
  'tenant_id',
  'category_id',
  'key',
  'title',
  'summary',
  'keywords',
  'automation_level',
  'target_queue_key',
  'priority_floor',
  'status',
  'version',
  'published_at',
  'created_at',
  'updated_at',
]

const detailFields = [
  ...listFields,
  'body',
  'procedure_steps',
  'applicability',
  'required_checks',
  'recommended_actions',
  'manual_reason',
  'reply_template',
]

function isDetailQuery(query: Query): boolean {
  if (query.id) return true
  if (query.key) return true
  return parseIdsParam(query.ids).length === 1
}

export const articleListItemSchema = z
  .object({
    id: z.string().uuid(),
    categoryId: z.string().uuid().nullable(),
    key: z.string(),
    title: z.string(),
    summary: z.string().nullable(),
    keywords: z.array(z.string()),
    automationLevel: knowledgeAutomationLevelSchema,
    targetQueueKey: z.string().nullable(),
    priorityFloor: knowledgePriorityFloorSchema.nullable(),
    status: knowledgeArticleStatusSchema,
    version: z.number(),
    publishedAt: z.string().nullable(),
    body: z.string().nullable().optional(),
    procedureSteps: z.array(procedureStepSchema).optional(),
    applicability: z.string().nullable().optional(),
    requiredChecks: z.array(requiredCheckSchema).optional(),
    recommendedActions: z.array(recommendedActionSchema).optional(),
    manualReason: z.string().nullable().optional(),
    replyTemplate: z.string().nullable().optional(),
    organizationId: z.string().uuid().nullable(),
    tenantId: z.string().uuid().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .passthrough()

export type ArticleListItem = z.infer<typeof articleListItemSchema>

function hasOwn(record: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.some((key) => Object.prototype.hasOwnProperty.call(record, key))
}

function transformArticle(item: unknown): ArticleListItem {
  const record = toRecord(item)
  const automationLevel = readString(record, 'automation_level', 'automationLevel') === 'assisted' ? 'assisted' : 'manual_only'
  const status = readString(record, 'status') === 'published' ? 'published' : 'draft'
  const priority = knowledgePriorityFloorSchema.safeParse(readString(record, 'priority_floor', 'priorityFloor'))
  const result: ArticleListItem = {
    id: readString(record, 'id') ?? '',
    categoryId: readString(record, 'category_id', 'categoryId'),
    key: readString(record, 'key') ?? '',
    title: readString(record, 'title') ?? '',
    summary: readString(record, 'summary'),
    keywords: readStringArray(record, 'keywords'),
    automationLevel,
    targetQueueKey: readString(record, 'target_queue_key', 'targetQueueKey'),
    priorityFloor: priority.success ? priority.data : null,
    status,
    version: readNumber(record, 'version'),
    publishedAt: toIso(record.published_at ?? record.publishedAt),
    organizationId: readString(record, 'organization_id', 'organizationId'),
    tenantId: readString(record, 'tenant_id', 'tenantId'),
    createdAt: toIso(record.created_at ?? record.createdAt),
    updatedAt: toIso(record.updated_at ?? record.updatedAt),
  }
  if (hasOwn(record, 'body')) result.body = readString(record, 'body')
  if (hasOwn(record, 'procedure_steps', 'procedureSteps')) {
    result.procedureSteps = readJsonArray(record, 'procedure_steps', 'procedureSteps')
      .map((entry) => procedureStepSchema.safeParse(entry))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
  }
  if (hasOwn(record, 'applicability')) result.applicability = readString(record, 'applicability')
  if (hasOwn(record, 'required_checks', 'requiredChecks')) {
    result.requiredChecks = readJsonArray(record, 'required_checks', 'requiredChecks')
      .map((entry) => requiredCheckSchema.safeParse(entry))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
  }
  if (hasOwn(record, 'recommended_actions', 'recommendedActions')) {
    result.recommendedActions = readJsonArray(record, 'recommended_actions', 'recommendedActions')
      .map((entry) => recommendedActionSchema.safeParse(entry))
      .flatMap((parsed) => (parsed.success ? [parsed.data] : []))
  }
  if (hasOwn(record, 'manual_reason', 'manualReason')) result.manualReason = readString(record, 'manual_reason', 'manualReason')
  if (hasOwn(record, 'reply_template', 'replyTemplate')) result.replyTemplate = readString(record, 'reply_template', 'replyTemplate')
  return result
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['knowledge_articles.view'] },
    POST: { requireAuth: true, requireFeatures: ['knowledge_articles.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['knowledge_articles.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['knowledge_articles.manage'] },
  },
  orm: {
    entity: KnowledgeArticle,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: articleCrudEvents,
  indexer: articleCrudIndexer,
  list: {
    schema: querySchema,
    entityId: KNOWLEDGE_ARTICLE_ENTITY_ID,
    fields: (query: Query) => (isDetailQuery(query) ? detailFields : listFields),
    sortFieldMap: {
      title: 'title',
      key: 'key',
      status: 'status',
      automationLevel: 'automation_level',
      version: 'version',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: Query): Promise<Where<Record<string, unknown>>> => {
      const filters: Record<string, WhereValue> = {}
      if (isIdsParamProvided(query.ids)) {
        const ids = parseIdsParam(query.ids)
        filters.id = ids.length ? { $in: ids } : { $eq: NO_MATCH_ID }
      }
      if (query.id) filters.id = query.id
      if (query.categoryId) filters.category_id = query.categoryId
      if (isIdsParamProvided(query.categoryIds)) {
        const categoryIds = parseIdsParam(query.categoryIds)
        filters.category_id = categoryIds.length ? { $in: categoryIds } : { $eq: NO_MATCH_ID }
      }
      if (query.key) filters.key = query.key
      if (query.status) filters.status = query.status
      if (query.automationLevel) filters.automation_level = query.automationLevel
      if (query.q) {
        const term = `%${escapeLikePattern(query.q)}%`
        Object.assign(filters, {
          $or: [{ title: { $ilike: term } }, { key: { $ilike: term } }, { summary: { $ilike: term } }],
        })
      }
      return filters as Where<Record<string, unknown>>
    },
    transformItem: transformArticle,
  },
  actions: {
    create: {
      commandId: 'knowledge_articles.article.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'knowledge_articles.article.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'knowledge_articles.article.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createKnowledgeCrudOpenApi({
  resourceName: 'KnowledgeArticle',
  pluralName: 'KnowledgeArticles',
  querySchema,
  listResponseSchema: createKnowledgePagedListResponseSchema(articleListItemSchema),
  create: {
    schema: articleCreateSchema,
    responseSchema: knowledgeCreatedSchema,
    description: 'Creates a draft knowledge article (topic). The article must hang on a subcategory; procedure step ids must be unique (S1, S2, …).',
  },
  update: {
    schema: articleUpdateSchema,
    responseSchema: knowledgeOkSchema,
    description: 'Updates the working copy of a knowledge article. Published versions stay immutable until the next publish.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: knowledgeOkSchema,
    description: 'Soft-deletes a knowledge article. Published version snapshots are kept.',
  },
})
