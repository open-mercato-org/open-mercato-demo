"use client"

import * as React from 'react'
import { clearNavBadge, setNavBadge } from '@open-mercato/ui/backend/nav/navBadges'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { AWAITING_DECISION_HREF } from '../../../data/constants'
import { useAwaitingDecisionCount } from '../../../components/useAwaitingDecisionCount'

export default function AwaitingDecisionNavBadgeWidget() {
  const t = useT()
  const count = useAwaitingDecisionCount()

  React.useEffect(() => {
    if (count === null) {
      clearNavBadge(AWAITING_DECISION_HREF)
      return
    }
    setNavBadge(AWAITING_DECISION_HREF, {
      count,
      tone: 'attention',
      label: t('triage_agents.awaitingDecision.countLabel', '{count} waiting for your decision', { count: String(count) }),
    })
  }, [count, t])

  React.useEffect(() => () => clearNavBadge(AWAITING_DECISION_HREF), [])

  return null
}
