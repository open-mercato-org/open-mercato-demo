import type { EntityManager } from '@mikro-orm/postgresql'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentProposal } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { AWAITING_DECISION_FILTER_ID, AWAITING_DECISION_FILTER_VALUE, AWAITING_DECISION_MAX_TICKETS } from '../data/constants'
import { TicketTriage } from '../data/entities'
import type { TriageScope } from './kbArticles'

const NO_MATCH_IDS_SENTINEL = 'none'

/**
 * Tickets whose AI triage proposal waits for a human decision: the projection sits in
 * `awaiting_approval` with no recorded disposition, and the AO proposal it points at is
 * still `pending`. Deliberately not narrowed to the review task's `assignedToRoles` —
 * whoever holds `agent_orchestrator.proposals.dispose` may decide (spec: consultant inbox).
 */
export async function findTicketIdsAwaitingDecision(em: EntityManager, scope: TriageScope): Promise<string[]> {
  const triages = await findWithDecryption(
    em,
    TicketTriage,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      stage: 'awaiting_approval',
      disposition: null,
      proposalId: { $ne: null },
    },
    { orderBy: { updatedAt: 'desc' }, limit: AWAITING_DECISION_MAX_TICKETS },
    scope,
  )
  const proposalIds = triages
    .map((triage) => triage.proposalId)
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
  if (proposalIds.length === 0) return []
  const pending = await findWithDecryption(
    em,
    AgentProposal,
    {
      id: { $in: proposalIds },
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      disposition: 'pending',
      deletedAt: null,
    },
    {},
    scope,
  )
  const pendingIds = new Set(pending.map((proposal) => proposal.id))
  return triages
    .filter((triage) => typeof triage.proposalId === 'string' && pendingIds.has(triage.proposalId))
    .map((triage) => triage.ticketId)
}

function readQueryString(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() || null
  if (Array.isArray(value)) return readQueryString(value[0])
  return null
}

export function isAwaitingDecisionRequested(query: Record<string, unknown> | undefined): boolean {
  return readQueryString(query?.[AWAITING_DECISION_FILTER_ID]) === AWAITING_DECISION_FILTER_VALUE
}

/**
 * Narrows a CRUD list query to the given ticket ids (`ids`, intersected with any ids the
 * caller already sent). An empty match keeps a non-UUID sentinel so the CRUD factory
 * matches nothing instead of dropping the filter.
 */
export function narrowQueryToTicketIds(query: Record<string, unknown>, ticketIds: string[]): Record<string, unknown> {
  const existingRaw = readQueryString(query.ids)
  const existing = existingRaw ? existingRaw.split(',').map((value) => value.trim()).filter(Boolean) : []
  const allowed = new Set(ticketIds)
  const ids = existing.length > 0 ? existing.filter((value) => allowed.has(value)) : ticketIds
  const next: Record<string, unknown> = { ...query, ids: ids.length > 0 ? ids.join(',') : NO_MATCH_IDS_SENTINEL }
  delete next[AWAITING_DECISION_FILTER_ID]
  return next
}
