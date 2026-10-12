import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { articleKeySchema, articleSnapshotSchema } from '../../../../../data/validators'
import { resolveArticleVersion } from '../../../../../lib/repository'
import { knowledgeRouteErrorResponse, resolveKnowledgeRouteContext } from '../../../../../lib/routeContext'
import { knowledgeArticlesTag } from '../../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['knowledge_articles.view'] },
}

type RouteContext = { params: Promise<{ id?: string; version?: string }> }

const paramsSchema = z.object({
  key: articleKeySchema,
  version: z.union([z.literal('latest'), z.coerce.number().int().min(1)]),
})

const versionResponseSchema = z.object({
  key: z.string(),
  version: z.number().int(),
  articleId: z.string().uuid(),
  publishedAt: z.string(),
  publishedByUserId: z.string().uuid().nullable(),
  snapshot: articleSnapshotSchema,
})

export async function GET(req: Request, routeCtx: RouteContext) {
  try {
    const params = await routeCtx.params
    const parsed = paramsSchema.parse({ key: params.id, version: params.version })
    const context = await resolveKnowledgeRouteContext(req)
    const em = context.ctx.container.resolve('em') as EntityManager
    const row = await resolveArticleVersion(
      em,
      context.scope,
      parsed.key,
      parsed.version === 'latest' ? null : parsed.version,
    )
    if (!row) throw new CrudHttpError(404, { error: 'knowledge_articles.errors.versionNotFound' })
    return NextResponse.json({
      key: row.articleKey,
      version: row.version,
      articleId: row.articleId,
      publishedAt: row.createdAt.toISOString(),
      publishedByUserId: row.publishedByUserId ?? null,
      snapshot: row.snapshot,
    })
  } catch (err) {
    return knowledgeRouteErrorResponse(err, 'article.version.read')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: knowledgeArticlesTag,
  summary: 'Read a published knowledge article version',
  methods: {
    GET: {
      summary: 'Resolve `key@version` to its immutable snapshot',
      description:
        'The `:id` path segment carries the stable article key (for example `payments.refunds.overpayment_refund`). `:version` is a positive integer or `latest`. Used by citation panels to show exactly the text an agent read.',
      responses: [
        { status: 200, description: 'Version snapshot', schema: versionResponseSchema },
        { status: 404, description: 'Unknown key or version', schema: z.object({ error: z.string() }) },
      ],
    },
  },
}
