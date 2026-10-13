import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentProposal } from '@open-mercato/enterprise/modules/agent_orchestrator/data/entities'
import { RESOLUTION_ADVISOR_AGENT_ID } from '../data/constants'
import { TicketTriage } from '../data/entities'
import { verifyProposalGrounding } from './grounding'
import { loadArticlePolicy, type KbArticleVersionReader, type TriageScope } from './kbArticles'
import {
  findTriage,
  findTriageByWorkflowInstance,
  isRecord,
  mergeRunIds,
  parseMaybeJsonRecord,
  readAdviceOutcome,
} from './projection'

export type ProposalCreatedPayload = {
  id?: unknown
  runId?: unknown
  agentId?: unknown
  optionCount?: unknown
  workflowInstanceId?: unknown
  subject?: unknown
}

export type ProposalDisposedPayload = {
  proposalId?: unknown
  disposition?: unknown
  workflowInstanceId?: unknown
}

export type ProposalExecutedPayload = {
  proposalId?: unknown
  ok?: unknown
  results?: unknown
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

async function locateTriage(
  em: EntityManager,
  scope: TriageScope,
  workflowInstanceId: string | null,
  subject: unknown,
): Promise<TicketTriage | null> {
  if (workflowInstanceId) {
    const byInstance = await findTriageByWorkflowInstance(em, scope, workflowInstanceId)
    if (byInstance) return byInstance
  }
  const subjectRecord = isRecord(subject) ? subject : null
  const ticketId = subjectRecord && subjectRecord.subjectType === 'tickets:ticket' ? readString(subjectRecord.subjectId) : null
  return ticketId ? findTriage(em, scope, ticketId) : null
}

function hasReplyAction(payload: Record<string, unknown> | null): boolean {
  const options = Array.isArray(payload?.options) ? payload.options.filter(isRecord) : []
  const first = options[0]
  const actions = first && Array.isArray(first.actions) ? first.actions.filter(isRecord) : []
  return actions.some((action) => action.type === 'tickets.reply.send')
}

/**
 * The advisor raised a proposal: the projection moves to `awaiting_approval`, records
 * the recommended action, and runs the KB grounding verification (spec fallback:
 * cited article versions, steps and checks must exist; actions must be recommended).
 */
export async function syncProposalCreated(
  em: EntityManager,
  scope: TriageScope,
  payload: ProposalCreatedPayload,
  kbReader: KbArticleVersionReader | null,
): Promise<TicketTriage | null> {
  if (readString(payload.agentId) !== RESOLUTION_ADVISOR_AGENT_ID) return null
  const proposalId = readString(payload.id)
  if (!proposalId) return null
  const triage = await locateTriage(em, scope, readString(payload.workflowInstanceId), payload.subject)
  if (!triage) return null
  const proposal = await findOneWithDecryption(
    em,
    AgentProposal,
    { id: proposalId, tenantId: scope.tenantId, organizationId: scope.organizationId },
    {},
    scope,
  )
  const proposalPayload = parseMaybeJsonRecord(proposal?.payload ?? null)
  const outcome = readAdviceOutcome(proposalPayload)
  const runId = readString(payload.runId)
  if (runId) triage.runIds = mergeRunIds(triage.runIds, RESOLUTION_ADVISOR_AGENT_ID, runId)
  triage.proposalId = proposalId
  if (outcome.proposed) {
    const settled = Boolean(triage.disposition) || triage.stage === 'applying' || triage.stage === 'done' || triage.stage === 'failed'
    if (!settled) {
      triage.stage = 'awaiting_approval'
      triage.aiMode = 'assisted'
      triage.draftState = hasReplyAction(proposalPayload) ? 'prepared' : 'none'
    }
    triage.recommendedActionLabel = outcome.recommendedActionLabel
    const verdict = await verifyProposalGrounding(proposalPayload, (key, version) => loadArticlePolicy(kbReader, scope, key, version))
    triage.groundingState = verdict.state
    triage.groundingIssues = verdict.issues
  }
  await em.flush()
  return triage
}

export async function syncProposalDisposed(em: EntityManager, scope: TriageScope, payload: ProposalDisposedPayload): Promise<TicketTriage | null> {
  const proposalId = readString(payload.proposalId)
  const disposition = readString(payload.disposition)
  if (!proposalId || !disposition) return null
  const triage = await em.findOne(TicketTriage, {
    proposalId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (!triage) return null
  triage.disposition = disposition
  if (disposition === 'rejected') {
    triage.draftState = 'rejected'
  } else if (disposition === 'approved' || disposition === 'edited' || disposition === 'auto_approved') {
    triage.stage = 'applying'
  }
  await em.flush()
  return triage
}

export async function syncProposalExecuted(em: EntityManager, scope: TriageScope, payload: ProposalExecutedPayload): Promise<TicketTriage | null> {
  const proposalId = readString(payload.proposalId)
  if (!proposalId) return null
  const triage = await em.findOne(TicketTriage, {
    proposalId,
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
  })
  if (!triage) return null
  const results = Array.isArray(payload.results) ? payload.results.filter(isRecord) : []
  const reply = results.find((entry) => entry.type === 'tickets.reply.send')
  if (reply) triage.draftState = reply.status === 'ok' ? 'sent' : 'prepared'
  await em.flush()
  return triage
}
