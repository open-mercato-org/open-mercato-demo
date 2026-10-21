import { NextResponse } from 'next/server'
import { z } from 'zod'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import type { KnowledgeScope } from './repository'

const logger = createLogger('knowledge_articles').child({ component: 'routes' })

export type KnowledgeRouteContext = {
  ctx: CommandRuntimeContext
  scope: KnowledgeScope
  userId: string | null
  translate: (key: string, fallback?: string) => string
}

export async function resolveKnowledgeRouteContext(req: Request): Promise<KnowledgeRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: 'knowledge_articles.errors.unauthorized' })
  }
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = resolveSingleOrganizationIdOrDeny(organizationScope, auth) ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: 'knowledge_articles.errors.organizationRequired' })
  }
  return {
    ctx: {
      container,
      auth,
      organizationScope,
      selectedOrganizationId: organizationId,
      organizationIds: organizationScope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    },
    scope: { tenantId: auth.tenantId, organizationId },
    userId: auth.sub ?? null,
    translate,
  }
}

export async function knowledgeRouteErrorResponse(err: unknown, operation: string): Promise<Response> {
  const { translate } = await resolveTranslations()
  if (isCrudHttpError(err)) {
    return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
  }
  const interceptorRejection = getCommandInterceptorHttpRejection(err)
  if (interceptorRejection) {
    return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: translate('knowledge_articles.errors.invalidInput', 'Invalid input') }, { status: 400 })
  }
  logger.error('knowledge_articles route failed', { operation, err })
  reportError(err, { module: 'knowledge_articles', code: 'knowledge_articles.route_failed', attributes: { operation } })
  return NextResponse.json({ error: translate('knowledge_articles.errors.unexpected', 'Unexpected error') }, { status: 500 })
}
