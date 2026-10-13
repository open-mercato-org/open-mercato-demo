"use client"

import * as React from 'react'
import { hasAllFeatures } from '@open-mercato/shared/lib/auth/featureMatch'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'

type FeatureCheckResponse = { ok?: boolean; granted?: string[] }

/** Client-side feature check through `/api/auth/feature-check` (wildcard-aware); false until answered. */
export function useFeatureGranted(feature: string): boolean {
  const [granted, setGranted] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    void apiCall<FeatureCheckResponse>(
      '/api/auth/feature-check',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ features: [feature] }),
      },
      { fallback: { ok: false, granted: [] } },
    )
      .then((response) => {
        if (cancelled) return
        const list = response.result?.granted ?? []
        setGranted(response.ok && (response.result?.ok === true || hasAllFeatures([feature], list)))
      })
      .catch(() => {
        if (!cancelled) setGranted(false)
      })
    return () => {
      cancelled = true
    }
  }, [feature])

  return granted
}
