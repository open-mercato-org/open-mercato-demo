/**
 * Process Flow Trace assembler (spec `2026-10-12-process-flow-trace-replay-and-embeddable-decision-card.md` §B) — PURE.
 *
 * Joins records that already exist — the execution projection, the workflow's
 * step instances and events, the agent runs with their spans and tool calls, the
 * proposals with their dispositions, and the effector claim span — into ONE
 * ordered list of nodes. There is no write path and no new storage: the flow is a
 * read model assembled on demand.
 *
 * No ORM, no DI, no React. The loader (`flowLoader.ts`) fetches and decrypts; this
 * module only shapes, so fixtures can pin every ordering and status rule.
 *
 * Redaction is structural: a tool-call node carries the tool name, the request's
 * argument KEYS (secret-shaped keys masked) and the response SIZE — never a value.
 * The full payloads stay behind the per-run trace page and its own ACL.
 */

import { normalizeProposalEnvelope, readProposalEvidence } from '../../data/proposalEnvelope'
import { isSecretKey, REDACTED_PLACEHOLDER } from './redactToolSummary'

export const PROPOSAL_EXECUTION_SPAN_PREFIX = 'proposal-execution:'
export const EXECUTE_APPROVED_PROPOSAL_FUNCTION = 'agent_orchestrator.execute_approved_proposal'

export type FlowNodeKind = 'trigger' | 'step' | 'agent_run' | 'tool_call' | 'function' | 'disposition' | 'effector'
export type FlowNodeStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'waiting'

export type FlowNodeRefs = {
  workflowStepId?: string
  runId?: string
  spanId?: string
  toolCallId?: string
  proposalId?: string
  commandId?: string
}

export type FlowNode = {
  id: string
  seq: number
  kind: FlowNodeKind
  parentId: string | null
  label: string
  status: FlowNodeStatus
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  refs: FlowNodeRefs
  summary: Record<string, unknown>
}

export type FlowExecutionHeader = {
  id: string
  workflowInstanceId: string | null
  processDefinitionId: string | null
  processKey: string | null
  status: string
  subject: { type: string | null; id: string | null; label: string | null }
  startedAt: string | null
  endedAt: string | null
  rerunOfExecutionId: string | null
}

export type FlowResponse = { execution: FlowExecutionHeader; nodes: FlowNode[] }

type DateLike = Date | string | null | undefined

export type FlowExecutionInput = {
  id: string
  workflowInstanceId: string | null
  processDefinitionId: string | null
  workflowId: string | null
  status: string
  subjectType: string | null
  subjectId: string | null
  subjectLabel: string | null
  triggeredBy: unknown
  sourceEntityType: string | null
  sourceEntityId: string | null
  inputKeys: string[]
  openedAt: DateLike
  completedAt: DateLike
}

export type FlowStepInput = {
  id: string
  stepId: string
  stepName: string | null
  stepType: string | null
  status: string
  enteredAt: DateLike
  exitedAt: DateLike
  executionTimeMs: number | null
}

export type FlowEventInput = {
  id: string
  eventType: string
  eventData: Record<string, unknown> | null
  occurredAt: DateLike
  stepInstanceId: string | null
  userId: string | null
}

export type FlowTransitionActivityInput = {
  activityName: string
  activityType: string
  functionName: string | null
}

export type FlowTransitionInput = {
  transitionId: string
  fromStepId: string
  toStepId: string
  activities: FlowTransitionActivityInput[]
}

export type FlowRunInput = {
  id: string
  agentId: string
  stepId: string | null
  parentRunId: string | null
  status: string
  resultKind: string | null
  confidence: number | null
  model: string | null
  latencyMs: number | null
  errorMessage: string | null
  output: unknown
  createdAt: DateLike
  completedAt: DateLike
  rerunOfRunId: string | null
}

