"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type PeopleListResponse = {
  items?: Array<Record<string, unknown>>
}

const MAX_IDS = 100

function readLabel(item: Record<string, unknown>): string | null {
  const candidates = [item.display_name, item.displayName, item.primary_email, item.primaryEmail]
  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.trim()) return candidate.trim()
  }
  return null
}

export function usePeopleLabels(ids: Array<string | null | undefined>): Record<string, string> {
  const [labels, setLabels] = React.useState<Record<string, string>>({})
  const key = React.useMemo(() => {
    const unique = Array.from(new Set(ids.filter((id): id is string => typeof id === 'string' && id.length > 0)))
    return unique.slice(0, MAX_IDS).sort().join(',')
  }, [ids])

  React.useEffect(() => {
    if (!key) {
      setLabels({})
      return
    }
    let cancelled = false
    const params = new URLSearchParams({ ids: key, pageSize: String(MAX_IDS), page: '1' })
    apiCall<PeopleListResponse>(`/api/customers/people?${params.toString()}`)
      .then((response) => {
        if (cancelled || !response.ok || !response.result) return
        const next: Record<string, string> = {}
        for (const item of response.result.items ?? []) {
          const id = typeof item.id === 'string' ? item.id : null
          const label = readLabel(item)
          if (id && label) next[id] = label
        }
        setLabels(next)
      })
      .catch(() => {
        if (!cancelled) setLabels({})
      })
    return () => {
      cancelled = true
    }
  }, [key])

  return labels
}
