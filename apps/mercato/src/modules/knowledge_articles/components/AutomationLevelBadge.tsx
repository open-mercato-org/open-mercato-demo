"use client"

import * as React from 'react'
import { StatusBadge } from '@open-mercato/ui/primitives/status-badge'
import { useT } from '@open-mercato/shared/lib/i18n/context'

export function AutomationLevelBadge({ level }: { level: string | null | undefined }) {
  const t = useT()
  if (level === 'assisted') {
    return <StatusBadge variant="info" dot>{t('knowledge_articles.automation.assisted')}</StatusBadge>
  }
  return <StatusBadge variant="warning" dot>{t('knowledge_articles.automation.manual_only')}</StatusBadge>
}

export function ArticleStatusBadge({ status, version }: { status: string | null | undefined; version?: number | null }) {
  const t = useT()
  if (status === 'published') {
    return (
      <StatusBadge variant="success" dot>
        {t('knowledge_articles.status.publishedVersion', { version: String(version ?? 0) })}
      </StatusBadge>
    )
  }
  return <StatusBadge variant="neutral" dot>{t('knowledge_articles.status.draft')}</StatusBadge>
}