export type FlowSpanInput = {
  id: string
  agentRunId: string
  externalSpanId: string
  name: string
  kind: string
  status: string
  startedAt: DateLike
  endedAt: DateLike
  durationMs: number | null
  attributes: Record<string, unknown> | null
}

export type FlowToolCallInput = {
  id: string
  spanId: string
  agentRunId: string
  toolName: string
  requestSummary: unknown
  responseSummary: unknown
  status: string
  latencyMs: number | null
  errorMessage: string | null
  createdAt: DateLike
}

export type FlowProposalInput = {
  id: string
  runId: string
  agentId: string
  stepId: string | null
  payload: unknown
  disposition: string
  dispositionBy: string | null
  dispositionReason: string | null
  selectedOptionId: string | null
  createdAt: DateLike
  updatedAt: DateLike
}

export type FlowCorrectionInput = {
  proposalId: string
  action: string
  proposedValue: unknown
  correctedValue: unknown
}

export type FlowAssemblerInput = {
  execution: FlowExecutionInput
  steps: FlowStepInput[]
  events: FlowEventInput[]
  transitions: FlowTransitionInput[]
  runs: FlowRunInput[]
  spans: FlowSpanInput[]
  toolCalls: FlowToolCallInput[]
  proposals: FlowProposalInput[]
  corrections: FlowCorrectionInput[]
}

const OUTPUT_FACTS_MAX = 60
const FACT_VALUE_MAX = 200
const EDIT_VALUE_MAX = 500
const ARG_KEYS_MAX = 40

const KIND_ORDER: Record<FlowNodeKind, number> = {
  trigger: 0,
  step: 1,
  agent_run: 2,
  tool_call: 3,
  disposition: 4,
  function: 5,
  effector: 6,
}

function toIso(value: DateLike): string | null {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : null
}

function toMs(value: DateLike): number | null {
  const iso = toIso(value)
  return iso ? Date.parse(iso) : null
}

function durationBetween(start: DateLike, end: DateLike, measured?: number | null): number | null {
  if (typeof measured === 'number' && Number.isFinite(measured)) return measured
  const from = toMs(start)
  const to = toMs(end)
  if (from == null || to == null) return null
  return Math.max(0, to - from)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    return value
  }
}

function clamp(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text
}

export function mapStepStatus(status: string): FlowNodeStatus {
  switch (status.toUpperCase()) {
    case 'COMPLETED':
      return 'succeeded'
    case 'FAILED':
    case 'CANCELLED':
      return 'failed'
    case 'SKIPPED':
      return 'skipped'
    case 'WAITING':
    case 'WAITING_FOR_ACTIVITIES':
    case 'PAUSED':
      return 'waiting'
    case 'PENDING':
      return 'pending'
    default:
      return 'running'
  }
}

export function mapRunStatus(status: string): FlowNodeStatus {
  if (status === 'running') return 'running'
  if (status === 'ok' || status === 'completed') return 'succeeded'
  if (status === 'cancelled') return 'skipped'
  return 'failed'
}

export function mapDispositionStatus(disposition: string): FlowNodeStatus {
  if (disposition === 'pending') return 'waiting'
  if (disposition === 'rejected') return 'failed'
  if (disposition === 'none_proposed') return 'skipped'
  return 'succeeded'
}

/** Argument keys only — a secret-shaped key is masked even as a NAME is harmless, to keep one rule. */
export function summarizeToolArgs(requestSummary: unknown): string[] {
  const parsed = parseMaybeJson(requestSummary)
  if (!isRecord(parsed)) return []
  return Object.keys(parsed)
    .slice(0, ARG_KEYS_MAX)
    .map((key) => (isSecretKey(key) ? REDACTED_PLACEHOLDER : key))
}

export function resultSizeOf(responseSummary: unknown): number {
  if (responseSummary === null || responseSummary === undefined) return 0
  const text = typeof responseSummary === 'string' ? responseSummary : JSON.stringify(responseSummary) ?? ''
  return new TextEncoder().encode(text).length
}

