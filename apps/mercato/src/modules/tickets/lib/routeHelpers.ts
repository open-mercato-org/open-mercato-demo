import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { resolveOrganizationScopeForRequest } from '@open-mercato/core/modules/directory/utils/organizationScope'
import { resolveSingleOrganizationIdOrDeny } from '@open-mercato/core/modules/directory/utils/organizationScopeFilter'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { CrudHttpError, isCrudHttpError, translateCrudErrorBody } from '@open-mercato/shared/lib/crud/errors'
import { getCommandInterceptorHttpRejection } from '@open-mercato/shared/lib/commands/errors'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { serializeOperationMetadata } from '@open-mercato/shared/lib/commands/operationMetadata'
import { createLogger } from '@open-mercato/shared/lib/logger'

const logger = createLogger('tickets').child({ component: 'api' })

export type TicketsRouteContext = {
  ctx: CommandRuntimeContext
  tenantId: string
  organizationId: string
  userId: string
  translate: (key: string, fallback?: string) => string
}

export const idParamsSchema = z.object({ id: z.string().uuid() })

export function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export async function resolveRouteContext(req: Request): Promise<TicketsRouteContext> {
  const container = await createRequestContainer()
  const auth = await getAuthFromRequest(req)
  const { translate } = await resolveTranslations()
  if (!auth || !auth.tenantId || !auth.sub) {
    throw new CrudHttpError(401, { error: translate('tickets.errors.unauthorized', 'Unauthorized') })
  }
  const scope = await resolveOrganizationScopeForRequest({ container, auth, request: req })
  const organizationId = resolveSingleOrganizationIdOrDeny(scope, auth) ?? null
  if (!organizationId) {
    throw new CrudHttpError(400, { error: translate('tickets.errors.organizationRequired', 'Organization context is required') })
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
    userId: auth.sub,
    translate,
  }
}

export function parseRouteId(params: { id?: string } | undefined, translate: TicketsRouteContext['translate']): string {
  const parsed = idParamsSchema.safeParse({ id: params?.id })
  if (!parsed.success) throw new CrudHttpError(400, { error: translate('tickets.errors.invalidId', 'Invalid ticket id') })
  return parsed.data.id
}

export async function readBody(req: Request): Promise<Record<string, unknown>> {
  return toRecord(await readJsonSafe(req, {}))
}

export function routeEm(context: TicketsRouteContext): EntityManager {
  return (context.ctx.container.resolve('em') as EntityManager).fork()
}

export type GuardedCommandOptions<TInput extends Record<string, unknown>> = {
  req: Request
  context: TicketsRouteContext
  commandId: string
  resourceKind: string
  resourceId: string | null
  operation: 'create' | 'update' | 'delete' | 'custom'
  input: TInput
  parse: (payload: Record<string, unknown>) => TInput
}

export async function executeGuardedCommand<TInput extends Record<string, unknown>, TResult>(
  options: GuardedCommandOptions<TInput>,
): Promise<{ result: TResult; logEntry: unknown } | Response> {
  const { context, req } = options
  const guard = await runRouteMutationGuards({
    container: context.ctx.container,
    req,
    auth: { userId: context.userId, tenantId: context.tenantId, organizationId: context.organizationId },
    input: {
      resourceKind: options.resourceKind,
      resourceId: options.resourceId,
      operation: options.operation,
      mutationPayload: { ...options.input },
    },
  })
  if (!guard.ok) return guard.response
  const commandInput = guard.modifiedPayload ? options.parse({ ...options.input, ...guard.modifiedPayload }) : options.input
  const commandBus = context.ctx.container.resolve('commandBus') as CommandBus
  const { result, logEntry } = await commandBus.execute<TInput, TResult>(options.commandId, {
    input: commandInput,
    ctx: context.ctx,
  })
  await guard.runAfterSuccess()
  return { result, logEntry }
}

type LogEntryLike = {
  id?: unknown
  undoToken?: unknown
  commandId?: unknown
  actionLabel?: unknown
  resourceKind?: unknown
  resourceId?: unknown
  createdAt?: unknown
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

export function jsonWithOperation(body: unknown, logEntry: unknown, status = 200): NextResponse {
  const response = NextResponse.json(body, { status })
  const entry = (logEntry && typeof logEntry === 'object' ? logEntry : {}) as LogEntryLike
  const id = readOptionalString(entry.id)
  const undoToken = readOptionalString(entry.undoToken)
  const commandId = readOptionalString(entry.commandId)
  if (id && undoToken && commandId) {
    response.headers.set(
      'x-om-operation',
      serializeOperationMetadata({
        id,
        undoToken,
        commandId,
        actionLabel: readOptionalString(entry.actionLabel),
        resourceKind: readOptionalString(entry.resourceKind),
        resourceId: readOptionalString(entry.resourceId),
        executedAt: entry.createdAt instanceof Date ? entry.createdAt.toISOString() : new Date().toISOString(),
      }),
    )
  }
  return response
}

export async function handleRouteError(err: unknown, label: string): Promise<NextResponse> {
  const { translate } = await resolveTranslations()
  if (isCrudHttpError(err)) {
    return NextResponse.json(translateCrudErrorBody(err.body, translate), { status: err.status })
  }
  const interceptorRejection = getCommandInterceptorHttpRejection(err)
  if (interceptorRejection) {
    return NextResponse.json(interceptorRejection.body, { status: interceptorRejection.status })
  }
  if (err instanceof z.ZodError) {
    return NextResponse.json({ error: translate('tickets.errors.invalidInput', 'Invalid input') }, { status: 400 })
  }
  logger.error(`${label} failed`, { err })
  return NextResponse.json({ error: translate('tickets.errors.unexpected', 'Something went wrong. Please try again.') }, { status: 500 })
}
