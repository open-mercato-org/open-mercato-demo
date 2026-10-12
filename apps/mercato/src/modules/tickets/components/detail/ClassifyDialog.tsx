"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { apiCallOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { createCrudFormError } from '@open-mercato/ui/backend/utils/serverErrors'
import { Button } from '@open-mercato/ui/primitives/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@open-mercato/ui/primitives/select'
import { LoadingMessage } from '@open-mercato/ui/backend/detail'
import { TICKET_PRIORITIES } from '../../data/constants'
import { ticketApiPath, type TicketRow } from '../ticketTypes'
import { buildClassifyPayload, type ClassifyFormValues } from '../../lib/classifyPayload'
import {
  kbCategoryOptions,
  kbSubcategoryOptions,
  kbTopicOptions,
  type KbCategory,
  type KbOption,
} from '../../lib/kbTaxonomy'
import { useKbTaxonomy } from './useKbTaxonomy'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const CLEAR_VALUE = '__tickets_taxonomy_clear__'

export { buildClassifyPayload }

type TaxonomySelectProps = {
  id: string
  value: unknown
  options: KbOption[]
  disabled?: boolean
  placeholder: string
  clearLabel: string
  onChange: (next: string) => void
}

function TaxonomySelect({ id, value, options, disabled, placeholder, clearLabel, onChange }: TaxonomySelectProps) {
  const current = typeof value === 'string' ? value : ''
  return (
    <Select
      key={`${id}:${current}`}
      value={current}
      onValueChange={(next) => onChange(next === CLEAR_VALUE ? '' : next)}
      disabled={disabled}
    >
      <SelectTrigger id={id} data-crud-focus-target="" data-testid={`classify-${id}`}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {current ? <SelectItem value={CLEAR_VALUE}>{clearLabel}</SelectItem> : null}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

function buildTaxonomyFields(taxonomy: KbCategory[], t: ReturnType<typeof useT>): CrudField[] {
  const placeholder = t('tickets.classify.taxonomy.placeholder', 'Select…')
  const clearLabel = t('tickets.classify.taxonomy.clear', '— Clear —')
  return [
    {
      id: 'categoryKey',
      label: t('tickets.classify.fields.category', 'Category'),
      type: 'custom',
      layout: 'third',
      component: ({ id, value, setValue, setFormValue, disabled }) => (
        <TaxonomySelect
          id={id}
          value={value}
          options={kbCategoryOptions(taxonomy, value)}
          disabled={disabled}
          placeholder={placeholder}
          clearLabel={clearLabel}
          onChange={(next) => {
            setValue(next)
            setFormValue?.('subcategoryKey', '')
            setFormValue?.('topicKey', '')
          }}
        />
      ),
    },
    {
      id: 'subcategoryKey',
      label: t('tickets.classify.fields.subcategory', 'Subcategory'),
      type: 'custom',
      layout: 'third',
      component: ({ id, value, values, setValue, setFormValue, disabled }) => (
        <TaxonomySelect
          id={id}
          value={value}
          options={kbSubcategoryOptions(taxonomy, values?.categoryKey, value)}
          disabled={disabled || !values?.categoryKey}
          placeholder={placeholder}
          clearLabel={clearLabel}
          onChange={(next) => {
            setValue(next)
            setFormValue?.('topicKey', '')
          }}
        />
      ),
    },
    {
      id: 'topicKey',
      label: t('tickets.classify.fields.topic', 'Topic'),
      type: 'custom',
      layout: 'third',
      component: ({ id, value, values, setValue, disabled }) => (
        <TaxonomySelect
          id={id}
          value={value}
          options={kbTopicOptions(taxonomy, values?.categoryKey, values?.subcategoryKey, value)}
          disabled={disabled || !values?.subcategoryKey}
          placeholder={placeholder}
          clearLabel={clearLabel}
          onChange={setValue}
        />
      ),
    },
  ]
}

function buildFreeTextFields(t: ReturnType<typeof useT>): CrudField[] {
  return [
    { id: 'categoryKey', label: t('tickets.classify.fields.categoryKey', 'Category key'), type: 'text', layout: 'third' },
    { id: 'subcategoryKey', label: t('tickets.classify.fields.subcategoryKey', 'Subcategory key'), type: 'text', layout: 'third' },
    { id: 'topicKey', label: t('tickets.classify.fields.topicKey', 'Topic key'), type: 'text', layout: 'third' },
    { id: 'categoryPathSnapshot', label: t('tickets.classify.fields.categoryPath', 'Category path'), type: 'text' },
  ]
}

export type ClassifyDialogProps = {
  open: boolean
  ticket: TicketRow
  onClose: () => void
  onSaved: () => Promise<void> | void
}

export function ClassifyDialog({ open, ticket, onClose, onSaved }: ClassifyDialogProps) {
  const t = useT()

  const taxonomyState = useKbTaxonomy(open)
  const taxonomy = taxonomyState.status === 'ready' ? taxonomyState.taxonomy : null

  const fields = React.useMemo<CrudField[]>(() => [
    ...(taxonomy ? buildTaxonomyFields(taxonomy, t) : buildFreeTextFields(t)),
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
  ], [t, taxonomy])

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
    const payload = taxonomy
      ? buildClassifyPayload({ ...values, categoryPathSnapshot: ticket.categoryPathSnapshot ?? '' }, taxonomy)
      : buildClassifyPayload(values)
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
  }, [onClose, onSaved, t, taxonomy, ticket.categoryPathSnapshot, ticket.id])

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
        {taxonomyState.status === 'loading' ? (
          <LoadingMessage label={t('tickets.classify.taxonomy.loading', 'Loading categories…')} />
        ) : (
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
        )}
      </DialogContent>
    </Dialog>
  )
}
