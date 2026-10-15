import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentRun } from '../../data/entities'
import { collectLongTextFields } from '../../components/decisionCardModel'
import {
  deriveFactValuesFromInput,
  resolveDeclaredFactValues,
  type FactValue,
} from '../../components/proposalFactsData'
import type { AgentFactView } from '../../components/types'
import { redactSecrets } from '../trace/redactToolSummary'
import { ensureAgentsLoaded, getAgentEntry } from '../sdk/defineAgent'
import { resolveAgentOutcomeJsonSchema } from '../sdk/agentOutcomeContract'

/**
 * The decision basis of one proposal, resolved server-side for
 * `GET /api/agent_orchestrator/proposals?id=` so a viewer holding only
 * `agent_orchestrator.proposals.view` (e.g. a helpdesk consultant) sees the same
 * facts the decision card shows an AI operator — without reading the agent
 * registry (`agents.view`) or the run (`trace.view`). Run input/output pass
 * through the trace secret-key redaction before any value is resolved.
 */
export type ProposalDecisionContext = {
  agentLabel: string | null
  facts: FactValue[]
  longTextFields: string[]
}

export type DecisionContextAgent = {
  label: string
  facts?: AgentFactView[]
  outcomeSchema?: unknown
}

export type DecisionContextSources = {
  agent: DecisionContextAgent | null
  payload: unknown
  runInput: unknown
  runOutput: unknown
}

function parseJsonish(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

export function buildProposalDecisionContext(sources: DecisionContextSources): ProposalDecisionContext {
  const input = redactSecrets(parseJsonish(sources.runInput) ?? null)
  const output = redactSecrets(parseJsonish(sources.runOutput) ?? null)
  const payload = redactSecrets(parseJsonish(sources.payload) ?? null)
  const declared = sources.agent?.facts ?? []
  const resolved = declared.length > 0 ? resolveDeclaredFactValues(declared, { input, payload, output }) : []
  return {
    agentLabel: sources.agent?.label ?? null,
    facts: resolved.length > 0 ? resolved : deriveFactValuesFromInput(input),
    longTextFields: Array.from(collectLongTextFields(sources.agent?.outcomeSchema ?? null)).sort(),
  }
}

async function loadAgent(agentId: string): Promise<DecisionContextAgent | null> {
  await ensureAgentsLoaded()
  const entry = getAgentEntry(agentId)
  if (!entry) return null
  return { label: entry.label, facts: entry.facts, outcomeSchema: resolveAgentOutcomeJsonSchema(entry) }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * Attaches `decision_context` to a single proposal list item. The run is read in
 * the proposal's own tenant + organization, so the block can never reach across
 * scopes even if the caller's scope were wider than the row's.
 */
export async function attachProposalDecisionContext(
  em: EntityManager,
  item: Record<string, unknown>,
): Promise<void> {
  const agentId = readString(item.agent_id) ?? readString(item.agentId)
  const runId = readString(item.run_id) ?? readString(item.runId)
  const tenantId = readString(item.tenant_id) ?? readString(item.tenantId)
  const organizationId = readString(item.organization_id) ?? readString(item.organizationId)
  if (!agentId || !tenantId || !organizationId) return
  const scope = { tenantId, organizationId }
  const [agent, run] = await Promise.all([
    loadAgent(agentId),
    runId
      ? findOneWithDecryption(em, AgentRun, { id: runId, ...scope, deletedAt: null }, undefined, scope)
      : Promise.resolve(null),
  ])
  item.decision_context = buildProposalDecisionContext({
    agent,
    payload: item.payload,
    runInput: run?.input ?? null,
    runOutput: run?.output ?? null,
  })
}
