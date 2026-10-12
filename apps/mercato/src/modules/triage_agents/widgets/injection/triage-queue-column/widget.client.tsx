"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { TriageStatusBadge } from '../../../components/TriageStatusBadge'
import { isTriageView, type TriageView } from '../../../components/triageTypes'

export default function TriageQueueCell({ value }: { value: unknown }) {
  const initial = isTriageView(value) ? value : null
  const [triage, setTriage] = React.useState<TriageView | null>(initial)

  React.useEffect(() => {
    setTriage(isTriageView(value) ? value : null)
  }, [value])

  const ticketId = triage?.ticketId ?? null
  useAppEvent(
    'triage_agents.triage.updated',
    (event) => {
      if (!ticketId || event.payload?.ticketId !== ticketId) return
      void apiCall<{ triage: TriageView | null }>(`/api/triage_agents/tickets/${encodeURIComponent(ticketId)}`).then((call) => {
        if (call.ok && isTriageView(call.result?.triage)) setTriage(call.result?.triage ?? null)
      })
    },
    [ticketId],
  )

  if (!triage) return <span className="text-muted-foreground">—</span>
  return (
    <div className="flex flex-col gap-1" data-testid="triage-queue-cell">
      <TriageStatusBadge triage={triage} />
      {triage.recommendedActionLabel ? (
        <span className="truncate text-xs text-muted-foreground" title={triage.recommendedActionLabel}>
          {triage.recommendedActionLabel}
        </span>
      ) : null}
    </div>
  )
}
