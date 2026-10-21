import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { knowledgeAutomationLevelSchema } from '../../data/validators'
import { loadTaxonomy } from '../../lib/repository'
import { knowledgeRouteErrorResponse, resolveKnowledgeRouteContext } from '../../lib/routeContext'
import { knowledgeArticlesTag } from '../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['knowledge_articles.view'] },
}

type RbacServiceLike = {
  userHasAllFeatures: (
    userId: string,
    required: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

const topicSchema = z.object({
  key: z.string(),
  title: z.string(),
  automationLevel: knowledgeAutomationLevelSchema,
  status: z.string(),
  version: z.number().int(),
})

const taxonomyResponseSchema = z.object({
  items: z.array(
    z.object({
      id: z.string().uuid(),
      key: z.string(),
      name: z.string(),
      subcategories: z.array(
        z.object({
          id: z.string().uuid(),
          key: z.string(),
          name: z.string(),
          topics: z.array(topicSchema),
        }),
      ),
    }),
  ),
})

export async function GET(req: Request) {
  try {
    const context = await resolveKnowledgeRouteContext(req)
    const url = new URL(req.url)
    const wantsDrafts = parseBooleanToken(url.searchParams.get('includeDrafts') ?? '') === true
    let includeDrafts = false
    if (wantsDrafts && context.userId) {
      const rbac = context.ctx.container.resolve('rbacService') as RbacServiceLike
      includeDrafts = await rbac.userHasAllFeatures(context.userId, ['knowledge_articles.manage'], context.scope)
    }
    const em = context.ctx.container.resolve('em') as EntityManager
    const items = await loadTaxonomy(em, context.scope, { includeDrafts })
    return NextResponse.json({ items })
  } catch (err) {
    return knowledgeRouteErrorResponse(err, 'taxonomy.read')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: knowledgeArticlesTag,
  summary: 'Knowledge base taxonomy',
  methods: {
    GET: {
      summary: 'Category → subcategory → topic tree',
      description:
        'Returns active categories with their subcategories and topics. Only published topics are listed unless `includeDrafts=1` is passed by a user holding `knowledge_articles.manage`.',
      query: z.object({ includeDrafts: z.string().optional() }),
      responses: [{ status: 200, description: 'Taxonomy tree', schema: taxonomyResponseSchema }],
    },
  },
}
