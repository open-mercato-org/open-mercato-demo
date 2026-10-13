"use client"

import * as React from 'react'
import { RefreshCw } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { Button } from '@open-mercato/ui/primitives/button'
import { ProcessFlowTrace } from '@open-mercato/enterprise/modules/agent_orchestrator/components/ProcessFlowTrace'
import { useTicketTriage } from './useTicketTriage'
import { useTriageRerun } from './useTriageRerun'
import { attemptExecutionIds, currentExecutionId } from './triageTypes'

const RERUN_CONTEXT_ID = 'triage_agents.flow-tab'

export type TriageFlowTabProps = { ticketId: string }

/**
 * The ticket's triage flow (AO `ProcessFlowTrace`): the current attempt with every
 * previous attempt in the selector (compare appears from the second attempt on), and
 * the triage re-run (with supersede on a pending proposal) instead of the generic AO one.
 */
export function TriageFlowTab({ ticketId }: TriageFlowTabProps) {
  const t = useT()
  const { triage, loading, error, reload } = useTicketTriage(ticketId)
  const { rerun, rerunning, ConfirmDialogElement } = useTriageRerun(ticketId, triage, RERUN_CONTEXT_ID, reload)
  const attempts = React.useMemo(() => attemptExecutionIds(triage), [triage])
  const executionId = currentExecutionId(triage)

  if (error) return null

  return (
    <div className="space-y-3" data-testid="triage-flow-tab">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          {triage ? t('triage_agents.card.attempt', 'Attempt {attempt}', { attempt: triage.attempt }) : null}
        </p>
        <Button type="button" variant="outline" size="sm" onClick={() => { void rerun() }} disabled={rerunning} data-testid="triage-flow-rerun">
          <RefreshCw className="size-4" aria-hidden />
          {t('triage_agents.card.rerun', 'Re-run triage')}
        </Button>
      </div>
      {loading && !triage ? <LoadingMessage label={t('triage_agents.flow.loading', 'Loading the triage flow…')} /> : null}
      {!loading && !executionId ? (
        <p className="text-sm text-muted-foreground">{t('triage_agents.flow.empty', 'No triage execution has been recorded for this ticket yet.')}</p>
      ) : null}
      {executionId ? (
        <ProcessFlowTrace
          executionId={executionId}
          attempts={attempts}
          showAttemptSelector
          allowRerun={false}
        />
      ) : null}
      {ConfirmDialogElement}
    </div>
  )
}

export default TriageFlowTab
