"use client"

import * as React from 'react'
import { Check, Eye, EyeOff, Info, Pencil, TriangleAlert, X } from 'lucide-react'
import { Button } from '@open-mercato/ui/primitives/button'
import { IconButton } from '@open-mercato/ui/primitives/icon-button'
import { Input } from '@open-mercato/ui/primitives/input'
import { Switch } from '@open-mercato/ui/primitives/switch'
import { Textarea } from '@open-mercato/ui/primitives/textarea'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { Alert } from '@open-mercato/ui/primitives/alert'
import { KbdShortcut } from '@open-mercato/ui/primitives/kbd'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { LoadingMessage, ErrorMessage } from '@open-mercato/ui/backend/detail'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import {
  apiCall,
  apiCallOrThrow,
  readApiResultOrThrow,
  withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { normalizeProposalEnvelope, rankProposalOptions, readProposalEvidence } from '../data/proposalEnvelope'
import { ProposalOptionList } from './ProposalOptionList'
import { ProposalCitationsPanel } from './ProposalCitationsPanel'
import { DisposeDialog } from './DisposeDialog'
import { FactsGrid } from './ProposalFacts'
import { OPTIONAL_REQUEST_INIT } from './optionalRequest'
import { proposalCaseStatusLabelKey, proposalCaseStatusVariant } from './proposalCaseStatus'
import { humanizeKey } from './proposalFactsData'
import { formatConfidence, mapAgent, mapProposal, mapRun, type AgentFactView, type ProposalView, type RunView } from './types'
import { actionEditsToActions, deriveActionEdits, reassembleProposalPayload, type ActionEdit, type EditableActionField } from './proposalEdit'
import {
  buildDisposeBody,
  collectLongTextFields,
  countChangedFields,
  highlightTemplateSegments,
  isEditableWidget,
  maskValue,
  resolveFieldOverride,
  type DecisionFieldOverride,
  type DecisionFieldOverrides,
  type DisposeVerdict,
} from './decisionCardModel'

/**
 * The Caseload decision UI as an embeddable component (spec
 * `2026-10-12-process-flow-trace-replay-and-embeddable-decision-card.md` §A).
 *
 * Deep import: `@open-mercato/enterprise/modules/agent_orchestrator/components/ProposalDecisionCard`.
 *
 * It loads one proposal by id and renders its option set, the selected option's
 * action fields (long text, money, read-only and masked editors), the "Based on"
 * citations panel and the approve / edit / reject verdicts. A verdict goes through
 * the same dispose endpoint as the Caseload — optimistic-locked on `updatedAt`,
 * conflicts surfaced on the shared conflict bar — and an edit sends the FULL
 * re-assembled envelope. Without `agent_orchestrator.proposals.dispose` the card is
 * read-only.
 */

export type ProposalDecisionCardDisposeResult = {
  proposalId: string
  disposition: string
  selectedOptionId: string | null
  updatedAt: string | null
}

export type ProposalDecisionCardProps = {
  proposalId: string
  /** Hides the facts grid and the rationale, for narrow host slots. */
  compact?: boolean
  onDisposed?: (result: ProposalDecisionCardDisposeResult) => void
  /** Per-field editors keyed `<actionType>.<field>` (or `*.<field>`). */
  fieldOverrides?: DecisionFieldOverrides
  /** Overrides the feature check; omit to derive it from `agent_orchestrator.proposals.dispose`. */
  canDispose?: boolean
  /** Host copy for the approve button (e.g. "Approve & send"); defaults to the Caseload label. */
  approveLabel?: string
  /** Bumping this value reloads the proposal (e.g. after a host-side event). */
  reloadToken?: number
  className?: string
}

type LoadState = 'loading' | 'ready' | 'notFound' | 'error'

type DisposeResponse = {
  proposalId?: string
  disposition?: string
  selectedOptionId?: string | null
  updatedAt?: string
}

function resolveInitialOption(proposal: ProposalView): string | null {
  if (proposal.selectedOptionId) return proposal.selectedOptionId
  const options = rankProposalOptions(normalizeProposalEnvelope(proposal.payload).options)
  return options.length === 1 ? options[0].id : null
}

function formatMoney(value: string | number | boolean, locale: string | undefined): string {
  const amount = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(amount)) return String(value)
  return new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount)
}

