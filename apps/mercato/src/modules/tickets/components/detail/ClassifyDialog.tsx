"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { TICKET_PRIORITIES } from '../../data/constants'
import { ticketApiPath, type TicketRow } from '../ticketTypes'

type ClassifyFormValues = {
  id: string
  updatedAt: string | null
  customerPersonId: string
  reservationId: string
  reservationNumberSnapshot: string
  categoryKey: string
  subcategoryKey: string
  topicKey: string
  categoryPathSnapshot: string
  priority: string
  priorityReason: string
  summary: string
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function nullable(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function buildClassifyPayload(values: Partial<ClassifyFormValues>): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    source: 'manual',
    customerPersonId: nullable(values.customerPersonId),
    reservationId: nullable(values.reservationId),
    reservationNumberSnapshot: nullable(values.reservationNumberSnapshot),
    categoryKey: nullable(values.categoryKey),
    subcategoryKey: nullable(values.subcategoryKey),
    topicKey: nullable(values.topicKey),
    categoryPathSnapshot: nullable(values.categoryPathSnapshot),
    priorityReason: nullable(values.priorityReason),
    summary: nullable(values.summary),
  }
  const priority = nullable(values.priority)
  if (priority) payload.priority = priority
  return payload
}

export type ClassifyDialogProps = {
  open: boolean
  ticket: TicketRow
  onClose: () => void
  onSaved: () => Promise<void> | void
}

export function ClassifyDialog({ open, ticket, onClose, onSaved }: ClassifyDialogProps) {
  const t = useT()

  const fields = React.useMemo<CrudField[]>(() => [
    { id: 'categoryKey', label: t('tickets.classify.fields.categoryKey', 'Category key'), type: 'text', layout: 'third' },
    { id: 'subcategoryKey', label: t('tickets.classify.fields.subcategoryKey', 'Subcategory key'), type: 'text', layout: 'third' },
    { id: 'topicKey', label: t('tickets.classify.fields.topicKey', 'Topic key'), type: 'text', layout: 'third' },
    { id: 'categoryPathSnapshot', label: t('tickets.classify.fields.categoryPath', 'Category path'), type: 'text' },
    {
      id: 'priority',
      label: t('tickets.classify.fields.priority', 'Priority'),
      type: 'select',
      layout: 'half',
      options: TICKET_PRIORITIES.map((priority) => ({ value: priority, label: t(`tickets.priority.${priority}`, priority) })),
    },
    { id: 'priorityReason', label: t('tickets.classify.fields.priorityReason', 'Priority reason'), type: 'text', layout: 'half', maxLength: 200 },
    { id: 'summary', label: t('tickets.classify.fields.summary', 'Summary'), type: 'textarea', rows: 4 },
    { id: 'customerPersonId', label: t('tickets.classify.fields.customerPersonId', 'Customer (person id)'), type: 'text', layout: 'half' },
    { id: 'reservationId', label: t('tickets.classify.fields.reservationId', 'Reservation id'), type: 'text', layout: 'half' },
    { id: 'reservationNumberSnapshot', label: t('tickets.classify.fields.reservationNumber', 'Reservation number'), type: 'text', layout: 'half' },
  ], [t])

  const initialValues = React.useMemo<Partial<ClassifyFormValues>>(() => ({
    id: ticket.id,
    updatedAt: ticket.updatedAt,
    customerPersonId: ticket.customerPersonId ?? '',
    reservationId: ticket.reservationId ?? '',
    reservationNumberSnapshot: ticket.reservationNumberSnapshot ?? '',
    categoryKey: ticket.categoryKey ?? '',
    subcategoryKey: ticket.subcategoryKey ?? '',
    topicKey: ticket.topicKey ?? '',
    categoryPathSnapshot: ticket.categoryPathSnapshot ?? '',
    priority: ticket.priority ?? 'normal',
    priorityReason: ticket.priorityReason ?? '',
    summary: ticket.summary ?? '',
  }), [ticket])

  const handleSubmit = React.useCallback(async (values: ClassifyFormValues) => {
    const payload = buildClassifyPayload(values)
    for (const key of ['customerPersonId', 'reservationId'] as const) {
      const value = payload[key]
      if (typeof value === 'string' && !UUID_PATTERN.test(value)) {
        const message = t('tickets.classify.errors.invalidUuid', 'Enter a valid id or leave the field empty.')
        throw createCrudFormError(message, { [key]: message })
      }
    }
    await apiCallOrThrow(ticketApiPath(ticket.id, 'classify'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    })
    flash(t('tickets.classify.flash.saved', 'Classification saved.'), 'success')
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
      <DialogContent className="max-h-screen overflow-y-auto sm:max-w-2xl" onKeyDown={handleKeyDown}>
        <DialogHeader>
          <DialogTitle>{t('tickets.classify.title', 'Classify ticket')}</DialogTitle>
        </DialogHeader>
        <CrudForm<ClassifyFormValues>
          embedded
          fields={fields}
          initialValues={initialValues}
          optimisticLockUpdatedAt={ticket.updatedAt}
          submitLabel={t('tickets.classify.submit', 'Save classification')}
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
