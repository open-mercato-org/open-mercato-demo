import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { CommandBus } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { articlePublishSchema } from '../../../../data/validators'
import { KNOWLEDGE_ARTICLE_RESOURCE_KIND } from '../../../../commands/shared'
import type { PublishArticleResult } from '../../../../commands/articles'
import { knowledgeRouteErrorResponse, resolveKnowledgeRouteContext } from '../../../../lib/routeContext'
import { knowledgeArticlesTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['knowledge_articles.manage'] },
}

type RouteContext = { params: Promise<{ id?: string }> }

const publishResponseSchema = z.object({
  ok: z.literal(true),
  articleId: z.string().uuid(),
  key: z.string(),
  version: z.number().int(),
  versionId: z.string().uuid(),
})

export async function POST(req: Request, routeCtx: RouteContext) {
  try {
    const params = await routeCtx.params
    const input = articlePublishSchema.parse({ id: params.id })
    const context = await resolveKnowledgeRouteContext(req)
    if (!context.userId) throw new CrudHttpError(401, { error: 'knowledge_articles.errors.unauthorized' })
    const guarded = await runRouteMutationGuards({
      container: context.ctx.container,
      req,
      auth: { userId: context.userId, tenantId: context.scope.tenantId, organizationId: context.scope.organizationId },
      input: {
        resourceKind: KNOWLEDGE_ARTICLE_RESOURCE_KIND,
        resourceId: input.id,
        operation: 'custom',
        mutationPayload: { ...input },
      },
    })
    if (!guarded.ok) return guarded.response
    const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
    const { result } = await commandBus.execute<Record<string, unknown>, PublishArticleResult>(
      'knowledge_articles.article.publish',
      { input: { id: input.id }, ctx: context.ctx },
    )
    await guarded.runAfterSuccess()
    return NextResponse.json({ ok: true, ...result })
  } catch (err) {
    return knowledgeRouteErrorResponse(err, 'article.publish')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: knowledgeArticlesTag,
  summary: 'Publish knowledge article',
  methods: {
    POST: {
      summary: 'Publish the working copy as a new immutable version',
      description:
        'Writes an immutable snapshot `key@version` to knowledge_article_versions, bumps the article version and emits `knowledge_articles.article.published`. Send the optimistic-lock header with the article `updatedAt`.',
      responses: [
        { status: 200, description: 'Article published', schema: publishResponseSchema },
        { status: 409, description: 'The article was changed by someone else', schema: z.object({ error: z.string() }).passthrough() },
        { status: 422, description: 'The article is not publishable (not on a subcategory or inconsistent steps)', schema: z.object({ error: z.string() }).passthrough() },
      ],
    },
  },
}