/**
 * Flattens a run output to `path → primitive` facts for the attempt compare view,
 * masking secret-shaped keys and clamping long strings. Capped, so a huge output
 * never inflates the flow response.
 */
export function flattenOutputFacts(output: unknown): Record<string, string | number | boolean | null> {
  const facts: Record<string, string | number | boolean | null> = {}
  let count = 0
  const visit = (value: unknown, path: string) => {
    if (count >= OUTPUT_FACTS_MAX) return
    if (value === null || typeof value === 'number' || typeof value === 'boolean') {
      if (path) {
        facts[path] = value
        count += 1
      }
      return
    }
    if (typeof value === 'string') {
      if (path) {
        facts[path] = clamp(value, FACT_VALUE_MAX)
        count += 1
      }
      return
    }
    if (Array.isArray(value)) {
      value.forEach((entry, index) => visit(entry, path ? `${path}.${index}` : String(index)))
      return
    }
    if (isRecord(value)) {
      for (const [key, entry] of Object.entries(value)) {
        const nextPath = path ? `${path}.${key}` : key
        if (isSecretKey(key)) {
          if (count < OUTPUT_FACTS_MAX) {
            facts[nextPath] = REDACTED_PLACEHOLDER
            count += 1
          }
          continue
        }
        visit(entry, nextPath)
      }
    }
  }
  visit(parseMaybeJson(output), '')
  return facts
}

type EditedField = { action: number; type: string; field: string; before: unknown; after: unknown }

function clampValue(value: unknown): unknown {
  if (typeof value === 'string') return clamp(value, EDIT_VALUE_MAX)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  return clamp(JSON.stringify(value) ?? '', EDIT_VALUE_MAX)
}

/** The per-field diff of the SELECTED option's actions between the agent's and the operator's payload. */
export function diffEditedFields(
  proposedPayload: unknown,
  correctedPayload: unknown,
  selectedOptionId: string | null,
): EditedField[] {
  const pick = (payload: unknown) => {
    const options = normalizeProposalEnvelope(parseMaybeJson(payload)).options
    return (selectedOptionId ? options.find((option) => option.id === selectedOptionId) : options[0]) ?? null
  }
  const before = pick(proposedPayload)
  const after = pick(correctedPayload)
  if (!before || !after) return []
  const diffs: EditedField[] = []
  const count = Math.max(before.actions.length, after.actions.length)
  for (let index = 0; index < count; index += 1) {
    const original = before.actions[index]
    const edited = after.actions[index]
    const keys = new Set([...Object.keys(original?.payload ?? {}), ...Object.keys(edited?.payload ?? {})])
    for (const key of keys) {
      const left = original?.payload?.[key]
      const right = edited?.payload?.[key]
      if (JSON.stringify(left) === JSON.stringify(right)) continue
      diffs.push({
        action: index,
        type: edited?.type ?? original?.type ?? '',
        field: key,
        before: isSecretKey(key) ? REDACTED_PLACEHOLDER : clampValue(left ?? null),
        after: isSecretKey(key) ? REDACTED_PLACEHOLDER : clampValue(right ?? null),
      })
    }
  }
  return diffs
}

/** What a proposal put forward, reduced to what the compare view and the disposition node show. */
export function summarizeProposal(payload: unknown, selectedOptionId: string | null): Record<string, unknown> {
  const parsed = parseMaybeJson(payload)
  const envelope = normalizeProposalEnvelope(parsed)
  const evidence = readProposalEvidence(parsed)
  const option =
    (selectedOptionId ? envelope.options.find((entry) => entry.id === selectedOptionId) : null) ??
    envelope.options[0] ??
    null
  return {
    optionCount: envelope.options.length,
    optionId: option?.id ?? null,
    optionLabel: option?.label ?? null,
    actionTypes: option ? option.actions.map((action) => action.type) : [],
    citations: (evidence?.citations ?? []).map((citation) => ({
      kind: citation.kind,
      ref: citation.ref,
      label: citation.label ?? null,
    })),
    checks: (evidence?.checks ?? []).map((check) => ({ key: check.key, passed: check.passed, step: check.step ?? null })),
  }
}

