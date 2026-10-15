"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { useAppEvent } from '@open-mercato/ui/backend/injection/useAppEvent'

export const AWAITING_DECISION_COUNT_PATH = '/api/triage_agents/awaiting-decision'

const OPTIONAL_REQUEST_INIT: RequestInit = { headers: { 'x-om-forbidden-redirect': '0' } }

const REFRESH_DEBOUNCE_MS = 300

/**
 * How many tickets wait for a human decision on their AI proposal; `null` until the first
 * answer or when the probe fails. Live via the DOM Event Bridge, coalesced so a burst of
 * proposal events costs one request.
 */
export function useAwaitingDecisionCount(): number | null {
  const [count, setCount] = React.useState<number | null>(null)
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = React.useRef(true)

  const refresh = React.useCallback(async () => {
    const call = await apiCall<{ total?: number }>(AWAITING_DECISION_COUNT_PATH, OPTIONAL_REQUEST_INIT, { fallback: {} })
    if (!mountedRef.current) return
    setCount(call.ok && typeof call.result?.total === 'number' ? call.result.total : null)
  }, [])

  const scheduleRefresh = React.useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      timerRef.current = null
      void refresh()
    }, REFRESH_DEBOUNCE_MS)
  }, [refresh])

  React.useEffect(() => {
    mountedRef.current = true
    void refresh()
    return () => {
      mountedRef.current = false
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [refresh])

  useAppEvent('agent_orchestrator.proposal.*', scheduleRefresh, [scheduleRefresh])
  useAppEvent('triage_agents.triage.updated', scheduleRefresh, [scheduleRefresh])

  return count
}
