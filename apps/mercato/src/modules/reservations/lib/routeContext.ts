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
import { getTelemetryRuntime } from '@open-mercato/shared/lib/telemetry/runtime'

const logger = createLogger('reservations').child({ component: 'routes' })

export type ReservationsRouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  translate: (key: string, fallback?: string) => string
}

export async function resolveReservationsRouteContext(req: Request): Promise<ReservationsRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId) {
    throw new CrudHttpError(401, { error: translate('reservations.errors.unauthorized', 'Unauthorized') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth) ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, {
      error: translate('reservations.errors.organizationRequired', 'Organization context is required'),
    })
  }
  return {
    ctx: {
      container,
      auth,
      organizationScope: scope,
      selectedOrganizationId: organizationId,
      organizationIds: scope?.filterIds ?? (auth.orgId ? [auth.orgId] : null),
      request: req,
    },
    tenantId: auth.tenantId,
    organizationId,
    translate,
  }
}

export async function readRouteId(params: Promise<{ id?: string }> | { id?: string } | undefined): Promise<string | null> {
  const resolved = await params
  const id = typeof resolved?.id === 'string' ? resolved.id.trim() : ''
  return z.string().uuid().safeParse(id).success ? id : null
}

export async function toReservationsErrorResponse(err: unknown, label: string): Promise<Response> {
  const { translate } = await resolveTranslations()
  if (isCrudHttpError(err)) {
    return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
  }
  const interceptorRejection = getCommandInterceptorHttpRejection(err)
  if (interceptorRejection) {
    return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: translate('reservations.errors.invalidInput', 'Invalid input') }, { status: 400 })
  }
  logger.error(`${label} failed`, { err })
  getTelemetryRuntime()?.reportError(err, { module: 'reservations', code: `${label}_failed` })
  return NextResponse.json({ error: translate('reservations.errors.unexpected', 'Something went wrong') }, { status: 500 })
}
