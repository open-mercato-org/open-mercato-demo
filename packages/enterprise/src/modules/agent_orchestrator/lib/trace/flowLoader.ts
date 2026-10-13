import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { AgentCorrection, AgentProposal, AgentRun, AgentSpan, AgentToolCall, ProcessInstance } from '../../data/entities'
import {
  assembleProcessFlow,
  type FlowEventInput,
  type FlowResponse,
  type FlowStepInput,
  type FlowTransitionInput,
} from './flowAssembler'

export type FlowScope = { tenantId: string; organizationId: string | null }

type WorkflowEntities = typeof import('@open-mercato/core/modules/workflows/data/entities')

async function loadWorkflowEntities(): Promise<WorkflowEntities | null> {
  try {
    return (await import('@open-mercato/core/modules/workflows/data/entities')) as WorkflowEntities
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Transition → activities, read off the workflow definition JSON the instance ran. */
export function readDefinitionTransitions(definition: unknown): FlowTransitionInput[] {
  if (!isRecord(definition) || !Array.isArray(definition.transitions)) return []
  return definition.transitions.filter(isRecord).flatMap((transition) => {
    const transitionId = typeof transition.transitionId === 'string' ? transition.transitionId : null
    const fromStepId = typeof transition.fromStepId === 'string' ? transition.fromStepId : null
    const toStepId = typeof transition.toStepId === 'string' ? transition.toStepId : null
    if (!transitionId || !fromStepId || !toStepId) return []
    const activities = (Array.isArray(transition.activities) ? transition.activities : [])
      .filter(isRecord)
      .map((activity) => {
        const config = isRecord(activity.config) ? activity.config : {}
        return {
          activityName: typeof activity.activityName === 'string' ? activity.activityName : String(activity.activityId ?? ''),
          activityType: typeof activity.activityType === 'string' ? activity.activityType : '',
          functionName: typeof config.functionName === 'string' ? config.functionName : null,
        }
      })
    return [{ transitionId, fromStepId, toStepId, activities }]
  })
}

/**
 * Resolves one execution by its own id OR its workflow instance id (the id runs,
 * proposals and the trace inspector carry), org-scoped. Null when absent or
 * cross-tenant.
 */
export async function findExecutionForFlow(
  em: EntityManager,
  id: string,
  scope: FlowScope,
): Promise<ProcessInstance | null> {
  const where = { tenantId: scope.tenantId, ...(scope.organizationId ? { organizationId: scope.organizationId } : {}), deletedAt: null }
  const byInstance = await findOneWithDecryption(em, ProcessInstance, { workflowInstanceId: id, ...where }, undefined, scope)
  if (byInstance) return byInstance
  return findOneWithDecryption(em, ProcessInstance, { id, ...where }, undefined, scope)
}

/**
 * Loads every record the flow joins — scoped to the execution's own tenant and
 * organization — and hands them to the pure assembler. The workflows module is an
 * optional peer: without it the flow still renders the trigger, the agent runs,
 * the dispositions and the effector.
 */
export async function loadProcessFlow(em: EntityManager, execution: ProcessInstance): Promise<FlowResponse> {
  const scope = { tenantId: execution.tenantId, organizationId: execution.organizationId }
  const workflowInstanceId = execution.workflowInstanceId ?? null

  let steps: FlowStepInput[] = []
  let events: FlowEventInput[] = []
  let transitions: FlowTransitionInput[] = []
  const workflows = workflowInstanceId ? await loadWorkflowEntities() : null
  if (workflows && workflowInstanceId) {
    const [instance, stepRows, eventRows] = await Promise.all([
      findOneWithDecryption(em, workflows.WorkflowInstance, { id: workflowInstanceId, ...scope }, undefined, scope),
      findWithDecryption(
        em,
        workflows.StepInstance,
        { workflowInstanceId, ...scope },
        { orderBy: { createdAt: 'asc' } },
        scope,
      ),
      findWithDecryption(
        em,
        workflows.WorkflowEvent,
        { workflowInstanceId, ...scope, eventType: { $in: ['OUTCOME_ROUTED', 'TRANSITION_EXECUTED', 'ACTIVITY_FAILED'] } },
        { orderBy: { occurredAt: 'asc' } },
        scope,
      ),
    ])
    steps = stepRows.map((row) => ({
      id: row.id,
      stepId: row.stepId,
      stepName: row.stepName ?? null,
      stepType: row.stepType ?? null,
      status: row.status,
      enteredAt: row.enteredAt ?? null,
      exitedAt: row.exitedAt ?? null,
      executionTimeMs: row.executionTimeMs ?? null,
    }))
    events = eventRows.map((row) => ({
      id: row.id,
      eventType: row.eventType,
      eventData: isRecord(row.eventData) ? row.eventData : null,
      occurredAt: row.occurredAt,
      stepInstanceId: row.stepInstanceId ?? null,
      userId: row.userId ?? null,
    }))
    if (instance?.definitionId) {
      const definition = await findOneWithDecryption(
        em,
        workflows.WorkflowDefinition,
        { id: instance.definitionId, tenantId: scope.tenantId },
        undefined,
        scope,
      )
      transitions = readDefinitionTransitions(definition?.definition)
    }
  }

  const runs = workflowInstanceId
    ? await findWithDecryption(
        em,
        AgentRun,
        { workflowInstanceId, ...scope, deletedAt: null },
        { orderBy: { createdAt: 'asc' } },
        scope,
      )
    : []
  const runIds = runs.map((run) => run.id)
  const [spans, toolCalls, proposals, corrections] = await Promise.all([
    runIds.length ? em.find(AgentSpan, { agentRunId: { $in: runIds }, ...scope }, { orderBy: { sequence: 'asc' } }) : [],
    runIds.length
      ? findWithDecryption(em, AgentToolCall, { agentRunId: { $in: runIds }, ...scope }, { orderBy: { createdAt: 'asc' } }, scope)
      : [],
    workflowInstanceId
      ? findWithDecryption(
          em,
          AgentProposal,
          { workflowInstanceId, ...scope, deletedAt: null },
          { orderBy: { createdAt: 'asc' } },
          scope,
        )
      : [],
    workflowInstanceId
      ? findWithDecryption(em, AgentCorrection, { workflowInstanceId, ...scope }, { orderBy: { createdAt: 'asc' } }, scope)
      : [],
  ])

  const input = isRecord(execution.input) ? execution.input : {}

  return assembleProcessFlow({
    execution: {
      id: execution.id,
      workflowInstanceId,
      processDefinitionId: execution.processDefinitionId ?? null,
      workflowId: execution.workflowId ?? null,
      status: execution.status,
      subjectType: execution.subjectType ?? null,
      subjectId: execution.subjectId ?? null,
      subjectLabel: execution.subjectLabel ?? null,
      triggeredBy: execution.triggeredBy ?? null,
      sourceEntityType: execution.sourceEntityType ?? null,
      sourceEntityId: execution.sourceEntityId ?? null,
      inputKeys: Object.keys(input),
      openedAt: execution.openedAt,
      completedAt: execution.completedAt ?? null,
    },
    steps,
    events,
    transitions,
    runs: runs.map((run) => ({
      id: run.id,
      agentId: run.agentId,
      stepId: run.stepId ?? null,
      parentRunId: run.parentRunId ?? null,
      status: run.status,
      resultKind: run.resultKind ?? null,
      confidence: run.confidence ?? null,
      model: run.model ?? null,
      latencyMs: run.latencyMs ?? null,
      errorMessage: run.errorMessage ?? null,
      output: run.output ?? null,
      createdAt: run.createdAt,
      completedAt: run.completedAt ?? null,
      rerunOfRunId: run.rerunOfRunId ?? null,
    })),
    spans: spans.map((span) => ({
      id: span.id,
      agentRunId: span.agentRunId,
      externalSpanId: span.externalSpanId,
      name: span.name,
      kind: span.kind,
      status: span.status,
      startedAt: span.startedAt,
      endedAt: span.endedAt ?? null,
      durationMs: span.durationMs ?? null,
      attributes: isRecord(span.attributes) ? span.attributes : null,
    })),
    toolCalls: toolCalls.map((call) => ({
      id: call.id,
      spanId: call.spanId,
      agentRunId: call.agentRunId,
      toolName: call.toolName,
      requestSummary: call.requestSummary ?? null,
      responseSummary: call.responseSummary ?? null,
      status: call.status,
      latencyMs: call.latencyMs ?? null,
      errorMessage: call.errorMessage ?? null,
      createdAt: call.createdAt,
    })),
    proposals: proposals.map((proposal) => ({
      id: proposal.id,
      runId: proposal.runId,
      agentId: proposal.agentId,
      stepId: proposal.stepId ?? null,
      payload: proposal.payload,
      disposition: proposal.disposition,
      dispositionBy: proposal.dispositionBy ?? null,
      dispositionReason: proposal.dispositionReason ?? null,
      selectedOptionId: proposal.selectedOptionId ?? null,
      createdAt: proposal.createdAt,
      updatedAt: proposal.updatedAt,
    })),
    corrections: corrections.map((correction) => ({
      proposalId: correction.proposalId,
      action: correction.action,
      proposedValue: correction.proposedValue,
      correctedValue: correction.correctedValue ?? null,
    })),
  })
}
