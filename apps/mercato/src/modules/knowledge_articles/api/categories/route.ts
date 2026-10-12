import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { isIdsParamProvided, parseIdsParam } from '@open-mercato/shared/lib/crud/ids'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import type { Where, WhereValue } from '@open-mercato/shared/lib/query/types'
import { KnowledgeCategory } from '../../data/entities'
import { categoryCreateSchema, categoryUpdateSchema, knowledgeCategoryLevelSchema } from '../../data/validators'
import { KNOWLEDGE_CATEGORY_ENTITY_ID, categoryCrudEvents, categoryCrudIndexer } from '../../commands/shared'
import { readBoolean, readNumber, readString, toIso, toRecord } from '../../lib/serialization'
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
    sortField: z.enum(['name', 'key', 'position', 'level', 'createdAt', 'updatedAt']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
    parentId: z.string().uuid().optional(),
    level: knowledgeCategoryLevelSchema.optional(),
    key: z.string().trim().max(120).optional(),
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
  'parent_id',
  'level',
  'key',
  'name',
  'description',
  'position',
  'is_active',
  'created_at',
  'updated_at',
]

export const categoryListItemSchema = z
  .object({
    id: z.string().uuid(),
    parentId: z.string().uuid().nullable(),
    level: knowledgeCategoryLevelSchema,
    key: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    position: z.number(),
    isActive: z.boolean(),
    organizationId: z.string().uuid().nullable(),
    tenantId: z.string().uuid().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .passthrough()

export type CategoryListItem = z.infer<typeof categoryListItemSchema>

function transformCategory(item: unknown): CategoryListItem {
  const record = toRecord(item)
  const level = readString(record, 'level') === 'subcategory' ? 'subcategory' : 'category'
  return {
    id: readString(record, 'id') ?? '',
    parentId: readString(record, 'parent_id', 'parentId'),
    level,
    key: readString(record, 'key') ?? '',
    name: readString(record, 'name') ?? '',
    description: readString(record, 'description'),
    position: readNumber(record, 'position'),
    isActive: readBoolean(record, 'is_active', 'isActive'),
    organizationId: readString(record, 'organization_id', 'organizationId'),
    tenantId: readString(record, 'tenant_id', 'tenantId'),
    createdAt: toIso(record.created_at ?? record.createdAt),
    updatedAt: toIso(record.updated_at ?? record.updatedAt),
  }
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['knowledge_articles.view'] },
    POST: { requireAuth: true, requireFeatures: ['knowledge_articles.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['knowledge_articles.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['knowledge_articles.manage'] },
  },
  orm: {
    entity: KnowledgeCategory,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: categoryCrudEvents,
  indexer: categoryCrudIndexer,
  list: {
    schema: querySchema,
    entityId: KNOWLEDGE_CATEGORY_ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      name: 'name',
      key: 'key',
      position: 'position',
      level: 'level',
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
      if (query.parentId) filters.parent_id = query.parentId
      if (query.level) filters.level = query.level
      if (query.key) filters.key = query.key
      if (query.q) filters.name = { $ilike: `%${escapeLikePattern(query.q)}%` }
      return filters as Where<Record<string, unknown>>
    },
    transformItem: transformCategory,
  },
  actions: {
    create: {
      commandId: 'knowledge_articles.category.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String((result as { id: string }).id) }),
      status: 201,
    },
    update: {
      commandId: 'knowledge_articles.category.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'knowledge_articles.category.delete',
      response: () => ({ ok: true }),
    },
  },
})

export const openApi = createKnowledgeCrudOpenApi({
  resourceName: 'KnowledgeCategory',
  pluralName: 'KnowledgeCategories',
  querySchema,
  listResponseSchema: createKnowledgePagedListResponseSchema(categoryListItemSchema),
  create: {
    schema: categoryCreateSchema,
    responseSchema: knowledgeCreatedSchema,
    description: 'Creates a knowledge base category (level `category`) or subcategory (level `subcategory`, requires a parent category).',
  },
  update: {
    schema: categoryUpdateSchema,
    responseSchema: knowledgeOkSchema,
    description: 'Updates a knowledge base category or subcategory.',
  },
  del: {
    schema: z.object({ id: z.string().uuid() }),
    responseSchema: knowledgeOkSchema,
    description: 'Soft-deletes an empty knowledge base category or subcategory.',
  },
})
