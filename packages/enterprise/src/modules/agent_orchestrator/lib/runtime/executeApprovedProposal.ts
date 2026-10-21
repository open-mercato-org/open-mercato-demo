import { z } from 'zod'
import type { AwilixContainer } from 'awilix'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { CommandBus, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { AgentProposal, AgentSpan, type AgentProposalDisposition } from '../../data/entities'
import { readProposalActions } from '../../data/proposalEnvelope'
import { emitAgentOrchestratorEvent } from '../../events'
import { ensureAgentsLoaded, getAgentEntry } from '../sdk/defineAgent'
import { executeProposal, type ExecuteProposalActionResult } from './executeProposal'
import { createWorkflowCommandAuthorizer } from './workflowCommandAuthorizer'

const logger = createLogger('agent_orchestrator').child({ component: 'execute-approved-proposal' })

export const EXECUTE_APPROVED_PROPOSAL_FUNCTION = 'agent_orchestrator.execute_approved_proposal'
export const EXECUTE_APPROVED_PROPOSAL_DI_KEY = `workflowFunction:${EXECUTE_APPROVED_PROPOSAL_FUNCTION}`
export const EXECUTE_APPROVED_PROPOSAL_LABEL_KEY = 'agent_orchestrator.workflowFunctions.executeApprovedProposal'

/** The span that records, and claims, one proposal's execution. Unique per run. */
export const PROPOSAL_EXECUTION_SPAN_NAME = 'agent_orchestrator.proposal.execute'
export const proposalExecutionSpanId = (proposalId: string): string => `proposal-execution:${proposalId}`

const EXECUTABLE_DISPOSITIONS: ReadonlySet<AgentProposalDisposition> = new Set<AgentProposalDisposition>([
  'approved',
  'edited',
  'auto_approved',
])
const RESULT_ERROR_MAX = 500

const booleanArg = z.preprocess((value) => {
  if (typeof value === 'string') return parseBooleanToken(value) ?? value
  return value
}, z.boolean())

export const executeApprovedProposalArgsSchema = z.object({
  proposalId: z.string().uuid(),
  stopOnFailure: booleanArg.optional(),
  actionCommandMap: z.record(z.string().min(1), z.string().min(1)).optional(),
})
export type ExecuteApprovedProposalArgs = z.infer<typeof executeApprovedProposalArgsSchema>

export type ExecutedActionStatus = 'ok' | 'error' | 'skipped'

export type ExecutedActionResult = {
  type: string
  commandId: string | null
  status: ExecutedActionStatus
  error?: string
}

export type ExecuteApprovedProposalResult = {
  ok: boolean
  proposalId: string
  selectedOptionId: string
  /** True when the results were recorded by an earlier call and nothing ran now. */
  replayed: boolean
  results: ExecutedActionResult[]
}

/** The slice of the workflows `ActivityContext` this function reads. */
export type ExecuteApprovedProposalContext = {
  workflowInstance: { id: string; tenantId: string; organizationId: string }
  userId?: string | null
}

const recordedExecutionSchema = z.object({
  state: z.enum(['running', 'completed']),
  proposalId: z.string(),
  selectedOptionId: z.string(),
  ok: z.boolean().optional(),
  results: z
    .array(
      z.object({
        type: z.string(),
        commandId: z.string().nullable(),
        status: z.enum(['ok', 'error', 'skipped']),
        error: z.string().optional(),
      }),
    )
    .optional(),
})
type RecordedExecution = z.infer<typeof recordedExecutionSchema>

function clampError(message: string): string {
  return message.length > RESULT_ERROR_MAX ? message.slice(0, RESULT_ERROR_MAX) : message
}

function toExecutedResult(result: ExecuteProposalActionResult, commandId: string | null): ExecutedActionResult {
  if (result.status === 'ok') return { type: result.type, commandId, status: 'ok' }
  if (result.status === 'error') return { type: result.type, commandId, status: 'error', error: clampError(result.error) }
  return { type: result.type, commandId, status: 'skipped', error: clampError(result.reason) }
}

function readRecordedExecution(span: AgentSpan | null): RecordedExecution | null {
  if (!span) return null
  const parsed = recordedExecutionSchema.safeParse(span.attributes)
  return parsed.success ? parsed.data : null
}

function replayRecorded(recorded: RecordedExecution, proposalId: string): ExecuteApprovedProposalResult {
  if (recorded.state !== 'completed') {
    throw new Error('[internal] proposal execution is already in progress')
  }
  return {
    ok: recorded.ok === true,
    proposalId,
    selectedOptionId: recorded.selectedOptionId,
    replayed: true,
    results: recorded.results ?? [],
  }
}

async function findExecutionSpan(em: EntityManager, proposal: AgentProposal): Promise<AgentSpan | null> {
  return em.findOne(AgentSpan, {
    tenantId: proposal.tenantId,
    organizationId: proposal.organizationId,
    agentRunId: proposal.runId,
    externalSpanId: proposalExecutionSpanId(proposal.id),
  })
}

async function claimExecution(
  em: EntityManager,
  proposal: AgentProposal,
  selectedOptionId: string,
  startedAt: Date,
): Promise<AgentSpan | null> {
  const [last] = await em.find(
    AgentSpan,
    { tenantId: proposal.tenantId, organizationId: proposal.organizationId, agentRunId: proposal.runId },
    { orderBy: { sequence: 'desc' }, limit: 1 },
  )
  const running: RecordedExecution = { state: 'running', proposalId: proposal.id, selectedOptionId }
  const span = em.create(AgentSpan, {
    tenantId: proposal.tenantId,
    organizationId: proposal.organizationId,
    agentRunId: proposal.runId,
    externalSpanId: proposalExecutionSpanId(proposal.id),
    sequence: (last?.sequence ?? -1) + 1,
    name: PROPOSAL_EXECUTION_SPAN_NAME,
    kind: 'system',
    startedAt,
    attributes: running,
  })
  try {
    await em.persist(span).flush()
    return span
  } catch (error) {
    logger.info('proposal execution already claimed', {
      proposalId: proposal.id,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

/**
 * The `agent_orchestrator.execute_approved_proposal` workflow function (EXECUTE_FUNCTION).
 *
 * Runs the SELECTED option of an approved proposal through the command bus, in the
 * order the agent proposed, under the workflow's own scope and acting user:
 *
 * - the proposal is loaded tenant/org-scoped from the workflow instance, never by id alone;
 * - only `approved | edited | auto_approved` proposals execute, and only the option the
 *   disposition selected — a proposal with no recorded selection fails closed;
 * - action type → command id is the identity unless `actionCommandMap` says otherwise;
 * - every action is re-checked against the catalogue ∩ the agent's `allowedActions`
 *   (an agent no longer registered allows nothing) and against the `UPDATE_ENTITY`
 *   gate (workflow-safe, tenant-enabled, user features);
 * - `stopOnFailure` defaults to true: a blocked action runs nothing, a failed one skips
 *   the rest.
 *
 * Idempotent per proposal. The execution is CLAIMED by inserting a `system` span on the
 * proposing run (`agent_spans_run_external_uq` makes the claim race-safe) and the final
 * results are recorded on it, so a retried or repeated call returns the recorded results
 * and runs nothing. A claim still `running` throws, so the activity retry policy can come
 * back once the first call has finished rather than run the plan twice.
 */
export function createExecuteApprovedProposalFunction(container: AwilixContainer) {
  return async function executeApprovedProposal(
    rawArgs: unknown,
    context: ExecuteApprovedProposalContext,
  ): Promise<ExecuteApprovedProposalResult> {
    const parsedArgs = executeApprovedProposalArgsSchema.safeParse(rawArgs ?? {})
    if (!parsedArgs.success) {
      throw new Error('[internal] execute_approved_proposal requires a valid "proposalId" argument')
    }
    const args = parsedArgs.data
    const tenantId = context.workflowInstance?.tenantId
    const organizationId = context.workflowInstance?.organizationId
    if (!tenantId || !organizationId) {
      throw new Error('[internal] execute_approved_proposal requires a tenant-scoped workflow instance')
    }

    const em = container.resolve<EntityManager>('em').fork()
    const proposal = await findOneWithDecryption(
      em,
      AgentProposal,
      { id: args.proposalId, tenantId, organizationId, deletedAt: null },
      undefined,
      { tenantId, organizationId },
    )
    if (!proposal) throw new Error('[internal] proposal not found')
    if (proposal.source === 'eval') throw new Error('[internal] eval-replay proposals cannot be executed')
    if (!EXECUTABLE_DISPOSITIONS.has(proposal.disposition)) {
      throw new Error(`[internal] proposal is not approved (disposition: ${proposal.disposition})`)
    }
    const selectedOptionId = proposal.selectedOptionId ?? null
    if (!selectedOptionId) throw new Error('[internal] approved proposal has no selected option')

    const recorded = readRecordedExecution(await findExecutionSpan(em, proposal))
    if (recorded) return replayRecorded(recorded, proposal.id)

    const startedAt = new Date()
    const span = await claimExecution(em, proposal, selectedOptionId, startedAt)
    if (!span) {
      const winner = readRecordedExecution(await findExecutionSpan(container.resolve<EntityManager>('em').fork(), proposal))
      if (!winner) throw new Error('[internal] proposal execution could not be claimed')
      return replayRecorded(winner, proposal.id)
    }

    const actions = readProposalActions(proposal.payload, selectedOptionId)
    await ensureAgentsLoaded()
    const agent = getAgentEntry(proposal.agentId)
    const allowedActions = agent ? (agent.allowedActions ?? null) : []
    const actionCommandMap: Record<string, string> = {}
    for (const action of actions) actionCommandMap[action.type] = args.actionCommandMap?.[action.type] ?? action.type

    const actorUserId = typeof context.userId === 'string' && context.userId.trim() ? context.userId.trim() : null
    const commandCtx: CommandRuntimeContext = {
      container,
      auth: actorUserId
        ? { sub: actorUserId, tenantId, orgId: organizationId, isSuperAdmin: false }
        : null,
      organizationScope: null,
      selectedOrganizationId: organizationId,
      organizationIds: [organizationId],
    }

    let results: ExecutedActionResult[]
    try {
      const raw = await executeProposal(actions, {
        commandBus: container.resolve<CommandBus>('commandBus'),
        commandCtx,
        actionCommandMap,
        allowedActions,
        stopOnFailure: args.stopOnFailure ?? true,
        authorizeCommand: createWorkflowCommandAuthorizer(container, { tenantId, organizationId, userId: actorUserId }),
      })
      results = raw.map((result) => toExecutedResult(result, actionCommandMap[result.type] ?? null))
    } catch (error) {
      results = actions.map((action) => ({
        type: action.type,
        commandId: actionCommandMap[action.type] ?? null,
        status: 'error' as const,
        error: clampError(error instanceof Error ? error.message : String(error)),
      }))
    }
    const ok = results.every((result) => result.status === 'ok')

    const endedAt = new Date()
    const completed: RecordedExecution = { state: 'completed', proposalId: proposal.id, selectedOptionId, ok, results }
    span.attributes = completed
    span.status = ok ? 'ok' : 'error'
    span.endedAt = endedAt
    span.durationMs = endedAt.getTime() - startedAt.getTime()
    await em.flush()

    try {
      await emitAgentOrchestratorEvent(
        'agent_orchestrator.proposal.executed',
        {
          proposalId: proposal.id,
          selectedOptionId,
          ok,
          results,
          agentId: proposal.agentId,
          runId: proposal.runId,
          workflowInstanceId: context.workflowInstance.id,
          tenantId,
          organizationId,
        },
        { persistent: true },
      )
    } catch (error) {
      logger.warn('proposal.executed event not emitted', {
        proposalId: proposal.id,
        error: error instanceof Error ? error.message : String(error),
      })
    }

    return { ok, proposalId: proposal.id, selectedOptionId, replayed: false, results }
  }
}
