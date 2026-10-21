"use client"

import * as React from 'react'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type FeatureCheckResponse = { ok?: boolean; granted?: string[] }

const NONE_GRANTED: ReadonlySet<string> = new Set()

/**
 * Client-side check of several features in one `/api/auth/feature-check` round trip
 * (wildcard-aware). Every feature reads as not granted until the answer arrives.
 */
export function useGrantedFeatures(features: readonly string[]): ReadonlySet<string> {
  const key = features.join('|')
  const [granted, setGranted] = React.useState<ReadonlySet<string>>(NONE_GRANTED)

  React.useEffect(() => {
    let cancelled = false
    const requested = key ? key.split('|') : []
    if (requested.length === 0) return
    void apiCall<FeatureCheckResponse>(
      '/api/auth/feature-check',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ features: requested }),
      },
      { fallback: { ok: false, granted: [] } },
    )
      .then((response) => {
        if (cancelled) return
        if (!response.ok) {
          setGranted(NONE_GRANTED)
          return
        }
        const list = response.result?.granted ?? []
        const allGranted = response.result?.ok === true
        setGranted(new Set(requested.filter((feature) => allGranted || hasAllFeatures([feature], list))))
      })
      .catch(() => {
        if (!cancelled) setGranted(NONE_GRANTED)
      })
    return () => {
      cancelled = true
    }
  }, [key])

  return granted
}

/** Client-side feature check through `/api/auth/feature-check` (wildcard-aware); false until answered. */
export function useFeatureGranted(feature: string): boolean {
  const granted = useGrantedFeatures(React.useMemo(() => [feature], [feature]))
  return granted.has(feature)
}
