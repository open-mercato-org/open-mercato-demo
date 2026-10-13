"use client"

import * as React from 'react'
import Link from 'next/link'
import {
  Bot,
  Braces,
  Circle,
  CircleCheck,
  CircleMinus,
  CircleX,
  Clock,
  ExternalLink,
  GitCompare,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  RotateCcw,
  Send,
  StepForward,
  UserCheck,
  Workflow,
  Wrench,
  Zap,
} from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { SegmentedControl, SegmentedControlItem } from '@open-mercato/ui/primitives/segmented-control'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { apiCall, apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { formatDurationMs } from './types'
import { useCoalescedReload } from './useCoalescedReload'
import {
  buildFlowTree,
  compareFlows,
  isTerminalExecutionStatus,
  nodesVisibleAt,
  playbackDelays,
  type FlowNodeKind,
  type FlowNodeStatus,
  type FlowTreeNode,
  type FlowView,
} from './flowTraceModel'

/**
 * End-to-end flow of one process execution (spec
 * `2026-10-12-process-flow-trace-replay-and-embeddable-decision-card.md` §B/§C):
 * trigger → workflow steps → agent runs and their tool calls → dispositions →
 * effector results, grouped by step, each node deep-linking to the per-run trace.
 *
 * Deep import: `@open-mercato/enterprise/modules/agent_orchestrator/components/ProcessFlowTrace`.
 *
 * Modes: `live` refetches on run / proposal / workflow events while the execution
 * is running; `playback` steps through the RECORDED flow client-side (no LLM call,
 * deterministic); `compare` puts two attempts side by side. `allowRerun` adds the
 * AO re-run action (`POST /executions/:id/rerun`, supersede on a pending proposal).
 */

export type ProcessFlowTraceProps = {
  executionId: string
  /** Execution ids of every attempt of the same business case (any order); enables the selector and compare. */
  attempts?: string[]
  showAttemptSelector?: boolean
  /** Shows the generic AO re-run action. Hosts with their own re-run endpoint leave it off. */
  allowRerun?: boolean
  onRerunStarted?: (result: { executionId: string; rerunOfExecutionId: string }) => void
  /** Called when the viewer switches attempt in the selector. */
  onAttemptChange?: (executionId: string) => void
  defaultMode?: 'live' | 'playback'
  className?: string
}

type Mode = 'live' | 'playback' | 'compare'

const SPEEDS = ['0.5', '1', '2', '4'] as const

const KIND_ICON: Record<FlowNodeKind, React.ComponentType<{ className?: string }>> = {
  trigger: Zap,
  step: Workflow,
  agent_run: Bot,
  tool_call: Wrench,
  function: Braces,
  disposition: UserCheck,
  effector: Send,
}

function StatusIcon({ status, label }: { status: FlowNodeStatus; label: string }) {
  switch (status) {
    case 'succeeded':
      return <CircleCheck className="size-4 shrink-0 text-status-success-icon" aria-label={label} />
    case 'failed':
      return <CircleX className="size-4 shrink-0 text-status-error-icon" aria-label={label} />
    case 'running':
      return <Loader2 className="size-4 shrink-0 animate-spin text-status-info-icon" aria-label={label} />
    case 'waiting':
      return <Clock className="size-4 shrink-0 text-status-warning-icon" aria-label={label} />
    case 'skipped':
      return <CircleMinus className="size-4 shrink-0 text-muted-foreground" aria-label={label} />
    default:
      return <Circle className="size-4 shrink-0 text-muted-foreground" aria-label={label} />
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function asText(value: unknown): string {
  if (value === null || value === undefined) return '—'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}

async function fetchFlow(executionId: string): Promise<FlowView | null> {
  const call = await apiCall<FlowView>(`/api/agent_orchestrator/executions/${encodeURIComponent(executionId)}/flow`)
  if (!call.ok || !call.result || !Array.isArray(call.result.nodes)) return null
  return call.result
}

function NodeSummary({ node }: { node: FlowTreeNode }) {
  const t = useT()
  const summary = node.summary
  if (node.kind === 'tool_call') {
    const argKeys = Array.isArray(summary.argKeys) ? summary.argKeys.map(String) : []
    return (
      <p className="text-xs text-muted-foreground">
        {t('agent_orchestrator.flow.tool.summary', undefined, {
          args: argKeys.length > 0 ? argKeys.join(', ') : '—',
          bytes: typeof summary.resultBytes === 'number' ? summary.resultBytes : 0,
        })}
      </p>
    )
  }
  if (node.kind === 'disposition') {
    const edited = Array.isArray(summary.editedFields) ? summary.editedFields.filter(isRecord) : []
    const actorKind = typeof summary.actorKind === 'string' ? summary.actorKind : null
    return (
      <div className="space-y-1 text-xs text-muted-foreground">
        <p>
          {t(`agent_orchestrator.disposition.${String(summary.decision ?? node.label)}`, String(summary.decision ?? node.label))}
          {actorKind ? ` · ${t(actorKind === 'rule' ? 'agent_orchestrator.flow.disposition.byRule' : 'agent_orchestrator.flow.disposition.byUser')}` : ''}
        </p>
        {typeof summary.reason === 'string' && summary.reason ? <p className="text-foreground">{summary.reason}</p> : null}
        {edited.length > 0 ? (
          <ul className="space-y-0.5" aria-label={t('agent_orchestrator.flow.disposition.editedFields')}>
            {edited.map((entry, index) => (
              <li key={`${entry.action}-${entry.field}-${index}`} className="font-mono">
                {String(entry.field)}: <span className="line-through">{asText(entry.before)}</span> → {asText(entry.after)}
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    )
  }
  if (node.kind === 'effector') {
    const results = Array.isArray(summary.results) ? summary.results.filter(isRecord) : []
    return (
      <ul className="space-y-0.5 text-xs text-muted-foreground">
        {results.map((result, index) => (
          <li key={`${result.commandId}-${index}`} className="font-mono">
            {asText(result.commandId)} · {asText(result.status)}
            {typeof result.error === 'string' ? ` · ${result.error}` : ''}
          </li>
        ))}
      </ul>
    )
  }
  if (node.kind === 'agent_run') {
    const parts = [summary.resultKind, typeof summary.confidence === 'number' ? summary.confidence.toFixed(2) : null, summary.model]
      .filter((part) => typeof part === 'string' && part.length > 0)
      .map(String)
    return (
      <div className="text-xs text-muted-foreground">
        {parts.length > 0 ? <p>{parts.join(' · ')}</p> : null}
        {typeof summary.error === 'string' ? <p className="text-status-error-text">{summary.error}</p> : null}
      </div>
    )
  }
  if (node.kind === 'step' && typeof summary.routedOutcome === 'string') {
    return (
      <p className="text-xs text-muted-foreground">
        {t('agent_orchestrator.flow.step.routed', undefined, {
          outcome: summary.routedOutcome,
          to: typeof summary.routedTo === 'string' ? summary.routedTo : '—',
        })}
      </p>
    )
  }
  if (node.kind === 'function' && typeof summary.error === 'string') {
    return <p className="text-xs text-status-error-text">{summary.error}</p>
  }
  if (node.kind === 'trigger') {
    return (
      <p className="text-xs text-muted-foreground">
        {typeof summary.rerunOfExecutionId === 'string'
          ? t('agent_orchestrator.flow.trigger.rerunOf', undefined, { id: summary.rerunOfExecutionId.slice(0, 8) })
          : t('agent_orchestrator.flow.trigger.kind', undefined, { kind: String(summary.triggerKind ?? '—') })}
      </p>
    )
  }
  return null
}

function FlowNodeRow({ node }: { node: FlowTreeNode }) {
  const t = useT()
  const KindIcon = KIND_ICON[node.kind]
  const statusLabel = t(`agent_orchestrator.flow.status.${node.status}`)
  const duration = formatDurationMs(node.durationMs)
  return (
    <li data-flow-node={node.id} data-flow-kind={node.kind} data-flow-status={node.status}>
      <div className="flex items-start gap-2 rounded-md px-2 py-1.5 hover:bg-muted/40">
        <StatusIcon status={node.status} label={statusLabel} />
        <KindIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <span className="truncate text-sm font-medium text-foreground">{node.label}</span>
            <span className="text-xs text-muted-foreground">{t(`agent_orchestrator.flow.kind.${node.kind}`)}</span>
            {duration ? <span className="text-xs tabular-nums text-muted-foreground">{duration}</span> : null}
          </div>
          <NodeSummary node={node} />
        </div>
        {node.refs.runId && (node.kind === 'agent_run' || node.kind === 'tool_call') ? (
          <IconButton asChild variant="ghost" size="sm" aria-label={t('agent_orchestrator.flow.openRunTrace')}>
            <Link href={`/backend/traces/${encodeURIComponent(node.refs.runId)}`}>
              <ExternalLink className="size-3.5" />
            </Link>
          </IconButton>
        ) : null}
      </div>
      {node.children.length > 0 ? (
        <ul className="ml-4 border-l border-border pl-2">
          {node.children.map((child) => (
            <FlowNodeRow key={child.id} node={child} />
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function FlowTimeline({ flow, revealed }: { flow: FlowView; revealed?: number }) {
  const t = useT()
  const nodes = revealed === undefined ? flow.nodes : nodesVisibleAt(flow.nodes, revealed)
  const tree = React.useMemo(() => buildFlowTree(nodes), [nodes])
  if (tree.length === 0) return <p className="text-sm text-muted-foreground">{t('agent_orchestrator.flow.empty')}</p>
  return (
    <ul className="space-y-0.5" aria-label={t('agent_orchestrator.flow.title')}>
      {tree.map((node) => (
        <FlowNodeRow key={node.id} node={node} />
      ))}
    </ul>
  )
}

function CompareColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 space-y-2 rounded-lg border border-border p-3">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{title}</p>
      {children}
    </div>
  )
}

function FlowCompareView({ left, right, leftLabel, rightLabel }: { left: FlowView; right: FlowView; leftLabel: string; rightLabel: string }) {
  const t = useT()
  const compare = React.useMemo(() => compareFlows(left, right), [left, right])
  const sides = [
    { label: leftLabel, route: compare.route.left, proposal: compare.proposals.left },
    { label: rightLabel, route: compare.route.right, proposal: compare.proposals.right },
  ]
  return (
    <div className="space-y-4" data-testid="ao-flow-compare">
      <section className="space-y-2">
        <p className="text-sm font-semibold text-foreground">{t('agent_orchestrator.flow.compare.route')}</p>
        <div className="grid gap-3 md:grid-cols-2">
          {sides.map((side) => (
            <CompareColumn key={side.label} title={side.label}>
              <p className="text-sm text-foreground">{side.route.length > 0 ? side.route.join(' → ') : '—'}</p>
            </CompareColumn>
          ))}
        </div>
      </section>
      <section className="space-y-2">
        <p className="text-sm font-semibold text-foreground">{t('agent_orchestrator.flow.compare.proposal')}</p>
        <div className="grid gap-3 md:grid-cols-2">
          {sides.map((side) => (
            <CompareColumn key={side.label} title={side.label}>
              {side.proposal ? (
                <div className="space-y-2 text-sm">
                  <p className="text-foreground">
                    {side.proposal.actionTypes.length > 0 ? side.proposal.actionTypes.join(', ') : t('agent_orchestrator.flow.compare.noActions')}
                  </p>
                  {side.proposal.citations.length > 0 ? (
                    <ul className="space-y-0.5">
                      {side.proposal.citations.map((citation) => (
                        <li key={citation.ref} className="font-mono text-xs text-muted-foreground">
                          {citation.label ?? citation.ref}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {side.proposal.checks.length > 0 ? (
                    <ul className="space-y-0.5">
                      {side.proposal.checks.map((check) => (
                        <li key={check.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          {check.passed ? (
                            <CircleCheck className="size-3.5 text-status-success-icon" aria-label={t('agent_orchestrator.decisionCard.citations.passed')} />
                          ) : (
                            <CircleX className="size-3.5 text-status-error-icon" aria-label={t('agent_orchestrator.decisionCard.citations.failed')} />
                          )}
                          {check.key}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">{t('agent_orchestrator.flow.compare.noProposal')}</p>
              )}
            </CompareColumn>
          ))}
        </div>
      </section>
      <section className="space-y-2">
        <p className="text-sm font-semibold text-foreground">{t('agent_orchestrator.flow.compare.agents')}</p>
        {compare.agents.map((agent) => (
          <div key={agent.agentId} className="space-y-1 rounded-lg border border-border p-3" data-compare-agent={agent.agentId}>
            <p className="text-sm font-medium text-foreground">{agent.agentId}</p>
            {agent.diffs.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('agent_orchestrator.flow.compare.noDiff')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-muted-foreground">
                      <th className="py-1 pr-3 font-medium">{t('agent_orchestrator.flow.compare.path')}</th>
                      <th className="py-1 pr-3 font-medium">{leftLabel}</th>
                      <th className="py-1 font-medium">{rightLabel}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {agent.diffs.map((diff) => (
                      <tr key={diff.path} className="border-t border-border align-top">
                        <td className="py-1 pr-3 font-mono text-muted-foreground">{diff.path}</td>
                        <td className="py-1 pr-3 text-foreground">{asText(diff.left)}</td>
                        <td className="py-1 text-foreground">{asText(diff.right)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </section>
    </div>
  )
}

export function ProcessFlowTrace({
  executionId,
  attempts,
  showAttemptSelector = false,
  allowRerun = false,
  onRerunStarted,
  onAttemptChange,
  defaultMode = 'live',
  className,
}: ProcessFlowTraceProps) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const attemptIds = React.useMemo(() => {
    const ids = [...(attempts ?? [])]
    if (!ids.includes(executionId)) ids.push(executionId)
    return ids
  }, [attempts, executionId])
  const [activeId, setActiveId] = React.useState(executionId)
  const [mode, setMode] = React.useState<Mode>(defaultMode)
  const [flow, setFlow] = React.useState<FlowView | null>(null)
  const [state, setState] = React.useState<'loading' | 'ready' | 'error'>('loading')
  const [compareId, setCompareId] = React.useState<string | null>(null)
  const [compareFlow, setCompareFlow] = React.useState<FlowView | null>(null)
  const [revealed, setRevealed] = React.useState(0)
  const [playing, setPlaying] = React.useState(false)
  const [speed, setSpeed] = React.useState<(typeof SPEEDS)[number]>('1')
  const [rerunBusy, setRerunBusy] = React.useState(false)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    executionId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: `agent_orchestrator.process-flow-trace:${executionId}`,
    blockedMessage: t('agent_orchestrator.flow.rerun.blocked'),
  })

  React.useEffect(() => {
    setActiveId(executionId)
  }, [executionId])

  const load = React.useCallback(async () => {
    const next = await fetchFlow(activeId)
    if (next) {
      setFlow(next)
      setState('ready')
    } else {
      setState((current) => (current === 'ready' ? current : 'error'))
    }
  }, [activeId])

  React.useEffect(() => {
    setState('loading')
    setFlow(null)
    void load()
  }, [load])

  const running = !!flow && !isTerminalExecutionStatus(flow.execution.status)
  const coalescedReload = useCoalescedReload(() => void load(), { minIntervalMs: 2000 })
  const onLiveEvent = React.useCallback(() => {
    if (mode === 'live' && running) coalescedReload()
  }, [mode, running, coalescedReload])
  useAppEvent('agent_orchestrator.*', onLiveEvent, [onLiveEvent])
  useAppEvent('workflows.instance.*', onLiveEvent, [onLiveEvent])

  const delays = React.useMemo(
    () => (flow ? playbackDelays(flow.nodes, { speed: Number(speed) }) : []),
    [flow, speed],
  )
  const total = flow?.nodes.length ?? 0

  React.useEffect(() => {
    if (mode !== 'playback' || !playing) return
    if (revealed >= total) {
      setPlaying(false)
      return
    }
    const timer = setTimeout(() => setRevealed((value) => Math.min(total, value + 1)), delays[revealed] ?? 500)
    return () => clearTimeout(timer)
  }, [mode, playing, revealed, total, delays])

  const changeMode = React.useCallback(
    (next: string) => {
      const value = next as Mode
      setMode(value)
      setPlaying(false)
      if (value === 'playback') setRevealed(0)
      if (value === 'compare' && !compareId) {
        const other = attemptIds.find((id) => id !== activeId) ?? null
        setCompareId(other)
      }
    },
    [attemptIds, activeId, compareId],
  )

  React.useEffect(() => {
    if (mode !== 'compare' || !compareId) {
      setCompareFlow(null)
      return
    }
    let cancelled = false
    void fetchFlow(compareId).then((result) => {
      if (!cancelled) setCompareFlow(result)
    })
    return () => {
      cancelled = true
    }
  }, [mode, compareId])

  const attemptLabel = React.useCallback(
    (id: string) => t('agent_orchestrator.flow.attempt', undefined, { index: attemptIds.indexOf(id) + 1 }),
    [attemptIds, t],
  )

  const postRerun = React.useCallback(
    (supersede: boolean) =>
      runMutation({
        operation: () =>
          apiCallOrThrow<{ executionId: string; rerunOfExecutionId: string }>(
            `/api/agent_orchestrator/executions/${encodeURIComponent(activeId)}/rerun`,
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ supersede }),
            },
          ),
        context: { executionId: activeId, retryLastMutation },
        mutationPayload: { supersede },
      }),
    [activeId, runMutation, retryLastMutation],
  )

  const rerun = React.useCallback(async () => {
    setRerunBusy(true)
    try {
      let response
      try {
        response = await postRerun(false)
      } catch (err) {
        const details = err as { status?: number; code?: string }
        if (details?.status !== 409 || details.code !== 'pending_proposal') throw err
        const confirmed = await confirm({
          title: t('agent_orchestrator.flow.rerun.supersedeTitle'),
          text: t('agent_orchestrator.flow.rerun.supersedeText'),
          confirmText: t('agent_orchestrator.flow.rerun.supersedeConfirm'),
          variant: 'destructive',
        })
        if (!confirmed) return
        response = await postRerun(true)
      }
      const result = response.result
      if (result?.executionId) {
        flash(t('agent_orchestrator.flow.rerun.started'), 'success')
        onRerunStarted?.({ executionId: result.executionId, rerunOfExecutionId: result.rerunOfExecutionId })
      }
    } catch (err) {
      flash(err instanceof Error ? err.message : t('agent_orchestrator.flow.rerun.error'), 'error')
    } finally {
      setRerunBusy(false)
    }
  }, [postRerun, confirm, onRerunStarted, t])

  return (
    <section className={`space-y-4 ${className ?? ''}`} data-testid="ao-process-flow-trace" data-execution-id={activeId}>
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-auto text-sm font-semibold text-foreground">{t('agent_orchestrator.flow.title')}</h2>
        {showAttemptSelector && attemptIds.length > 1 ? (
          <Select
            value={activeId}
            onValueChange={(value) => {
              setActiveId(value)
              onAttemptChange?.(value)
            }}
          >
            <SelectTrigger className="w-40" aria-label={t('agent_orchestrator.flow.attemptSelector')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {attemptIds.map((id) => (
                <SelectItem key={id} value={id}>
                  {attemptLabel(id)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
        <SegmentedControl value={mode} onValueChange={changeMode} aria-label={t('agent_orchestrator.flow.mode')}>
          <SegmentedControlItem value="live">{t('agent_orchestrator.flow.modes.live')}</SegmentedControlItem>
          <SegmentedControlItem value="playback">{t('agent_orchestrator.flow.modes.playback')}</SegmentedControlItem>
          {attemptIds.length > 1 ? (
            <SegmentedControlItem value="compare">
              <GitCompare className="mr-1 size-3.5" aria-hidden="true" />
              {t('agent_orchestrator.flow.modes.compare')}
            </SegmentedControlItem>
          ) : null}
        </SegmentedControl>
        {allowRerun ? (
          <Button type="button" variant="outline" onClick={() => void rerun()} disabled={rerunBusy || !flow}>
            <RefreshCw className="mr-1.5 size-4" aria-hidden="true" />
            {t('agent_orchestrator.flow.rerun.action')}
          </Button>
        ) : null}
      </div>

      {mode === 'playback' && flow ? (
        <div className="flex flex-wrap items-center gap-2" data-testid="ao-flow-playback">
          <IconButton
            type="button"
            variant="outline"
            aria-label={t(playing ? 'agent_orchestrator.flow.playback.pause' : 'agent_orchestrator.flow.playback.play')}
            onClick={() => {
              if (revealed >= total) setRevealed(0)
              setPlaying((value) => !value)
            }}
          >
            {playing ? <Pause className="size-4" /> : <Play className="size-4" />}
          </IconButton>
          <IconButton
            type="button"
            variant="outline"
            aria-label={t('agent_orchestrator.flow.playback.step')}
            onClick={() => {
              setPlaying(false)
              setRevealed((value) => Math.min(total, value + 1))
            }}
            disabled={revealed >= total}
          >
            <StepForward className="size-4" />
          </IconButton>
          <IconButton
            type="button"
            variant="outline"
            aria-label={t('agent_orchestrator.flow.playback.restart')}
            onClick={() => {
              setPlaying(false)
              setRevealed(0)
            }}
          >
            <RotateCcw className="size-4" />
          </IconButton>
          <SegmentedControl
            value={speed}
            onValueChange={(value) => setSpeed(value as (typeof SPEEDS)[number])}
            size="sm"
            aria-label={t('agent_orchestrator.flow.playback.speed')}
          >
            {SPEEDS.map((value) => (
              <SegmentedControlItem key={value} value={value}>
                {`${value}×`}
              </SegmentedControlItem>
            ))}
          </SegmentedControl>
          <span className="text-xs tabular-nums text-muted-foreground">
            {t('agent_orchestrator.flow.playback.progress', undefined, { shown: revealed, total })}
          </span>
        </div>
      ) : null}

      {mode === 'compare' && attemptIds.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">{t('agent_orchestrator.flow.compare.with')}</span>
          <Select value={compareId ?? undefined} onValueChange={setCompareId}>
            <SelectTrigger className="w-40" aria-label={t('agent_orchestrator.flow.compare.with')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {attemptIds
                .filter((id) => id !== activeId)
                .map((id) => (
                  <SelectItem key={id} value={id}>
                    {attemptLabel(id)}
                  </SelectItem>
                ))}
            </SelectContent>
          </Select>
        </div>
      ) : null}

      {state === 'loading' ? (
        <LoadingMessage label={t('agent_orchestrator.flow.loading')} />
      ) : state === 'error' || !flow ? (
        <ErrorMessage label={t('agent_orchestrator.flow.error')} />
      ) : mode === 'compare' ? (
        compareFlow ? (
          <FlowCompareView
            left={compareFlow}
            right={flow}
            leftLabel={compareId ? attemptLabel(compareId) : ''}
            rightLabel={attemptLabel(activeId)}
          />
        ) : (
          <LoadingMessage label={t('agent_orchestrator.flow.loading')} />
        )
      ) : (
        <FlowTimeline flow={flow} revealed={mode === 'playback' ? revealed : undefined} />
      )}
      {ConfirmDialogElement}
    </section>
  )
}

export default ProcessFlowTrace
