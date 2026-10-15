import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { isCrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { createLogger } from '@open-mercato/shared/lib/logger'
import type { TicketTriage } from '../data/entities'
import type { TriageScope } from './kbArticles'
import {
  cancelCurrentAttempt,
  captureAttemptState,
  findTriage,
  restoreAttemptState,
  TICKET_DELETED_REASON_CODE,
} from './projection'
import { pendingProposalOf } from './rerun'

const logger = createLogger('triage_agents').child({ component: 'ticketDeletion' })

type ResolverLike = { resolve: <T = unknown>(name: string) => T }

export type ProposalRejecter = (proposalId: string, reason: string) => Promise<void>

const SETTLED_PROPOSAL_STATUSES = new Set([404, 409])

/**
 * Rejects a proposal through the AO dispose command as the system (`userId: null`, no
 * mutation guard actor). `null` when the agent orchestrator's command bus is unavailable.
 */
export function createProposalRejecter(resolver: ResolverLike, scope: TriageScope): ProposalRejecter | null {
  let commandBus: CommandBus
  try {
    commandBus = resolver.resolve<CommandBus>('commandBus')
  } catch {
    return null
  }
  const ctx: CommandRuntimeContext = {
    container: {
      resolve: <T = unknown>(name: string) => resolver.resolve<T>(name),
      cradle: new Proxy({}, { get: (_target, prop: string) => resolver.resolve(prop) }),
    } as unknown as CommandRuntimeContext['container'],
    auth: null,
    organizationScope: null,
    selectedOrganizationId: scope.organizationId,
    organizationIds: [scope.organizationId],
  }
  return async (proposalId, reason) => {
    await commandBus.execute<Record<string, unknown>, unknown>('agent_orchestrator.proposals.dispose', {
      input: {
        proposalId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        userId: null,
        disposition: 'rejected',
        reason,
      },
      ctx,
    })
  }
}

/**
 * The ticket was deleted: closes its current triage attempt (`cancelled`, reason
 * `ticket_deleted`) and rejects a still-pending proposal so it leaves Caseload and its
 * parked workflow ends on the superseded branch without flagging the ticket. Idempotent:
 * an already cancelled or missing projection is left alone (`null`). A proposal that is
 * already settled or gone (404/409 from dispose) keeps the cancellation; any other dispose
 * failure restores the attempt and rethrows so the persistent subscriber retries.
 */
export async function cancelTriageForDeletedTicket(
  em: EntityManager,
  scope: TriageScope,
  ticketId: string,
  rejectProposal: ProposalRejecter | null,
): Promise<TicketTriage | null> {
  const triage = await findTriage(em, scope, ticketId)
  if (!triage || triage.stage === 'cancelled') return null
  const pendingProposalId = pendingProposalOf(triage)
  const snapshot = captureAttemptState(triage)
  cancelCurrentAttempt(triage, Boolean(pendingProposalId))
  await em.flush()
  if (!pendingProposalId || !rejectProposal) return triage
  try {
    await rejectProposal(pendingProposalId, TICKET_DELETED_REASON_CODE)
  } catch (err) {
    if (isCrudHttpError(err) && SETTLED_PROPOSAL_STATUSES.has(err.status)) {
      logger.info('Proposal of a deleted ticket was already settled', { ticketId, proposalId: pendingProposalId, status: err.status })
      return triage
    }
    restoreAttemptState(triage, snapshot)
    await em.flush()
    throw err
  }
  return triage
}
