"use client"

import * as React from 'react'
import { MailPlus } from 'lucide-react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { Button } from '@open-mercato/ui/primitives/button'
import { SimulateEmailDialog } from '../../../components/SimulateEmailDialog'

export default function SimulateEmailToolbarWidget() {
  const t = useT()
  const [open, setOpen] = React.useState(false)
  return (
    <>
      <Button type="button" variant="outline" onClick={() => setOpen(true)} data-testid="tickets-simulate-email">
        <MailPlus className="size-4" aria-hidden />
        {t('tickets.simulate.open', 'Simulate inbound email')}
      </Button>
      {open ? <SimulateEmailDialog open={open} onClose={() => setOpen(false)} /> : null}
    </>
  )
}