export function ProposalDecisionCard({
  proposalId,
  compact = false,
  onDisposed,
  fieldOverrides,
  canDispose: canDisposeProp,
  approveLabel,
  reloadToken = 0,
  className,
}: ProposalDecisionCardProps) {
  const t = useT()
  const [state, setState] = React.useState<LoadState>('loading')
  const [proposal, setProposal] = React.useState<ProposalView | null>(null)
  const [run, setRun] = React.useState<RunView | null>(null)
  const [agentLabel, setAgentLabel] = React.useState<string | null>(null)
  const [agentFacts, setAgentFacts] = React.useState<AgentFactView[] | undefined>(undefined)
  const [schemaLongText, setSchemaLongText] = React.useState<Set<string>>(() => new Set())
  const [featureCanDispose, setFeatureCanDispose] = React.useState(false)
  const [selectedOptionId, setSelectedOptionId] = React.useState<string | null>(null)
  const [mode, setMode] = React.useState<'view' | 'edit'>('view')
  const [edits, setEdits] = React.useState<ActionEdit[] | null>(null)
  const [originalEdits, setOriginalEdits] = React.useState<ActionEdit[] | null>(null)
  const [dialog, setDialog] = React.useState<'edit' | 'reject' | null>(null)
  const [reason, setReason] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [localError, setLocalError] = React.useState<string | null>(null)
  const [revealed, setRevealed] = React.useState<Set<string>>(() => new Set())
  const [internalReload, setInternalReload] = React.useState(0)

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    proposalId: string
    data: ProposalView | null
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: `agent_orchestrator.proposal-decision-card:${proposalId}`,
    blockedMessage: t('agent_orchestrator.proposal.flash.blocked'),
  })

  React.useEffect(() => {
    if (canDisposeProp !== undefined) return
    let cancelled = false
    void apiCall<{ ok?: boolean; granted?: string[] }>(
      '/api/auth/feature-check',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ features: ['agent_orchestrator.proposals.dispose'] }),
      },
      { fallback: { ok: false, granted: [] } },
    ).then((response) => {
      if (!cancelled) setFeatureCanDispose(response.ok && response.result?.ok === true)
    })
    return () => {
      cancelled = true
    }
  }, [canDisposeProp])

  React.useEffect(() => {
    let cancelled = false
    async function load() {
      setState((current) => (current === 'ready' ? current : 'loading'))
      try {
        const data = await readApiResultOrThrow<{ items?: Array<Record<string, unknown>> }>(
          `/api/agent_orchestrator/proposals?id=${encodeURIComponent(proposalId)}`,
        )
        if (cancelled) return
        const mapped = Array.isArray(data.items) && data.items[0] ? mapProposal(data.items[0]) : null
        if (!mapped) {
          setState('notFound')
          return
        }
        setProposal(mapped)
        setSelectedOptionId(resolveInitialOption(mapped))
        setMode('view')
        setEdits(null)
        setState('ready')
        const [agentsCall, runCall] = await Promise.all([
          apiCall<{ items?: Array<Record<string, unknown>> }>('/api/agent_orchestrator/agents', OPTIONAL_REQUEST_INIT, {
            fallback: { items: [] },
          }),
          apiCall<{ items?: Array<Record<string, unknown>> }>(
            `/api/agent_orchestrator/runs?id=${encodeURIComponent(mapped.runId)}`,
            OPTIONAL_REQUEST_INIT,
            { fallback: { items: [] } },
          ),
        ])
        if (cancelled) return
        const agentRow = (agentsCall.result?.items ?? []).find((item) => item.id === mapped.agentId) ?? null
        const agent = agentRow ? mapAgent(agentRow) : null
        setAgentLabel(agent?.label ?? null)
        setAgentFacts(agent?.facts)
        setSchemaLongText(collectLongTextFields(agentRow?.outcomeSchema))
        const runRow = runCall.result?.items?.[0]
        setRun(runRow ? mapRun(runRow) : null)
      } catch {
        if (!cancelled) setState('error')
      }
    }
    if (proposalId) void load()
    else setState('notFound')
    return () => {
      cancelled = true
    }
  }, [proposalId, reloadToken, internalReload])

  const payload = proposal?.payload ?? null
  const evidence = React.useMemo(() => readProposalEvidence(payload), [payload])
  const options = React.useMemo(() => rankProposalOptions(normalizeProposalEnvelope(payload).options), [payload])
  const selectedOption = options.find((option) => option.id === selectedOptionId) ?? null
  const isPending = (proposal?.disposition ?? 'pending') === 'pending'
  const canDispose = canDisposeProp ?? featureCanDispose
  const interactive = isPending && canDispose
  const viewEdits = React.useMemo(
    () => (selectedOptionId ? deriveActionEdits(payload, selectedOptionId) : null),
    [payload, selectedOptionId],
  )
  const shownEdits = mode === 'edit' && edits ? edits : viewEdits
  const citedRefs = React.useMemo(
    () => (selectedOption ? selectedOption.actions.flatMap((action) => action.citations ?? []) : []),
    [selectedOption],
  )

  const overrideFor = React.useCallback(
    (actionType: string, field: string): DecisionFieldOverride | null =>
      resolveFieldOverride(actionType, field, fieldOverrides, schemaLongText),
    [fieldOverrides, schemaLongText],
  )

  const startEdit = React.useCallback(() => {
    if (!viewEdits) return
    setEdits(viewEdits)
    setOriginalEdits(viewEdits)
    setLocalError(null)
    setMode('edit')
  }, [viewEdits])

  const cancelEdit = React.useCallback(() => {
    setMode('view')
    setEdits(null)
    setLocalError(null)
  }, [])

  const updateField = React.useCallback((actionIndex: number, fieldIndex: number, value: string | boolean) => {
    setEdits((current) =>
      current
        ? current.map((edit, index) =>
            index === actionIndex
              ? { ...edit, fields: edit.fields.map((field, j) => (j === fieldIndex ? { ...field, value } : field)) }
              : edit,
          )
        : current,
    )
  }, [])

  const dispose = React.useCallback(
    async (verdict: DisposeVerdict) => {
      if (!proposal) return
      const editedPayload =
        verdict === 'edited' && edits ? reassembleProposalPayload(payload, actionEditsToActions(edits), selectedOptionId) : null
      const built = buildDisposeBody(verdict, { selectedOptionId, payload: editedPayload, reason })
      if (!built.ok) {
        setLocalError(
          built.error === 'reason'
            ? t('agent_orchestrator.proposal.reject.reasonRequired')
            : t('agent_orchestrator.proposal.options.chooseHint'),
        )
        return
      }
      setBusy(true)
      setLocalError(null)
      try {
        const response = await runMutation({
          operation: () =>
            withScopedApiRequestHeaders(buildOptimisticLockHeader(proposal.updatedAt), () =>
              apiCallOrThrow<DisposeResponse>(
                `/api/agent_orchestrator/proposals/${encodeURIComponent(proposal.id)}/dispose`,
                {
                  method: 'POST',
                  headers: { 'content-type': 'application/json' },
                  body: JSON.stringify(built.body),
                },
              ),
            ),
          context: { proposalId: proposal.id, data: proposal, retryLastMutation },
          mutationPayload: { disposition: verdict },
        })
        const result = response.result ?? {}
        flash(
          t(
            verdict === 'approved'
              ? 'agent_orchestrator.proposal.flash.approved'
              : verdict === 'edited'
                ? 'agent_orchestrator.proposal.flash.edited'
                : 'agent_orchestrator.proposal.flash.rejected',
          ),
          'success',
        )
        setDialog(null)
        setReason('')
        setMode('view')
        setEdits(null)
        onDisposed?.({
          proposalId: proposal.id,
          disposition: result.disposition ?? verdict,
          selectedOptionId: result.selectedOptionId ?? (verdict === 'rejected' ? null : selectedOptionId),
          updatedAt: result.updatedAt ?? null,
        })
        setInternalReload((value) => value + 1)
      } catch (err) {
        if (!surfaceRecordConflict(err, t)) {
          flash(err instanceof Error ? err.message : t('agent_orchestrator.proposal.flash.error'), 'error')
        }
      } finally {
        setBusy(false)
      }
    },
    [proposal, payload, edits, selectedOptionId, reason, runMutation, retryLastMutation, onDisposed, t],
  )

  const openDialog = React.useCallback((kind: 'edit' | 'reject') => {
    setReason('')
    setLocalError(null)
    setDialog(kind)
  }, [])

  const handleKeyDown = React.useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (dialog || !interactive || busy) return
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        if (mode === 'edit') openDialog('edit')
        else if (selectedOptionId) void dispose('approved')
      } else if (event.key === 'Escape' && mode === 'edit') {
        event.preventDefault()
        cancelEdit()
      }
    },
    [dialog, interactive, busy, mode, selectedOptionId, dispose, openDialog, cancelEdit],
  )

  if (state === 'loading') return <LoadingMessage label={t('agent_orchestrator.decisionCard.loading')} />
  if (state === 'notFound') return <ErrorMessage label={t('agent_orchestrator.proposal.notFound')} />
  if (state === 'error' || !proposal) return <ErrorMessage label={t('agent_orchestrator.proposal.error')} />

  const confidenceLabel = formatConfidence(proposal.confidence)
  const uncertainty = evidence?.uncertainty ?? []
  const changedCount = mode === 'edit' && edits && originalEdits ? countChangedFields(originalEdits, edits) : 0

  const renderFieldValue = (edit: ActionEdit, field: EditableActionField, actionIndex: number) => {
    const override = overrideFor(edit.type, field.key)
    const revealKey = `${actionIndex}.${field.key}`
    if (override?.widget === 'masked') {
      const isRevealed = revealed.has(revealKey)
      const text = String(field.value)
      return (
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-foreground">{isRevealed ? text : maskValue(text)}</span>
          {override.revealable ? (
            <IconButton
              type="button"
              variant="ghost"
              size="sm"
              aria-label={t(isRevealed ? 'agent_orchestrator.decisionCard.field.hide' : 'agent_orchestrator.decisionCard.field.reveal')}
              onClick={() =>
                setRevealed((current) => {
                  const next = new Set(current)
                  if (next.has(revealKey)) next.delete(revealKey)
                  else next.add(revealKey)
                  return next
                })
              }
            >
              {isRevealed ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </IconButton>
          ) : null}
        </div>
      )
    }
    if (override?.widget === 'long_text' && field.kind === 'string') {
      const parts = highlightTemplateSegments(String(field.value), evidence?.segments)
      return (
        <p className="whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-sm text-foreground" data-long-text-field={field.key}>
          {parts.map((part, index) =>
            part.source === 'template' ? (
              <mark
                key={index}
                className="rounded-sm bg-brand-violet/10 text-foreground"
                title={part.ref ?? t('agent_orchestrator.decisionCard.segments.template')}
                data-segment-source="template"
              >
                {part.text}
              </mark>
            ) : (
              <React.Fragment key={index}>{part.text}</React.Fragment>
            ),
          )}
        </p>
      )
    }
    if (override?.widget === 'money') {
      return <span className="text-sm font-medium tabular-nums text-foreground">{formatMoney(field.value, undefined)}</span>
    }
    if (field.kind === 'boolean') {
      return (
        <span className="text-sm text-foreground">
          {field.value === true ? t('agent_orchestrator.decisionCard.field.yes') : t('agent_orchestrator.decisionCard.field.no')}
        </span>
      )
    }
    return <span className="whitespace-pre-wrap text-sm text-foreground">{String(field.value)}</span>
  }

  const renderFieldEditor = (edit: ActionEdit, field: EditableActionField, actionIndex: number, fieldIndex: number) => {
    const override = overrideFor(edit.type, field.key)
    if (!isEditableWidget(override, field)) return renderFieldValue(edit, field, actionIndex)
    const inputId = `ao-decision-${proposal.id}-${actionIndex}-${fieldIndex}`
    if (field.kind === 'boolean') {
      return (
        <Switch
          id={inputId}
          checked={field.value === true}
          onCheckedChange={(checked) => updateField(actionIndex, fieldIndex, checked)}
        />
      )
    }
    if (override?.widget === 'long_text') {
      const parts = highlightTemplateSegments(String(field.value), evidence?.segments)
      const hasTemplate = parts.some((part) => part.source === 'template')
      return (
        <div className="space-y-2">
          <Textarea
            id={inputId}
            value={String(field.value)}
            rows={8}
            onChange={(event) => updateField(actionIndex, fieldIndex, event.target.value)}
          />
          {hasTemplate ? (
            <p className="whitespace-pre-wrap rounded-md border border-border p-2 text-xs text-muted-foreground" aria-hidden="true">
              {parts.map((part, index) =>
                part.source === 'template' ? (
                  <mark key={index} className="rounded-sm bg-brand-violet/10 text-foreground">
                    {part.text}
                  </mark>
                ) : (
                  <React.Fragment key={index}>{part.text}</React.Fragment>
                ),
              )}
            </p>
          ) : null}
        </div>
      )
    }
    return (
      <Input
        id={inputId}
        type={field.kind === 'number' || override?.widget === 'money' ? 'number' : 'text'}
        step={override?.widget === 'money' ? '0.01' : undefined}
        value={String(field.value)}
        onChange={(event) => updateField(actionIndex, fieldIndex, event.target.value)}
      />
    )
  }

  return (
    <div
      className={`rounded-lg border border-border bg-card ${className ?? ''}`}
      onKeyDown={handleKeyDown}
      data-testid="ao-proposal-decision-card"
      data-proposal-id={proposal.id}
    >
      <div className="flex flex-wrap items-center gap-3 border-b border-border p-4">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">
            {t('agent_orchestrator.proposal.proposes', undefined, { agent: agentLabel ?? proposal.agentId })}
          </p>
          {!compact ? <p className="truncate font-mono text-xs text-muted-foreground">{proposal.agentId}</p> : null}
        </div>
        {confidenceLabel ? (
          <span className="font-mono text-sm font-semibold text-brand-violet" title={t('agent_orchestrator.proposal.confidence')}>
            {confidenceLabel}
          </span>
        ) : null}
        <StatusBadge variant={proposalCaseStatusVariant(proposal.disposition)} dot>
          {t(proposalCaseStatusLabelKey(proposal.disposition))}
        </StatusBadge>
      </div>

      <div className="space-y-5 p-4">
        {uncertainty.length > 0 ? (
          <ul className="flex flex-wrap gap-2" aria-label={t('agent_orchestrator.decisionCard.uncertainty.heading')}>
            {uncertainty.map((entry) => (
              <li
                key={entry.code}
                className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs ${entry.blocking ? 'bg-status-warning-bg text-status-warning-text' : 'bg-muted text-muted-foreground'}`}
                title={entry.message}
              >
                <TriangleAlert className="size-3.5" aria-hidden="true" />
                {entry.message || entry.code}
              </li>
            ))}
          </ul>
        ) : null}

        {!compact && proposal.rationale ? <p className="text-sm text-muted-foreground">{proposal.rationale}</p> : null}

        {!compact ? (
          <FactsGrid
            facts={agentFacts}
            sources={{ input: run?.input ?? null, payload: proposal.payload, output: run?.output ?? null }}
          />
        ) : null}

        {options.length !== 1 ? (
          <section className="space-y-2">
            <SectionHeader title={t('agent_orchestrator.proposal.options.heading')} count={options.length} />
            <ProposalOptionList
              payload={payload}
              selectedOptionId={selectedOptionId}
              onSelect={interactive && mode === 'view' ? setSelectedOptionId : undefined}
              disabled={busy || !interactive}
              autoDispositionBlock={proposal.autoDispositionBlock}
              showChooseHint={interactive && options.length > 1}
            />
          </section>
        ) : null}

        {shownEdits && shownEdits.length > 0 ? (
          <section className="space-y-3" data-testid="ao-decision-actions">
            <SectionHeader
              title={selectedOption?.label ?? t('agent_orchestrator.proposal.actionsHeading')}
              count={shownEdits.length}
            />
            {shownEdits.map((edit, actionIndex) => (
              <div key={`${edit.type}-${actionIndex}`} className="space-y-3 rounded-lg border border-border p-3" data-action-type={edit.type}>
                <p className="text-sm font-medium text-foreground">{humanizeKey(edit.type)}</p>
                {edit.fields.length === 0 ? (
                  <p className="text-sm text-muted-foreground">{t('agent_orchestrator.proposal.edit.noEditableFields')}</p>
                ) : (
                  <dl className="space-y-3">
                    {edit.fields.map((field, fieldIndex) => {
                      const override = overrideFor(edit.type, field.key)
                      const label = override?.labelKey ? t(override.labelKey) : humanizeKey(field.key)
                      return (
                        <div key={field.key} className="space-y-1" data-field-key={field.key}>
                          <dt>
                            <label
                              className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
                              htmlFor={`ao-decision-${proposal.id}-${actionIndex}-${fieldIndex}`}
                            >
                              {label}
                            </label>
                          </dt>
                          <dd>
                            {mode === 'edit'
                              ? renderFieldEditor(edit, field, actionIndex, fieldIndex)
                              : renderFieldValue(edit, field, actionIndex)}
                          </dd>
                        </div>
                      )
                    })}
                  </dl>
                )}
                {edit.citations && edit.citations.length > 0 ? (
                  <div className="flex flex-wrap gap-1">
                    {edit.citations.map((ref) => (
                      <span key={ref} className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                        {ref}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ))}
          </section>
        ) : null}

        <ProposalCitationsPanel evidence={evidence} citedRefs={citedRefs} />

        {!isPending && proposal.dispositionReason ? (
          <p className="text-sm text-muted-foreground">{proposal.dispositionReason}</p>
        ) : null}

        {isPending && !canDispose ? (
          <div className="flex items-start gap-2.5 rounded-lg bg-muted px-3.5 py-2.5 text-sm text-foreground">
            <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span>{t('agent_orchestrator.decisionCard.readOnly')}</span>
          </div>
        ) : null}

        {localError ? (
          <Alert status="error" style="light">
            {localError}
          </Alert>
        ) : null}

        {interactive ? (
          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
            {mode === 'view' ? (
              <>
                <Button type="button" variant="outline" onClick={() => openDialog('reject')} disabled={busy}>
                  <X className="mr-1.5 size-4 text-status-error-text" aria-hidden="true" />
                  {t('agent_orchestrator.proposal.actions.reject')}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={startEdit}
                  disabled={busy || !viewEdits}
                  title={selectedOptionId ? undefined : t('agent_orchestrator.proposal.options.chooseHint')}
                >
                  <Pencil className="mr-1.5 size-4" aria-hidden="true" />
                  {t('agent_orchestrator.proposal.actions.edit')}
                </Button>
                <span className="ml-auto text-xs text-muted-foreground">
                  <KbdShortcut keys={['⌘', 'Enter']} />
                </span>
                <Button
                  type="button"
                  onClick={() => void dispose('approved')}
                  disabled={busy || !selectedOptionId}
                  title={selectedOptionId ? undefined : t('agent_orchestrator.proposal.options.chooseHint')}
                >
                  <Check className="mr-1.5 size-4" aria-hidden="true" />
                  {approveLabel ?? t('agent_orchestrator.proposal.actions.approve')}
                </Button>
              </>
            ) : (
              <>
                <Button type="button" variant="outline" onClick={cancelEdit} disabled={busy}>
                  {t('agent_orchestrator.proposal.actions.cancelEdit')}
                </Button>
                <span className="ml-auto text-xs text-muted-foreground">
                  {t('agent_orchestrator.decisionCard.edit.changed', undefined, { count: changedCount })}
                </span>
                <Button type="button" onClick={() => openDialog('edit')} disabled={busy}>
                  {t('agent_orchestrator.proposal.actions.saveEdit')}
                </Button>
              </>
            )}
          </div>
        ) : null}
      </div>

      <DisposeDialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) setDialog(null)
        }}
        title={
          dialog === 'reject'
            ? t('agent_orchestrator.proposal.reject.heading')
            : t('agent_orchestrator.decisionCard.edit.dialogTitle')
        }
        description={dialog === 'edit' ? t('agent_orchestrator.decisionCard.edit.changed', undefined, { count: changedCount }) : undefined}
        reason={reason}
        onReasonChange={setReason}
        reasonPlaceholder={
          dialog === 'reject'
            ? t('agent_orchestrator.proposal.reject.reasonPlaceholder')
            : t('agent_orchestrator.proposal.edit.reasonPlaceholder')
        }
        confirmLabel={
          dialog === 'reject' ? t('agent_orchestrator.proposal.reject.confirm') : t('agent_orchestrator.proposal.actions.saveEdit')
        }
        onConfirm={() => void dispose(dialog === 'reject' ? 'rejected' : 'edited')}
        busy={busy}
        requireReason
        confirmVariant={dialog === 'reject' ? 'destructive' : 'default'}
      />
    </div>
  )
}

export default ProposalDecisionCard
