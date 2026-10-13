"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { ProposalDecisionCard } from '@open-mercato/enterprise/modules/agent_orchestrator/components/ProposalDecisionCard'
import { ensureKbCitationResolver } from './kbCitationResolver'
import { buildTriageFieldOverrides, REFUND_MANAGE_FEATURE } from './triageDecisionModel'
import { useFeatureGranted } from './useFeatureGranted'
import { useTicketTriage } from './useTicketTriage'
import { pendingProposalId, TRIAGE_DECISION_CARD_ANCHOR } from './triageTypes'

ensureKbCitationResolver()

export type TriageDecisionCardProps = {
  ticketId: string
  onTicketChanged?: () => void | Promise<void>
  onDraftsChanged?: () => void | Promise<void>
}

/**
 * The AO decision card for the ticket's pending triage proposal, on the ticket page
 * above the composer. Renders nothing while no proposal waits for a decision.
 */
export function TriageDecisionCard({ ticketId, onTicketChanged, onDraftsChanged }: TriageDecisionCardProps) {
  const t = useT()
  const { triage, error, reload } = useTicketTriage(ticketId)
  const canRevealBankAccount = useFeatureGranted(REFUND_MANAGE_FEATURE)
  const fieldOverrides = React.useMemo(() => buildTriageFieldOverrides(canRevealBankAccount), [canRevealBankAccount])
  const proposalId = pendingProposalId(triage)
  const trackedProposalId = triage?.proposalId ?? null

  const refreshAll = React.useCallback(async () => {
    await Promise.all([reload(), onDraftsChanged?.(), onTicketChanged?.()])
  }, [onDraftsChanged, onTicketChanged, reload])

  useAppEvent(
    'agent_orchestrator.proposal.executed',
    (event) => {
      if (trackedProposalId && event.payload?.proposalId === trackedProposalId) void refreshAll()
    },
    [trackedProposalId, refreshAll],
  )

  if (error || !proposalId) return null

  return (
    <section
      id={TRIAGE_DECISION_CARD_ANCHOR}
      className="scroll-mt-4 space-y-2"
      aria-label={t('triage_agents.decisionCard.title', 'AI proposal')}
      data-testid="triage-decision-card"
    >
      <h2 className="text-sm font-semibold">{t('triage_agents.decisionCard.title', 'AI proposal')}</h2>
      <ProposalDecisionCard
        proposalId={proposalId}
        approveLabel={t('triage_agents.decisionCard.approve', 'Approve & send')}
        fieldOverrides={fieldOverrides}
        onDisposed={() => {
          void refreshAll()
        }}
      />
    </section>
  )
}

export default TriageDecisionCard
