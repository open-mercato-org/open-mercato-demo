"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'
import { isTriageView, type TriageView } from './triageTypes'

type TriageResponse = { triage: TriageView | null }

export function useTicketTriage(ticketId: string | null) {
  const [triage, setTriage] = React.useState<TriageView | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!ticketId) return
    setLoading(true)
    setError(null)
    try {
      const call = await apiCall<TriageResponse>(`/api/triage_agents/tickets/${encodeURIComponent(ticketId)}`)
      if (!call.ok) {
        setError(call.status === 403 ? 'forbidden' : 'failed')
        return
      }
      setTriage(isTriageView(call.result?.triage) ? call.result?.triage ?? null : null)
    } catch {
      setError('failed')
    } finally {
      setLoading(false)
    }
  }, [ticketId])

  React.useEffect(() => {
    void load()
  }, [load])

  useAppEvent(
    'triage_agents.triage.updated',
    (event) => {
      if (event.payload?.ticketId === ticketId) void load()
    },
    [ticketId, load],
  )

  return { triage, loading, error, reload: load }
}
