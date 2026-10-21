import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import type { TicketTriage } from '../data/entities'
import { emitTriageAgentsEvent } from '../events'
import type { TriageScope } from './kbArticles'

const logger = createLogger('triage_agents').child({ component: 'subscribers' })

type Resolver = { resolve: <T = unknown>(name: string) => T }

export type TriageSubscriberContext = Resolver & {
  container?: Resolver
  tenantId?: string | null
  organizationId?: string | null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

export function subscriberScope(payload: unknown, ctx: TriageSubscriberContext): TriageScope | null {
  const record = payload && typeof payload === 'object' && !Array.isArray(payload) ? (payload as Record<string, unknown>) : {}
  const tenantId = readString(ctx.tenantId) ?? readString(record.tenantId)
  const organizationId = readString(ctx.organizationId) ?? readString(record.organizationId)
  return tenantId && organizationId ? { tenantId, organizationId } : null
}

export function subscriberEm(ctx: TriageSubscriberContext): EntityManager {
  const resolver = ctx.container ?? ctx
  return resolver.resolve<EntityManager>('em').fork()
}

export async function runTriageSync(
  name: string,
  payload: unknown,
  ctx: TriageSubscriberContext,
  sync: (em: EntityManager, scope: TriageScope) => Promise<TicketTriage | null>,
): Promise<void> {
  const scope = subscriberScope(payload, ctx)
  if (!scope) return
  try {
    const triage = await sync(subscriberEm(ctx), scope)
    if (!triage) return
    await emitTriageAgentsEvent(
      'triage_agents.triage.updated',
      { ticketId: triage.ticketId, stage: triage.stage, aiMode: triage.aiMode ?? null, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
  } catch (err) {
    logger.warn('Triage projection sync failed', { subscriber: name, error: err instanceof Error ? err.message : String(err) })
    reportError(err, { module: 'triage_agents', code: `triage_agents.${name}_failed` })
    throw err
  }
}
