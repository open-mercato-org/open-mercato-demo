"use client"

import * as React from 'react'
import { BookOpen, CircleCheck, CircleX, ExternalLink } from 'lucide-react'
import { SectionHeader } from '@open-mercato/ui/backend/SectionHeader'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import type { ProposalEvidence } from '../data/validators'
import { fallbackCitation, resolveCitation, type CitationRef, type ResolvedCitation } from './citationResolvers'

/**
 * The "Based on" panel (spec §A): the sources a proposal is grounded in, the
 * steps it cites with their text when a resolver supplies it, and every check
 * the agent ran with its verdict and evidence. Renders nothing when the proposal
 * carries no evidence — absence of grounding is shown by the host, not here.
 */

export type ProposalCitationsPanelProps = {
  evidence: ProposalEvidence | undefined
  /** Step ids cited by the selected option's actions (`key@v#S2` → `S2`), highlighted in the list. */
  citedRefs?: string[]
  className?: string
}

function stepIdsFromRefs(refs: string[] | undefined): Set<string> {
  const ids = new Set<string>()
  for (const ref of refs ?? []) {
    const hash = ref.indexOf('#')
    if (hash >= 0) ids.add(ref.slice(hash + 1))
  }
  return ids
}

export function ProposalCitationsPanel({ evidence, citedRefs, className }: ProposalCitationsPanelProps) {
  const t = useT()
  const citations = React.useMemo<CitationRef[]>(
    () =>
      (evidence?.citations ?? []).map((citation) => ({
        kind: citation.kind,
        ref: citation.ref,
        label: citation.label ?? null,
        steps: citation.steps,
        href: citation.href ?? null,
      })),
    [evidence],
  )
  const checks = evidence?.checks ?? []
  const [resolved, setResolved] = React.useState<ResolvedCitation[]>(() => citations.map(fallbackCitation))
  const citedStepIds = React.useMemo(() => stepIdsFromRefs(citedRefs), [citedRefs])

  React.useEffect(() => {
    let cancelled = false
    setResolved(citations.map(fallbackCitation))
    void Promise.all(citations.map((citation) => resolveCitation(citation))).then((items) => {
      if (!cancelled) setResolved(items)
    })
    return () => {
      cancelled = true
    }
  }, [citations])

  if (citations.length === 0 && checks.length === 0) return null

  return (
    <section className={className} data-testid="ao-decision-citations">
      <SectionHeader title={t('agent_orchestrator.decisionCard.citations.heading')} count={citations.length} />
      <div className="mt-2 space-y-3">
        {citations.map((citation, index) => {
          const view = resolved[index] ?? fallbackCitation(citation)
          const stepTexts = new Map((view.steps ?? []).map((step) => [step.id, step.text]))
          const stepIds = citation.steps && citation.steps.length > 0 ? citation.steps : (view.steps ?? []).map((step) => step.id)
          return (
            <div key={`${citation.kind}:${citation.ref}`} className="rounded-lg border border-border p-3" data-citation-ref={citation.ref}>
              <div className="flex items-start gap-2">
                <BookOpen className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  {view.href ? (
                    <a
                      href={view.href}
                      className="inline-flex items-center gap-1 text-sm font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      {view.title}
                      <ExternalLink className="size-3.5" aria-hidden="true" />
                    </a>
                  ) : (
                    <p className="text-sm font-medium text-foreground">{view.title}</p>
                  )}
                  <p className="truncate font-mono text-xs text-muted-foreground">{citation.ref}</p>
                </div>
              </div>
              {stepIds.length > 0 ? (
                <ol className="mt-2 space-y-1">
                  {stepIds.map((stepId) => (
                    <li
                      key={stepId}
                      className={`flex gap-2 rounded-md px-2 py-1 text-sm ${citedStepIds.has(stepId) ? 'bg-brand-violet/10' : ''}`}
                    >
                      <span className="shrink-0 font-mono text-xs text-muted-foreground">{stepId}</span>
                      <span className="text-foreground">{stepTexts.get(stepId) ?? ''}</span>
                    </li>
                  ))}
                </ol>
              ) : null}
            </div>
          )
        })}
        {checks.length > 0 ? (
          <div className="space-y-1.5">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t('agent_orchestrator.decisionCard.citations.checks')}
            </p>
            <ul className="space-y-1.5">
              {checks.map((check) => (
                <li key={check.key} className="flex items-start gap-2 text-sm" data-check-key={check.key}>
                  {check.passed ? (
                    <CircleCheck
                      className="mt-0.5 size-4 shrink-0 text-status-success-icon"
                      aria-label={t('agent_orchestrator.decisionCard.citations.passed')}
                    />
                  ) : (
                    <CircleX
                      className="mt-0.5 size-4 shrink-0 text-status-error-icon"
                      aria-label={t('agent_orchestrator.decisionCard.citations.failed')}
                    />
                  )}
                  <span className="min-w-0">
                    <span className="font-medium text-foreground">{check.key}</span>
                    {check.step ? <span className="ml-1.5 font-mono text-xs text-muted-foreground">{check.step}</span> : null}
                    {check.evidence ? <span className="block text-muted-foreground">{check.evidence}</span> : null}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </section>
  )
}

export default ProposalCitationsPanel
