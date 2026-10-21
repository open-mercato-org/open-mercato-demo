import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import { TicketTriage } from '../data/entities'
import type { TriageScope } from './kbArticles'
import { TRIAGE_SCENARIOS, type TriageScenario } from './scenarios'

const logger = createLogger('triage_agents').child({ component: 'demo' })

type ResolverLike = { resolve: <T = unknown>(name: string) => T }

const CLOSE_PATH: Record<string, string[]> = {
  new: ['resolved', 'closed'],
  open: ['resolved', 'closed'],
  pending_customer: ['open', 'resolved', 'closed'],
  pending_internal: ['open', 'resolved', 'closed'],
  resolved: ['closed'],
}

export function buildSystemContext(container: ResolverLike, scope: TriageScope): CommandRuntimeContext {
  return {
    container: container as CommandRuntimeContext['container'],
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
    systemActor: true,
  }
}

export async function sendScenario(
  container: ResolverLike,
  scope: TriageScope,
  scenario: TriageScenario,
): Promise<{ ticketId: string; number: string }> {
  const commandBus = container.resolve<CommandBus>('commandBus')
  const receivedAt = new Date()
  const { result } = await commandBus.execute<Record<string, unknown>, { ticketId: string; number: string }>('tickets.ticket.create', {
    input: {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      subject: scenario.subject,
      channel: 'email',
      requesterEmail: scenario.fromEmail,
      requesterName: scenario.fromName,
      initialArticle: {
        fromEmail: scenario.fromEmail,
        fromName: scenario.fromName,
        subject: scenario.subject,
        bodyText: scenario.body,
        receivedAt,
      },
    },
    ctx: buildSystemContext(container, scope),
  })
  return result
}

export function resolveScenarios(selector: string): TriageScenario[] {
  if (selector === 'all') return [...TRIAGE_SCENARIOS]
  const scenario = TRIAGE_SCENARIOS.find((entry) => entry.key === selector)
  return scenario ? [scenario] : []
}

type DemoTicketRow = { id?: unknown; status?: unknown }

/**
 * Closes every open ticket of the demo personas (through the tickets transition
 * command, so audit and events stay intact) and clears the triage projection.
 */
export async function resetTriageDemo(
  container: ResolverLike,
  scope: TriageScope,
): Promise<{ ticketsClosed: number; projectionsCleared: number; reservationsReanchored: number | null }> {
  const em = container.resolve<EntityManager>('em').fork()
  const hashes = TRIAGE_SCENARIOS.flatMap((scenario) => lookupHashCandidates(scenario.fromEmail))
  const rows = (await em.getConnection().execute(
    `SELECT id, status FROM tickets WHERE tenant_id = ? AND organization_id = ? AND deleted_at IS NULL AND status <> 'closed' AND requester_email_hash IN (${hashes.map(() => '?').join(', ')})`,
    [scope.tenantId, scope.organizationId, ...hashes],
  )) as DemoTicketRow[]
  const commandBus = container.resolve<CommandBus>('commandBus')
  const ctx = buildSystemContext(container, scope)
  let ticketsClosed = 0
  for (const row of Array.isArray(rows) ? rows : []) {
    if (typeof row.id !== 'string' || typeof row.status !== 'string') continue
    for (const to of CLOSE_PATH[row.status] ?? []) {
      await commandBus.execute('tickets.ticket.transition', {
        input: { tenantId: scope.tenantId, organizationId: scope.organizationId, id: row.id, to },
        ctx,
      })
    }
    ticketsClosed += 1
  }
  const projectionsCleared = await em.nativeDelete(TicketTriage, { tenantId: scope.tenantId, organizationId: scope.organizationId })
  let reservationsReanchored: number | null = null
  try {
    const reservations = await import('../../reservations/lib/seeds')
    const result = await reservations.reanchorDemoReservationDates(container as Parameters<typeof reservations.reanchorDemoReservationDates>[0], {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    reservationsReanchored = result.updated
  } catch (err) {
    logger.warn('Reservation dates were not re-anchored (reservations module unavailable)', {
      error: err instanceof Error ? err.message : String(err),
    })
    reportError(err, { module: 'triage_agents', code: 'triage_agents.demo_reanchor_failed' })
  }
  return { ticketsClosed, projectionsCleared, reservationsReanchored }
}
