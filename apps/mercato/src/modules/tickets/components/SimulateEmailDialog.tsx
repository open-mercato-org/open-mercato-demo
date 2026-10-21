"use client"

import * as React from 'react'
import { useRouter } from 'next/navigation'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { ticketDetailPath } from './ticketTypes'

export type SimulateEmailValues = {
  fromEmail: string
  fromName: string
  subject: string
  body: string
  inReplyTo: string
}

type SimulateResponse = {
  ticketId: string
  number: string
  created: boolean
}

export type SimulateEmailDialogProps = {
  open: boolean
  onClose: () => void
  initialValues?: Partial<SimulateEmailValues>
}

export function buildSimulatePayload(values: Partial<SimulateEmailValues>): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    fromEmail: (values.fromEmail ?? '').trim(),
    subject: (values.subject ?? '').trim(),
    body: (values.body ?? '').trim(),
  }
  const fromName = values.fromName?.trim()
  if (fromName) payload.fromName = fromName
  const inReplyTo = values.inReplyTo?.trim()
  if (inReplyTo) payload.inReplyTo = inReplyTo
  return payload
}

export function SimulateEmailDialog({ open, onClose, initialValues }: SimulateEmailDialogProps) {
  const t = useT()
  const router = useRouter()

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'fromEmail', label: t('tickets.simulate.fields.fromEmail', 'From (email)'), type: 'text', required: true, layout: 'half' },
    { id: 'fromName', label: t('tickets.simulate.fields.fromName', 'From (name)'), type: 'text', layout: 'half' },
    { id: 'subject', label: t('tickets.simulate.fields.subject', 'Subject'), type: 'text', required: true },
    { id: 'body', label: t('tickets.simulate.fields.body', 'Body'), type: 'textarea', required: true, rows: 8 },
    {
      id: 'inReplyTo',
      label: t('tickets.simulate.fields.inReplyTo', 'In-Reply-To (optional)'),
      type: 'text',
      placeholder: '<message-id@example.com>',
    },
  ], [t])

  const handleSubmit = React.useCallback(async (values: SimulateEmailValues) => {
    const call = await apiCallOrThrow<SimulateResponse>('/api/tickets/intake/simulate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildSimulatePayload(values)),
    })
    const result = call.result
    if (result) {
      flash(
        result.created
          ? t('tickets.simulate.flash.created', 'Ticket {number} created.', { number: result.number })
          : t('tickets.simulate.flash.appended', 'Message added to ticket {number}.', { number: result.number }),
        'success',
      )
      onClose()
      router.push(ticketDetailPath(result.ticketId))
      return
    }
    onClose()
  }, [onClose, router, t])

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
      const form = event.currentTarget.querySelector('form')
      if (form) {
        event.preventDefault()
        form.requestSubmit()
      }
    }
  }, [])

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-2xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('tickets.simulate.title', 'Simulate inbound email')}</DialogTitle>
          <DialogDescription>
            {t('tickets.simulate.description', 'Runs the regular email intake: replies with a known message id or a [TCK-…] subject token are appended to the existing ticket.')}
          </DialogDescription>
        </DialogHeader>
        <CrudForm<SimulateEmailValues>
          embedded
          fields={fields}
          initialValues={initialValues}
          submitLabel={t('tickets.simulate.submit', 'Send email')}
          onSubmit={handleSubmit}
          extraActions={(
            <Button type="button" variant="outline" onClick={onClose}>
              {t('tickets.common.cancel', 'Cancel')}
            </Button>
          )}
        />
      </DialogContent>
    </Dialog>
  )
}
