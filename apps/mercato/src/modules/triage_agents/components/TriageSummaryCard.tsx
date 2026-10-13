"use client"

import * as React from 'react'
import Link from 'next/link'
import { CheckCircle2, CircleHelp, ExternalLink, RefreshCw, ShieldAlert, ShieldCheck, Sparkles } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { Card, CardContent, CardHeader, CardTitle } from '@open-mercato/ui/primitives/card'
import { Tag } from '@open-mercato/ui/primitives/tag'
import { SimpleTooltip } from '@open-mercato/ui/primitives/tooltip'
import { TriageStatusBadge } from './TriageStatusBadge'
import { useTicketTriage } from './useTicketTriage'
import { useTriageRerun } from './useTriageRerun'
import { pendingProposalId, TRIAGE_DECISION_CARD_ANCHOR, type TriageView } from './triageTypes'

type TicketLike = {
  summary?: unknown
  categoryPathSnapshot?: unknown
  priority?: unknown
  priorityReason?: unknown
  reservationNumberSnapshot?: unknown
}

const RERUN_CONTEXT_ID = 'triage_agents.summary-card'

const VERIFIED_CUSTOMER_MATCHES = new Set(['confirmed'])
const VERIFIED_RESERVATION_MATCHES = new Set(['explicit_number_verified', 'single_reservation', 'inferred_from_content'])

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function MatchIcon({ verified, label }: { verified: boolean; label: string }) {
  return verified ? (
    <CheckCircle2 className="size-4 shrink-0 text-status-success-icon" aria-label={label} />
  ) : (
    <CircleHelp className="size-4 shrink-0 text-status-warning-icon" aria-label={label} />
  )
}

function Row({ label, children, testId }: { label: string; children: React.ReactNode; testId?: string }) {
  return (
    <div className="grid grid-cols-1 gap-1 sm:grid-cols-[10rem_1fr] sm:gap-3" data-testid={testId}>
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm text-foreground">{children}</dd>
    </div>
  )
}

export type TriageSummaryCardProps = {
  ticketId: string
  ticket?: TicketLike | null
}

