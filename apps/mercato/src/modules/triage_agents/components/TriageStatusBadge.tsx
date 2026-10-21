"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { TRIAGE_STATUS_LABEL_KEYS, TRIAGE_STATUS_VARIANTS, resolveTriageStatus, type TriageView } from './triageTypes'

export function TriageStatusBadge({ triage }: { triage: Pick<TriageView, 'stage' | 'aiMode'> | null | undefined }) {
  const t = useT()
  const status = resolveTriageStatus(triage)
  if (!status) return null
  const label = TRIAGE_STATUS_LABEL_KEYS[status]
  return (
    <StatusBadge variant={TRIAGE_STATUS_VARIANTS[status]} dot>
      <span data-testid="triage-status" data-triage-status={status}>{t(label.key, label.fallback)}</span>
    </StatusBadge>
  )
}

export default TriageStatusBadge
