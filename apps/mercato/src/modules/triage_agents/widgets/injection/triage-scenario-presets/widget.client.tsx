"use client"

import * as React from 'react'
import { Sparkles } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { ScenarioPresetsDialog } from '../../../components/ScenarioPresetsDialog'

export default function TriageScenarioPresetsWidget() {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} data-testid="triage-send-scenario">
        <Sparkles className="size-4" aria-hidden />
        {t('triage_agents.scenarios.open', 'Send demo scenario')}
      </Button>
      {open ? <ScenarioPresetsDialog open={open} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
