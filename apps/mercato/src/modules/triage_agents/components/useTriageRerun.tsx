"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { pendingProposalId, type TriageView } from './triageTypes'

export type TriageRerunResult = { executionId: string; attempt: number; supersededProposalIds: string[] }

export function buildRerunBody(supersede: boolean): { supersede?: true } {
  return supersede ? { supersede: true } : {}
}

/**
 * The "Re-run triage" action shared by the summary card and the Flow tab. When the
 * current attempt still waits for a decision it asks for confirmation (in-page dialog,
 * Cmd/Ctrl+Enter confirms, Escape cancels) and re-runs with `supersede`, which rejects
 * the pending proposal through the AO dispose path.
 */
export function useTriageRerun(
  ticketId: string,
  triage: TriageView | null,
  contextId: string,
  onStarted?: (result: TriageRerunResult) => void | Promise<void>,
) {
  const t = useT()
  const [rerunning, setRerunning] = React.useState(false)
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({ contextId })

  const rerun = React.useCallback(async () => {
    const supersede = pendingProposalId(triage) !== null
    if (supersede) {
      const confirmed = await confirm({
        title: t('triage_agents.rerun.supersedeTitle', 'Re-run and replace the pending proposal?'),
        text: t(
          'triage_agents.rerun.supersedeText',
          'The pending proposal will be rejected (superseded by the re-run) and the triage starts again with the current knowledge base. Nothing is sent to the customer.',
        ),
        confirmText: t('triage_agents.rerun.supersedeConfirm', 'Reject and re-run'),
        cancelText: t('triage_agents.rerun.cancel', 'Cancel'),
        variant: 'destructive',
      })
      if (!confirmed) return
    }
    setRerunning(true)
    try {
      const response = await runMutation({
        operation: () =>
          apiCallOrThrow<TriageRerunResult>(`/api/triage_agents/tickets/${encodeURIComponent(ticketId)}/rerun`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(buildRerunBody(supersede)),
          }),
        mutationPayload: { ticketId, supersede },
        context: { formId: contextId, resourceKind: 'tickets.ticket', resourceId: ticketId, retryLastMutation },
      })
      flash(t('triage_agents.card.rerunStarted', 'Triage re-run started.'), 'success')
      if (response.result && onStarted) await onStarted(response.result)
    } catch {
      flash(t('triage_agents.card.rerunFailed', 'Could not re-run the triage.'), 'error')
    } finally {
      setRerunning(false)
    }
  }, [confirm, contextId, onStarted, retryLastMutation, runMutation, t, ticketId, triage])

  return { rerun, rerunning, ConfirmDialogElement }
}