function readTriggerKind(triggeredBy: unknown): { kind: string | null; rerunOfExecutionId: string | null } {
  const value = parseMaybeJson(triggeredBy)
  if (!isRecord(value)) return { kind: null, rerunOfExecutionId: null }
  return {
    kind: typeof value.kind === 'string' ? value.kind : null,
    rerunOfExecutionId: typeof value.rerunOfExecutionId === 'string' ? value.rerunOfExecutionId : null,
  }
}

export function readRerunOfExecutionId(triggeredBy: unknown): string | null {
  return readTriggerKind(triggeredBy).rerunOfExecutionId
}

type DraftNode = Omit<FlowNode, 'seq'> & { sortAt: number }

/** The newest step-instance row of `stepId` that entered at or before `atMs` (else the newest overall). */
function stepNodeFor(
  stepNodesByStepId: Map<string, Array<{ id: string; enteredMs: number }>>,
  stepId: string | null,
  atMs: number | null,
): string | null {
  if (!stepId) return null
  const candidates = stepNodesByStepId.get(stepId)
  if (!candidates || candidates.length === 0) return null
  if (atMs == null) return candidates[candidates.length - 1].id
  let match: string | null = null
  for (const candidate of candidates) {
    if (candidate.enteredMs <= atMs) match = candidate.id
  }
  return match ?? candidates[0].id
}

function toFlowNode(draft: DraftNode, seq: number): FlowNode {
  return {
    id: draft.id,
    seq,
    kind: draft.kind,
    parentId: draft.parentId,
    label: draft.label,
    status: draft.status,
    startedAt: draft.startedAt,
    endedAt: draft.endedAt,
    durationMs: draft.durationMs,
    refs: draft.refs,
    summary: draft.summary,
  }
}

