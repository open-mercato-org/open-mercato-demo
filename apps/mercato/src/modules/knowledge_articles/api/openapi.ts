import { z, type ZodTypeAny } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema as createSharedPagedListResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const knowledgeArticlesTag = 'Knowledge Base'

export const knowledgeOkSchema = z.object({ ok: z.literal(true) })
export const knowledgeCreatedSchema = z.object({ id: z.string().uuid() })
export const knowledgeErrorSchema = z.object({ error: z.string() }).passthrough()

export function createKnowledgePagedListResponseSchema(itemSchema: ZodTypeAny) {
  return createSharedPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

const buildKnowledgeCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: knowledgeArticlesTag,
  defaultCreateResponseSchema: knowledgeCreatedSchema,
  defaultOkResponseSchema: knowledgeOkSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} in the current tenant and organization scope.`,
})

export function createKnowledgeCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildKnowledgeCrudOpenApi(options)
}
