import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
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
import type { TriageScope } from './kbArticles'

const logger = createLogger('triage_agents').child({ component: 'routes' })

export type TriageRouteContext = {
  container: AwilixContainer
  ctx: CommandRuntimeContext
  scope: TriageScope
  userId: string
}

export async function resolveTriageRouteContext(req: Request): Promise<TriageRouteContext> {
  const container = (await createRequestContainer()) as AwilixContainer
  const auth = await getAuthFromRequest(req)
  if (!auth || !auth.tenantId || !auth.sub) {
    throw new CrudHttpError(401, { error: 'triage_agents.errors.unauthorized' })
  }
  const organizationScope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = resolveSingleOrganizationIdOrDeny(organizationScope, auth) ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: 'triage_agents.errors.organizationRequired' })
  }
  return {
    container,
    ctx: {
      container,
      auth: { ...auth, orgId: organizationId },
      organizationScope,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
      request: req,
    },
    scope: { tenantId: auth.tenantId, organizationId },
    userId: auth.sub,
  }
}

export async function triageRouteErrorResponse(err: unknown, operation: string): Promise<Response> {
  const { translate } = await resolveTranslations()
  if (isCrudHttpError(err)) {
    return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
  }
  const interceptorRejection = getCommandInterceptorHttpRejection(err)
  if (interceptorRejection) {
    return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: translate('triage_agents.errors.invalidInput', 'Invalid input') }, { status: 400 })
  }
  logger.error('triage_agents route failed', { operation, err })
  reportError(err, { module: 'triage_agents', code: 'triage_agents.route_failed', attributes: { operation } })
  return NextResponse.json({ error: translate('triage_agents.errors.unexpected', 'Unexpected error') }, { status: 500 })
}