export function assembleProcessFlow(input: FlowAssemblerInput): FlowResponse {
  const { execution } = input
  const trigger = readTriggerKind(execution.triggeredBy)
  const startedAt = toIso(execution.openedAt)
  const baseMs = startedAt ? Date.parse(startedAt) : 0
  const drafts: DraftNode[] = []

  drafts.push({
    id: `trigger:${execution.id}`,
    kind: 'trigger',
    parentId: null,
    label: trigger.kind ?? 'trigger',
    status: 'succeeded',
    startedAt,
    endedAt: startedAt,
    durationMs: 0,
    refs: {},
    summary: {
      triggerKind: trigger.kind,
      sourceEntityType: execution.sourceEntityType,
      sourceEntityId: execution.sourceEntityId,
      inputKeys: execution.inputKeys.map((key) => (isSecretKey(key) ? REDACTED_PLACEHOLDER : key)),
      rerunOfExecutionId: trigger.rerunOfExecutionId,
    },
    sortAt: baseMs - 1,
  })

  const stepNodesByStepId = new Map<string, Array<{ id: string; enteredMs: number }>>()
  const stepNodeIdByInstanceId = new Map<string, string>()
  const sortedSteps = [...input.steps].sort(
    (left, right) => (toMs(left.enteredAt) ?? Number.MAX_SAFE_INTEGER) - (toMs(right.enteredAt) ?? Number.MAX_SAFE_INTEGER),
  )
  for (const step of sortedSteps) {
    const nodeId = `step:${step.id}`
    const enteredAt = toIso(step.enteredAt)
    const exitedAt = toIso(step.exitedAt)
    const enteredMs = enteredAt ? Date.parse(enteredAt) : baseMs
    stepNodeIdByInstanceId.set(step.id, nodeId)
    const list = stepNodesByStepId.get(step.stepId) ?? []
    list.push({ id: nodeId, enteredMs })
    stepNodesByStepId.set(step.stepId, list)
    drafts.push({
      id: nodeId,
      kind: 'step',
      parentId: null,
      label: step.stepName || step.stepId,
      status: mapStepStatus(step.status),
      startedAt: enteredAt,
      endedAt: exitedAt,
      durationMs: durationBetween(step.enteredAt, step.exitedAt, step.executionTimeMs),
      refs: { workflowStepId: step.stepId },
      summary: { stepType: step.stepType, rawStatus: step.status },
      sortAt: enteredMs,
    })
  }

  const routeByStepInstance = new Map<string, { outcome: string | null; toStepId: string | null }>()
  for (const event of input.events) {
    if (event.eventType !== 'OUTCOME_ROUTED' || !event.eventData) continue
    const stepId = typeof event.eventData.stepId === 'string' ? event.eventData.stepId : null
    const nodeId = event.stepInstanceId
      ? stepNodeIdByInstanceId.get(event.stepInstanceId) ?? null
      : stepNodeFor(stepNodesByStepId, stepId, toMs(event.occurredAt))
    if (!nodeId) continue
    routeByStepInstance.set(nodeId, {
      outcome: typeof event.eventData.outcome === 'string' ? event.eventData.outcome : null,
      toStepId: typeof event.eventData.toStepId === 'string' ? event.eventData.toStepId : null,
    })
  }
  for (const draft of drafts) {
    const route = routeByStepInstance.get(draft.id)
    if (route) draft.summary = { ...draft.summary, routedOutcome: route.outcome, routedTo: route.toStepId }
  }

  const effectorSpans = input.spans.filter((span) => span.externalSpanId.startsWith(PROPOSAL_EXECUTION_SPAN_PREFIX))

  const transitionsById = new Map(input.transitions.map((transition) => [transition.transitionId, transition]))
  const failedTransitions = new Map<string, Array<{ activityName: string | null; error: string | null }>>()
  for (const event of input.events) {
    if (event.eventType !== 'ACTIVITY_FAILED' || !event.eventData) continue
    const transitionId = typeof event.eventData.transitionId === 'string' ? event.eventData.transitionId : null
    if (!transitionId) continue
    const failed = Array.isArray(event.eventData.failedActivities) ? event.eventData.failedActivities : []
    failedTransitions.set(
      transitionId,
      failed.filter(isRecord).map((entry) => ({
        activityName: typeof entry.activityName === 'string' ? entry.activityName : null,
        error: typeof entry.error === 'string' ? clamp(entry.error, FACT_VALUE_MAX) : null,
      })),
    )
  }
  const transitionEvents = input.events.filter(
    (event) => (event.eventType === 'TRANSITION_EXECUTED' || event.eventType === 'ACTIVITY_FAILED') && event.eventData,
  )
  const seenTransitionEvents = new Set<string>()
  for (const event of transitionEvents) {
    const data = event.eventData as Record<string, unknown>
    const transitionId = typeof data.transitionId === 'string' ? data.transitionId : null
    if (!transitionId) continue
    const transition = transitionsById.get(transitionId)
    if (!transition || transition.activities.length === 0) continue
    const occurredAt = toIso(event.occurredAt)
    const dedupeKey = `${transitionId}@${occurredAt}`
    if (seenTransitionEvents.has(dedupeKey)) continue
    if (event.eventType === 'TRANSITION_EXECUTED' && failedTransitions.has(transitionId)) continue
    seenTransitionEvents.add(dedupeKey)
    const failures = event.eventType === 'ACTIVITY_FAILED' ? failedTransitions.get(transitionId) ?? [] : []
    const occurredMs = occurredAt ? Date.parse(occurredAt) : baseMs
    const parentId = stepNodeFor(stepNodesByStepId, transition.fromStepId, occurredMs)
    transition.activities.forEach((activity, index) => {
      if (activity.functionName === EXECUTE_APPROVED_PROPOSAL_FUNCTION && effectorSpans.length > 0) return
      const failure = failures.find((entry) => entry.activityName === activity.activityName)
      drafts.push({
        id: `function:${event.id}:${index}`,
        kind: 'function',
        parentId,
        label: activity.functionName ?? activity.activityName,
        status: failure ? 'failed' : 'succeeded',
        startedAt: occurredAt,
        endedAt: occurredAt,
        durationMs: null,
        refs: { workflowStepId: transition.fromStepId },
        summary: {
          activityName: activity.activityName,
          activityType: activity.activityType,
          functionName: activity.functionName,
          transitionId,
          toStepId: transition.toStepId,
          ...(failure?.error ? { error: failure.error } : {}),
        },
        sortAt: occurredMs + index * 0.001,
      })
    })
  }

  const runNodeId = (runId: string) => `run:${runId}`
  const runIds = new Set(input.runs.map((run) => run.id))
  for (const run of input.runs) {
    const createdAt = toIso(run.createdAt)
    const createdMs = createdAt ? Date.parse(createdAt) : baseMs
    const parentId =
      run.parentRunId && runIds.has(run.parentRunId)
        ? runNodeId(run.parentRunId)
        : stepNodeFor(stepNodesByStepId, run.stepId, createdMs)
    drafts.push({
      id: runNodeId(run.id),
      kind: 'agent_run',
      parentId,
      label: run.agentId,
      status: mapRunStatus(run.status),
      startedAt: createdAt,
      endedAt: toIso(run.completedAt),
      durationMs: durationBetween(run.createdAt, run.completedAt, run.latencyMs),
      refs: { runId: run.id, ...(run.stepId ? { workflowStepId: run.stepId } : {}) },
      summary: {
        agentId: run.agentId,
        resultKind: run.resultKind,
        confidence: run.confidence,
        model: run.model,
        rerunOfRunId: run.rerunOfRunId,
        ...(run.errorMessage ? { error: clamp(run.errorMessage, FACT_VALUE_MAX) } : {}),
        outputFacts: flattenOutputFacts(run.output),
      },
      sortAt: createdMs,
    })
  }

  for (const call of input.toolCalls) {
    if (!runIds.has(call.agentRunId)) continue
    const createdAt = toIso(call.createdAt)
    const endedMs = createdAt ? Date.parse(createdAt) : null
    const startedMs = endedMs != null && typeof call.latencyMs === 'number' ? endedMs - call.latencyMs : endedMs
    drafts.push({
      id: `tool:${call.id}`,
      kind: 'tool_call',
      parentId: runNodeId(call.agentRunId),
      label: call.toolName,
      status: call.status === 'ok' ? 'succeeded' : 'failed',
      startedAt: startedMs != null ? new Date(startedMs).toISOString() : null,
      endedAt: createdAt,
      durationMs: call.latencyMs,
      refs: { runId: call.agentRunId, spanId: call.spanId, toolCallId: call.id },
      summary: {
        toolName: call.toolName,
        argKeys: summarizeToolArgs(call.requestSummary),
        resultBytes: resultSizeOf(call.responseSummary),
        ...(call.errorMessage ? { error: clamp(call.errorMessage, FACT_VALUE_MAX) } : {}),
      },
      sortAt: startedMs ?? baseMs,
    })
  }

  const correctionByProposal = new Map<string, FlowCorrectionInput>()
  for (const correction of input.corrections) {
    if (correction.action === 'edit') correctionByProposal.set(correction.proposalId, correction)
  }
  for (const proposal of input.proposals) {
    const createdAt = toIso(proposal.createdAt)
    const decidedAt = proposal.disposition === 'pending' ? null : toIso(proposal.updatedAt)
    const correction = correctionByProposal.get(proposal.id)
    const proposalSummary = summarizeProposal(proposal.payload, proposal.selectedOptionId)
    const dispositionBy = proposal.dispositionBy
    drafts.push({
      id: `disposition:${proposal.id}`,
      kind: 'disposition',
      parentId: runIds.has(proposal.runId)
        ? runNodeId(proposal.runId)
        : stepNodeFor(stepNodesByStepId, proposal.stepId, createdAt ? Date.parse(createdAt) : null),
      label: proposal.disposition,
      status: mapDispositionStatus(proposal.disposition),
      startedAt: createdAt,
      endedAt: decidedAt,
      durationMs: decidedAt ? durationBetween(createdAt, decidedAt) : null,
      refs: { proposalId: proposal.id, runId: proposal.runId },
      summary: {
        decision: proposal.disposition,
        actorKind: !dispositionBy ? null : dispositionBy.startsWith('rule:') ? 'rule' : 'user',
        actor: dispositionBy,
        reason: proposal.dispositionReason ? clamp(proposal.dispositionReason, EDIT_VALUE_MAX) : null,
        selectedOptionId: proposal.selectedOptionId,
        editedFields:
          proposal.disposition === 'edited' && correction
            ? diffEditedFields(correction.proposedValue, correction.correctedValue ?? proposal.payload, proposal.selectedOptionId)
            : [],
        proposal: proposalSummary,
      },
      sortAt: decidedAt ? Date.parse(decidedAt) : createdAt ? Date.parse(createdAt) : baseMs,
    })
  }

  for (const span of effectorSpans) {
    const proposalId = span.externalSpanId.slice(PROPOSAL_EXECUTION_SPAN_PREFIX.length)
    const attributes = isRecord(span.attributes) ? span.attributes : {}
    const results = Array.isArray(attributes.results) ? attributes.results.filter(isRecord) : []
    const state = typeof attributes.state === 'string' ? attributes.state : null
    const startedAtIso = toIso(span.startedAt)
    const commandResults = results.map((result) => ({
      type: typeof result.type === 'string' ? result.type : null,
      commandId: typeof result.commandId === 'string' ? result.commandId : null,
      status: typeof result.status === 'string' ? result.status : null,
      ...(typeof result.error === 'string' ? { error: clamp(result.error, FACT_VALUE_MAX) } : {}),
    }))
    const ok = typeof attributes.ok === 'boolean' ? attributes.ok : span.status === 'ok'
    drafts.push({
      id: `effector:${span.id}`,
      kind: 'effector',
      parentId: input.proposals.some((proposal) => proposal.id === proposalId) ? `disposition:${proposalId}` : null,
      label: span.name,
      status: state === 'running' ? 'running' : ok ? 'succeeded' : 'failed',
      startedAt: startedAtIso,
      endedAt: toIso(span.endedAt),
      durationMs: durationBetween(span.startedAt, span.endedAt, span.durationMs),
      refs: {
        proposalId,
        runId: span.agentRunId,
        spanId: span.id,
        ...(commandResults[0]?.commandId ? { commandId: commandResults[0].commandId } : {}),
      },
      summary: { ok, state, results: commandResults },
      sortAt: startedAtIso ? Date.parse(startedAtIso) : baseMs,
    })
  }

  const ordered = drafts.sort((left, right) => {
    if (left.sortAt !== right.sortAt) return left.sortAt - right.sortAt
    return KIND_ORDER[left.kind] - KIND_ORDER[right.kind]
  })
  const nodes: FlowNode[] = ordered.map((draft, index) => toFlowNode(draft, index + 1))

  return {
    execution: {
      id: execution.id,
      workflowInstanceId: execution.workflowInstanceId,
      processDefinitionId: execution.processDefinitionId,
      processKey: execution.workflowId,
      status: execution.status,
      subject: { type: execution.subjectType, id: execution.subjectId, label: execution.subjectLabel },
      startedAt,
      endedAt: toIso(execution.completedAt),
      rerunOfExecutionId: trigger.rerunOfExecutionId,
    },
    nodes,
  }
}
