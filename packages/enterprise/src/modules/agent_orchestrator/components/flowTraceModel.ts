/**
 * Client-safe helpers behind `ProcessFlowTrace` (spec §B/§C): the node tree, the
 * playback schedule, and the attempt compare. Pure — the wire types mirror
 * `lib/trace/flowAssembler.ts` without importing server code.
 */

export type FlowNodeKind = 'trigger' | 'step' | 'agent_run' | 'tool_call' | 'function' | 'disposition' | 'effector'
export type FlowNodeStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'skipped' | 'waiting'

export type FlowNodeView = {
  id: string
  seq: number
  kind: FlowNodeKind
  parentId: string | null
  label: string
  status: FlowNodeStatus
  startedAt: string | null
  endedAt: string | null
  durationMs: number | null
  refs: {
    workflowStepId?: string
    runId?: string
    spanId?: string
    toolCallId?: string
    proposalId?: string
    commandId?: string
  }
  summary: Record<string, unknown>
}

export type FlowExecutionView = {
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

export type FlowView = { execution: FlowExecutionView; nodes: FlowNodeView[] }

export type FlowTreeNode = FlowNodeView & { children: FlowTreeNode[] }

const TERMINAL_EXECUTION_STATUSES = new Set(['completed', 'auto_completed', 'failed', 'cancelled'])

export function isTerminalExecutionStatus(status: string | null | undefined): boolean {
  return !!status && TERMINAL_EXECUTION_STATUSES.has(status)
}

/** Nests nodes under their parent; a node whose parent is absent (or hidden) becomes a root. */
export function buildFlowTree(nodes: FlowNodeView[]): FlowTreeNode[] {
  const byId = new Map<string, FlowTreeNode>()
  const ordered = [...nodes].sort((left, right) => left.seq - right.seq)
  for (const node of ordered) byId.set(node.id, { ...node, children: [] })
  const roots: FlowTreeNode[] = []
  for (const node of ordered) {
    const tree = byId.get(node.id)
    if (!tree) continue
    const parent = node.parentId ? byId.get(node.parentId) : undefined
    if (parent) parent.children.push(tree)
    else roots.push(tree)
  }
  return roots
}

export type PlaybackOptions = { minDelayMs?: number; maxDelayMs?: number; speed?: number }

/**
 * Delay before revealing each node (index-aligned with seq order), derived from
 * the RECORDED timestamps and compressed into `[minDelayMs, maxDelayMs]` so a
 * pause of an hour plays in a beat while the order stays exactly as recorded.
 */
export function playbackDelays(nodes: FlowNodeView[], options: PlaybackOptions = {}): number[] {
  const minDelay = options.minDelayMs ?? 250
  const maxDelay = options.maxDelayMs ?? 1500
  const speed = options.speed && options.speed > 0 ? options.speed : 1
  const ordered = [...nodes].sort((left, right) => left.seq - right.seq)
  let previous: number | null = null
  return ordered.map((node) => {
    const at = node.startedAt ? Date.parse(node.startedAt) : null
    const gap = at != null && previous != null ? Math.max(0, at - previous) : 0
    if (at != null) previous = at
    const scaled = Math.min(maxDelay, Math.max(minDelay, Math.sqrt(gap) * 10))
    return Math.round(scaled / speed)
  })
}

export function nodesVisibleAt(nodes: FlowNodeView[], revealedCount: number): FlowNodeView[] {
  return nodes.filter((node) => node.seq <= revealedCount)
}

type Fact = string | number | boolean | null

export type FactDiff = { path: string; left: Fact | undefined; right: Fact | undefined }

export type AgentOutputCompare = {
  agentId: string
  leftRunId: string | null
  rightRunId: string | null
  diffs: FactDiff[]
}

export type ProposalCompareSide = {
  actionTypes: string[]
  citations: Array<{ kind: string; ref: string; label: string | null }>
  checks: Array<{ key: string; passed: boolean; step: string | null }>
  decision: string | null
}

export type FlowCompare = {
  route: { left: string[]; right: string[] }
  agents: AgentOutputCompare[]
  proposals: { left: ProposalCompareSide | null; right: ProposalCompareSide | null }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readFacts(node: FlowNodeView | undefined): Record<string, Fact> {
  const facts = node?.summary.outputFacts
  return isRecord(facts) ? (facts as Record<string, Fact>) : {}
}

function lastBy<T>(items: T[], key: (item: T) => string): Map<string, T> {
  const map = new Map<string, T>()
  for (const item of items) map.set(key(item), item)
  return map
}

function proposalSide(nodes: FlowNodeView[]): ProposalCompareSide | null {
  const dispositions = nodes.filter((node) => node.kind === 'disposition')
  const last = dispositions[dispositions.length - 1]
  if (!last) return null
  const proposal = isRecord(last.summary.proposal) ? last.summary.proposal : {}
  const actionTypes = Array.isArray(proposal.actionTypes) ? proposal.actionTypes.filter((entry): entry is string => typeof entry === 'string') : []
  const citations = (Array.isArray(proposal.citations) ? proposal.citations : []).filter(isRecord).map((entry) => ({
    kind: String(entry.kind ?? ''),
    ref: String(entry.ref ?? ''),
    label: typeof entry.label === 'string' ? entry.label : null,
  }))
  const checks = (Array.isArray(proposal.checks) ? proposal.checks : []).filter(isRecord).map((entry) => ({
    key: String(entry.key ?? ''),
    passed: entry.passed === true,
    step: typeof entry.step === 'string' ? entry.step : null,
  }))
  return { actionTypes, citations, checks, decision: typeof last.summary.decision === 'string' ? last.summary.decision : null }
}

/** Side-by-side compare of two attempts: the step route taken, each agent's output facts, and the proposal. */
export function compareFlows(left: FlowView, right: FlowView): FlowCompare {
  const route = (flow: FlowView) => flow.nodes.filter((node) => node.kind === 'step').map((node) => node.label)
  const leftRuns = lastBy(left.nodes.filter((node) => node.kind === 'agent_run'), (node) => node.label)
  const rightRuns = lastBy(right.nodes.filter((node) => node.kind === 'agent_run'), (node) => node.label)
  const agentIds = Array.from(new Set([...leftRuns.keys(), ...rightRuns.keys()]))
  const agents = agentIds.map((agentId) => {
    const leftNode = leftRuns.get(agentId)
    const rightNode = rightRuns.get(agentId)
    const leftFacts = readFacts(leftNode)
    const rightFacts = readFacts(rightNode)
    const paths = Array.from(new Set([...Object.keys(leftFacts), ...Object.keys(rightFacts)])).sort()
    const diffs = paths
      .filter((path) => JSON.stringify(leftFacts[path]) !== JSON.stringify(rightFacts[path]))
      .map((path) => ({ path, left: leftFacts[path], right: rightFacts[path] }))
    return { agentId, leftRunId: leftNode?.refs.runId ?? null, rightRunId: rightNode?.refs.runId ?? null, diffs }
  })
  return {
    route: { left: route(left), right: route(right) },
    agents,
    proposals: { left: proposalSide(left.nodes), right: proposalSide(right.nodes) },
  }
}
