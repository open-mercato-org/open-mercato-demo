"use client"

import * as React from 'react'
import { apiCall } from '@open-mercato/ui/backend/utils/apiCall'
import { hasFeature } from '@open-mercato/shared/security/features'

type FeatureCheckResponse = {
  ok: boolean
  granted: string[]
  userId: string
}

export type TicketAccess = {
  ready: boolean
  userId: string | null
  canManage: boolean
  canClassify: boolean
  canReply: boolean
}

const REQUESTED_FEATURES = ['tickets.manage', 'tickets.classify', 'tickets.reply']

export function useTicketAccess(): TicketAccess {
  const [access, setAccess] = React.useState<TicketAccess>({
    ready: false,
    userId: null,
    canManage: false,
    canClassify: false,
    canReply: false,
  })

  React.useEffect(() => {
    let cancelled = false
    apiCall<FeatureCheckResponse>('/api/auth/feature-check', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ features: REQUESTED_FEATURES }),
    })
      .then((response) => {
        if (cancelled) return
        const granted = response.ok && Array.isArray(response.result?.granted) ? response.result.granted : []
        setAccess({
          ready: true,
          userId: typeof response.result?.userId === 'string' ? response.result.userId : null,
          canManage: hasFeature(granted, 'tickets.manage'),
          canClassify: hasFeature(granted, 'tickets.classify'),
          canReply: hasFeature(granted, 'tickets.reply'),
        })
      })
      .catch(() => {
        if (!cancelled) setAccess((current) => ({ ...current, ready: true }))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return access
}