export function TriageSummaryCard({ ticketId, ticket }: TriageSummaryCardProps) {
  const t = useT()
  const { triage, loading, error, reload } = useTicketTriage(ticketId)
  const { rerun, rerunning, ConfirmDialogElement } = useTriageRerun(ticketId, triage, RERUN_CONTEXT_ID, reload)
  const proposalPending = pendingProposalId(triage)

  if (error === 'forbidden') return null

  return (
    <Card data-testid="triage-summary-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Sparkles className="size-4 text-muted-foreground" aria-hidden />
          {t('triage_agents.card.title', 'AI triage')}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <TriageStatusBadge triage={triage} />
          {triage && triage.attempt > 1 ? (
            <span className="text-xs text-muted-foreground">
              {t('triage_agents.card.attempt', 'Attempt {attempt}', { attempt: triage.attempt })}
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !triage ? <LoadingMessage label={t('triage_agents.card.loading', 'Loading AI triage…')} /> : null}
        {!loading && !triage ? (
          <p className="text-sm text-muted-foreground">{t('triage_agents.card.empty', 'This ticket has not been triaged by AI yet.')}</p>
        ) : null}
        {triage ? <TriageDetails triage={triage} ticket={ticket ?? null} /> : null}
        <div className="flex flex-wrap items-center gap-2">
          {proposalPending ? (
            <>
              <Button asChild variant="default">
                <a href={`#${TRIAGE_DECISION_CARD_ANCHOR}`} data-testid="triage-review-proposal">
                  {t('triage_agents.card.reviewProposal', 'Review proposal')}
                </a>
              </Button>
              <Button asChild variant="link" size="sm">
                <Link href={`/backend/caseload/${encodeURIComponent(proposalPending)}`} data-testid="triage-open-caseload">
                  {t('triage_agents.card.openInCaseload', 'Open in Caseload')}
                </Link>
              </Button>
            </>
          ) : null}
          {triage?.executionId ? (
            <Button asChild variant="outline">
              <Link href={`/backend/processes/${encodeURIComponent(triage.executionId)}`}>
                <ExternalLink className="size-4" aria-hidden />
                {t('triage_agents.card.openFlow', 'Open flow')}
              </Link>
            </Button>
          ) : null}
          <Button type="button" variant="outline" onClick={() => { void rerun() }} disabled={rerunning} data-testid="triage-rerun">
            <RefreshCw className="size-4" aria-hidden />
            {t('triage_agents.card.rerun', 'Re-run triage')}
          </Button>
        </div>
        {ConfirmDialogElement}
      </CardContent>
    </Card>
  )
}

function TriageDetails({ triage, ticket }: { triage: TriageView; ticket: TicketLike | null }) {
  const t = useT()
  const customer = triage.identification?.customer
  const reservation = triage.identification?.reservation
  const customerVerified = customer ? VERIFIED_CUSTOMER_MATCHES.has(customer.match) : false
  const reservationVerified = reservation ? VERIFIED_RESERVATION_MATCHES.has(reservation.match) : false
  const categoryPath = readText(ticket?.categoryPathSnapshot) ?? readText(triage.classification?.categoryPath) ?? readText(triage.classification?.topicKey)
  const priority = triage.priority ?? readText(ticket?.priority)
  const priorityReason = triage.priorityReason ?? readText(ticket?.priorityReason)
  const summary = readText(ticket?.summary)
  const matchLabel = (match: string | undefined) =>
    match ? t(`triage_agents.match.${match}`, match.replaceAll('_', ' ')) : t('triage_agents.match.not_found', 'not found')

  return (
    <div className="space-y-4">
      <dl className="space-y-2">
        <Row label={t('triage_agents.card.customer', 'Customer')} testId="triage-customer">
          <span className="inline-flex items-center gap-2">
            <MatchIcon verified={customerVerified} label={matchLabel(customer?.match)} />
            {matchLabel(customer?.match)}
          </span>
        </Row>
        <Row label={t('triage_agents.card.reservation', 'Reservation')} testId="triage-reservation">
          <span className="inline-flex flex-wrap items-center gap-2">
            <MatchIcon verified={reservationVerified} label={matchLabel(reservation?.match)} />
            {reservation?.bookingNumber ?? readText(ticket?.reservationNumberSnapshot) ?? '—'}
            <span className="text-muted-foreground">({matchLabel(reservation?.match)})</span>
          </span>
          {reservation && reservation.candidates.length > 0 ? (
            <ul className="mt-1 list-inside list-disc text-muted-foreground">
              {reservation.candidates.map((candidate) => (
                <li key={candidate.reservationId ?? candidate.bookingNumber ?? candidate.label ?? ''}>
                  {[candidate.bookingNumber, candidate.label].filter(Boolean).join(' — ')}
                </li>
              ))}
            </ul>
          ) : null}
        </Row>
        <Row label={t('triage_agents.card.category', 'Category')} testId="triage-category">{categoryPath ?? '—'}</Row>
        {triage.classification?.source === 'manual' ? (
          <Row label={t('triage_agents.card.classificationSource', 'Classification')} testId="triage-classification-kept">
            {t('triage_agents.card.classificationKept', "Kept the consultant's classification; the AI classification was not applied.")}
          </Row>
        ) : null}
        <Row label={t('triage_agents.card.priority', 'Priority')} testId="triage-priority">
          {priorityReason ?? priority ?? '—'}
        </Row>
        {summary ? <Row label={t('triage_agents.card.summary', 'Summary')}>{summary}</Row> : null}
        <Row label={t('triage_agents.card.recommendedAction', 'Recommended action')} testId="triage-recommended-action">
          {triage.recommendedActionLabel ?? '—'}
        </Row>
        {triage.reason ? (
          <Row label={t('triage_agents.card.reason', 'Reason')} testId="triage-reason">
            <span data-reason-code={triage.reasonCode ?? undefined}>{triage.reason}</span>
          </Row>
        ) : null}
        <Row label={t('triage_agents.card.draft', 'Draft')} testId="triage-draft">
          {t(`triage_agents.draft.${triage.draftState}`, triage.draftState)}
        </Row>
        {triage.groundingState !== 'not_checked' ? (
          <Row label={t('triage_agents.card.grounding', 'Knowledge base')} testId="triage-grounding">
            {triage.groundingState === 'verified' ? (
              <span className="inline-flex items-center gap-2">
                <ShieldCheck className="size-4 text-status-success-icon" aria-hidden />
                {t('triage_agents.grounding.verified', 'Citations verified against the article')}
              </span>
            ) : (
              <SimpleTooltip content={triage.groundingIssues.join(' ')}>
                <span className="inline-flex items-center gap-2">
                  <ShieldAlert className="size-4 text-status-warning-icon" aria-hidden />
                  {t('triage_agents.grounding.unverified', 'Grounding unverified')}
                </span>
              </SimpleTooltip>
            )}
          </Row>
        ) : null}
      </dl>
      {triage.uncertainty.length > 0 ? (
        <div className="flex flex-wrap gap-2" data-testid="triage-uncertainty">
          {triage.uncertainty.map((entry) => (
            <SimpleTooltip key={`${entry.source}:${entry.code}:${entry.message}`} content={entry.message}>
              <span>
                <Tag variant={entry.blocking ? 'warning' : 'neutral'} dot>
                  {entry.code.replaceAll('_', ' ')}
                </Tag>
              </span>
            </SimpleTooltip>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default TriageSummaryCard
