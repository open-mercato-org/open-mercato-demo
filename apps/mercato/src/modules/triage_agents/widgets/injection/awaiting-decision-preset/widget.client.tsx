"use client"

import * as React from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Inbox } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { useAwaitingDecisionCount } from '../../../components/useAwaitingDecisionCount'
import {
  formatAwaitingDecisionCount,
  isAwaitingDecisionActive,
  toggleAwaitingDecisionHref,
} from '../../../components/awaitingDecisionLink'

export default function AwaitingDecisionPresetWidget() {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const count = useAwaitingDecisionCount()
  const active = isAwaitingDecisionActive(searchParams)

  const handleClick = React.useCallback(() => {
    router.push(toggleAwaitingDecisionHref(pathname ?? '/backend/tickets', searchParams), { scroll: false })
  }, [pathname, router, searchParams])

  return (
    <Button
      type="button"
      variant={active ? 'default' : 'outline'}
      aria-pressed={active}
      onClick={handleClick}
      data-testid="triage-awaiting-decision-preset"
    >
      <Inbox className="size-4" aria-hidden />
      {t('triage_agents.awaitingDecision.preset', 'Awaiting decision')}
      {count !== null && count > 0 ? (
        <span
          className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-status-warning-bg px-1.5 text-xs font-medium text-status-warning-text"
          aria-label={t('triage_agents.awaitingDecision.countLabel', '{count} waiting for your decision', { count: String(count) })}
          data-testid="triage-awaiting-decision-count"
        >
          {formatAwaitingDecisionCount(count)}
        </span>
      ) : null}
    </Button>
  )
}
