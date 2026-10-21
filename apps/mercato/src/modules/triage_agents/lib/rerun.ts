import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import type { TriageScope } from './kbArticles'
import type { TicketTriage } from '../data/entities'
import { captureAttemptState, findTriage, restoreAttemptState, SUPERSEDED_REASON_CODE, supersedeCurrentAttempt } from './projection'
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

export type RerunResult = { executionId: string; attempt: number; supersededProposalIds: string[] }

export type RerunOptions = { supersede?: boolean }

type RbacLike = {
  userHasAllFeatures: (
    userId: string,
    features: string[],
    scope: { tenantId: string | null; organizationId: string | null },
  ) => Promise<boolean>
}

export const SUPERSEDE_DISPOSE_FEATURE = 'agent_orchestrator.proposals.dispose'

export function pendingProposalOf(triage: Pick<TicketTriage, 'stage' | 'disposition' | 'proposalId'> | null): string | null {
  if (!triage || triage.stage !== 'awaiting_approval' || triage.disposition) return null
  return triage.proposalId ?? null
}

/**
 * Starts a fresh triage execution for a ticket through the process' manual-trigger
 * path (`agent_orchestrator.processes.startExecution`). While a proposal of the
 * current attempt waits for a consultant the re-run is refused, unless `supersede`
 * is set: then the attempt is closed on the projection first (so the old workflow's
 * late writes are recognised as stale and it does not flag the ticket), the proposal
 * is rejected through the AO dispose command (`superseded_by_rerun`) and the new
 * execution links the old one through `triggeredBy.rerunOfExecutionId`.
 */
export async function startTriageRerun(
  container: ResolverLike,
  ctx: CommandRuntimeContext,
  scope: TriageScope,
  ticketId: string,
  invokerUserId: string,
  options: RerunOptions = {},
): Promise<RerunResult> {
  const em = container.resolve<EntityManager>('em').fork()
  const ticketNumber = await loadTicketNumber(em, scope, ticketId)
  if (ticketNumber === undefined) throw new CrudHttpError(404, { error: 'triage_agents.errors.ticketNotFound' })
  const triage = await findTriage(em, scope, ticketId)
  const pendingProposalId = pendingProposalOf(triage)
  if (pendingProposalId && !options.supersede) {
    throw new CrudHttpError(409, { error: 'triage_agents.errors.pendingProposal', code: 'pending_proposal' })
  }
  const definition = await findTriageProcessDefinition(em, scope)
  if (!definition) throw new CrudHttpError(404, { error: 'triage_agents.errors.processMissing' })
  const commandBus = container.resolve<CommandBus>('commandBus')
  const previousExecutionId = triage?.processExecutionId ?? null
  const supersededProposalIds: string[] = []
  let attempt = (triage?.attempt ?? 0) + 1
  if (pendingProposalId && triage) {
    const rbac = container.resolve<RbacLike>('rbacService')
    const canDispose = await rbac.userHasAllFeatures(invokerUserId, [SUPERSEDE_DISPOSE_FEATURE], scope)
    if (!canDispose) throw new CrudHttpError(403, { error: 'triage_agents.errors.supersedeForbidden', code: 'missing_dispose_feature' })
    const snapshot = captureAttemptState(triage)
    supersedeCurrentAttempt(triage)
    await em.flush()
    attempt = triage.attempt
    try {
      await commandBus.execute<Record<string, unknown>, unknown>('agent_orchestrator.proposals.dispose', {
        input: {
          proposalId: pendingProposalId,
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          userId: invokerUserId,
          disposition: 'rejected',
          reason: SUPERSEDED_REASON_CODE,
        },
        ctx: { ...ctx, request: undefined },
      })
    } catch (err) {
      restoreAttemptState(triage, snapshot)
      await em.flush()
      throw err
    }
    supersededProposalIds.push(pendingProposalId)
  }
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
        triggeredBy: {
          kind: 'manual',
          ref: invokerUserId,
          ...(supersededProposalIds.length > 0 && previousExecutionId ? { rerunOfExecutionId: previousExecutionId } : {}),
        },
      },
      ctx,
    },
  )
  return { executionId: result.executionId, attempt, supersededProposalIds }
}
