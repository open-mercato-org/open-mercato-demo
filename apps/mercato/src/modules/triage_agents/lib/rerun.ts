import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { TriageScope } from './kbArticles'
import { findTriage } from './projection'
import { findTriageProcessDefinition } from './processSeed'

type ResolverLike = { resolve: <T = unknown>(name: string) => T }

type TicketRow = { id?: unknown; number?: unknown }

export async function loadTicketNumber(em: EntityManager, scope: TriageScope, ticketId: string): Promise<string | null | undefined> {
  const rows = (await em.getConnection().execute(
    'SELECT id, number FROM tickets WHERE id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL LIMIT 1',
    [ticketId, scope.tenantId, scope.organizationId],
  )) as TicketRow[]
  const row = Array.isArray(rows) ? rows[0] : undefined
  if (!row) return undefined
  return typeof row.number === 'string' ? row.number : null
}

export type RerunResult = { executionId: string; attempt: number }

/**
 * Starts a fresh triage execution for a ticket through the process' manual-trigger
 * path (`agent_orchestrator.processes.startExecution`). Refused while a proposal of
 * the current attempt is still waiting for a consultant.
 */
export async function startTriageRerun(
  container: ResolverLike,
  ctx: CommandRuntimeContext,
  scope: TriageScope,
  ticketId: string,
  invokerUserId: string,
): Promise<RerunResult> {
  const em = container.resolve<EntityManager>('em').fork()
  const ticketNumber = await loadTicketNumber(em, scope, ticketId)
  if (ticketNumber === undefined) throw new CrudHttpError(404, { error: 'triage_agents.errors.ticketNotFound' })
  const triage = await findTriage(em, scope, ticketId)
  if (triage && triage.stage === 'awaiting_approval' && !triage.disposition) {
    throw new CrudHttpError(409, { error: 'triage_agents.errors.pendingProposal', code: 'pending_proposal' })
  }
  const definition = await findTriageProcessDefinition(em, scope)
  if (!definition) throw new CrudHttpError(404, { error: 'triage_agents.errors.processMissing' })
  const attempt = (triage?.attempt ?? 0) + 1
  const commandBus = container.resolve<CommandBus>('commandBus')
  const { result } = await commandBus.execute<Record<string, unknown>, { executionId: string }>(
    'agent_orchestrator.processes.startExecution',
    {
      input: {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        processDefinitionId: definition.id,
        input: { ticketId, ...(ticketNumber ? { ticketNumber } : {}) },
        idempotencyKey: `triage-rerun:${ticketId}:${attempt}:${Date.now()}`,
        sourceEntityType: 'tickets:ticket',
        sourceEntityId: ticketId,
        triggeredBy: { kind: 'manual', ref: invokerUserId },
      },
      ctx,
    },
  )
  return { executionId: result.executionId, attempt }
}
