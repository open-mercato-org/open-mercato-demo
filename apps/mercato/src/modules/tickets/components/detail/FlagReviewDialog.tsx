"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { ticketApiPath, type TicketQueueOption, type TicketRow } from '../ticketTypes'

type FlagFormValues = {
  id: string
  updatedAt: string | null
  reasonCode: string
  reason: string
  targetQueueKey: string
}

export type FlagReviewDialogProps = {
  open: boolean
  ticket: TicketRow
  queues: TicketQueueOption[]
  onClose: () => void
  onSaved: () => Promise<void> | void
}

const KEEP_QUEUE = '__keep__'

export function FlagReviewDialog({ open, ticket, queues, onClose, onSaved }: FlagReviewDialogProps) {
  const t = useT()

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'reasonCode',
      label: t('tickets.flag.fields.reasonCode', 'Reason code'),
      type: 'text',
      required: true,
      layout: 'half',
      placeholder: t('tickets.flag.fields.reasonCodePlaceholder', 'e.g. needs_verification'),
    },
    {
      id: 'targetQueueKey',
      label: t('tickets.flag.fields.targetQueue', 'Move to queue'),
      type: 'select',
      layout: 'half',
      options: [
        { value: KEEP_QUEUE, label: t('tickets.flag.fields.keepQueue', 'Keep current queue') },
        ...queues.map((queue) => ({ value: queue.value, label: queue.label })),
      ],
    },
    {
      id: 'reason',
      label: t('tickets.flag.fields.reason', 'Reason'),
      type: 'textarea',
      required: true,
      rows: 4,
    },
  ], [queues, t])

  const initialValues = React.useMemo<Partial<FlagFormValues>>(() => ({
    id: ticket.id,
    updatedAt: ticket.updatedAt,
    reasonCode: ticket.manualReviewReasonCode ?? '',
    reason: ticket.manualReviewReason ?? '',
    targetQueueKey: KEEP_QUEUE,
  }), [ticket])

  const handleSubmit = React.useCallback(async (values: FlagFormValues) => {
    const payload: Record<string, unknown> = {
      reasonCode: values.reasonCode.trim(),
      reason: values.reason.trim(),
    }
    if (values.targetQueueKey && values.targetQueueKey !== KEEP_QUEUE) payload.targetQueueKey = values.targetQueueKey
    await apiCallOrThrow(ticketApiPath(ticket.id, 'flag-manual-review'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    flash(t('tickets.flag.flash.saved', 'Ticket flagged for manual review.'), 'success')
    await onSaved()
    onClose()
  }, [onClose, onSaved, t, ticket.id])

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
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('tickets.flag.title', 'Flag for manual review')}</DialogTitle>
        </DialogHeader>
        <CrudForm<FlagFormValues>
          embedded
          fields={fields}
          initialValues={initialValues}
          optimisticLockUpdatedAt={ticket.updatedAt}
          submitLabel={t('tickets.flag.submit', 'Flag ticket')}
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
