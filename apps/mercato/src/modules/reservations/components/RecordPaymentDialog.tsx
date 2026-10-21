"use client"

import * as React from 'react'
import { z } from 'zod'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { submitDialogFormOnModEnter } from './dialogKeyboard'
import { PAYMENT_METHODS, PAYMENT_STATUSES } from '../data/constants'

const CONTEXT_ID = 'reservations:payment-record'

type RecordPaymentFormValues = {
  amount: number | string
  method: string
  status: string
  externalReference: string
}

type RecordPaymentDialogProps = {
  open: boolean
  reservationId: string
  bookingNumber: string
  currencyCode: string
  suggestedAmount: number
  onClose: () => void
  onCreated: () => void
}

const paymentSchema = z.object({
  amount: z.coerce.number({ message: 'reservations.payment.errors.amountRequired' }).positive('reservations.payment.errors.amountPositive'),
  method: z.enum(PAYMENT_METHODS),
  status: z.enum(PAYMENT_STATUSES),
  externalReference: z.string().trim().max(200).optional(),
}) as unknown as z.ZodType<RecordPaymentFormValues>

export function RecordPaymentDialog({
  open,
  reservationId,
  bookingNumber,
  currencyCode,
  suggestedAmount,
  onClose,
  onCreated,
}: RecordPaymentDialogProps) {
  const t = useT()
  const [formKey, setFormKey] = React.useState(0)
  React.useEffect(() => {
    if (!open) setFormKey((current) => current + 1)
  }, [open])

  const { runMutation, retryLastMutation } = useGuardedMutation<{
    formId: string
    resourceKind: string
    resourceId: string
    retryLastMutation: () => Promise<boolean>
  }>({
    contextId: CONTEXT_ID,
    blockedMessage: t('ui.forms.flash.saveBlocked', 'Save blocked by validation'),
  })

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'amount',
      label: t('reservations.payment.fields.amount', 'Amount ({currency})', { currency: currencyCode }),
      type: 'number',
      required: true,
    },
    {
      id: 'method',
      label: t('reservations.payment.fields.method', 'Method'),
      type: 'select',
      options: PAYMENT_METHODS.map((method) => ({ value: method, label: t(`reservations.paymentMethod.${method}`, method) })),
    },
    {
      id: 'status',
      label: t('reservations.payment.fields.status', 'Status'),
      type: 'select',
      options: PAYMENT_STATUSES.map((status) => ({ value: status, label: t(`reservations.paymentStatus.${status}`, status) })),
    },
    {
      id: 'externalReference',
      label: t('reservations.payment.fields.reference', 'Transfer title / bank reference'),
      type: 'text',
    },
  ], [currencyCode, t])

  const initialValues = React.useMemo<Partial<RecordPaymentFormValues>>(
    () => ({ amount: suggestedAmount > 0 ? suggestedAmount : '', method: 'transfer', status: 'booked', externalReference: '' }),
    [suggestedAmount],
  )

  const handleSubmit = React.useCallback(async (values: RecordPaymentFormValues) => {
    const payload = {
      reservationId,
      amount: Number(values.amount),
      currencyCode,
      method: values.method,
      status: values.status,
      externalReference: values.externalReference?.trim() ? values.externalReference.trim() : null,
    }
    await runMutation({
      operation: () => createCrud('reservations/payments', payload),
      mutationPayload: payload,
      context: {
        formId: CONTEXT_ID,
        resourceKind: 'reservations.reservation',
        resourceId: reservationId,
        retryLastMutation,
      },
    })
    flash(t('reservations.payment.flash.recorded', 'Payment recorded'), 'success')
    onCreated()
    onClose()
  }, [currencyCode, onClose, onCreated, reservationId, retryLastMutation, runMutation, t])

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-lg" onKeyDown={submitDialogFormOnModEnter}>
        <DialogHeader>
          <DialogTitle>{t('reservations.payment.dialog.title', 'Record payment')}</DialogTitle>
          <DialogDescription>
            {t('reservations.payment.dialog.description', 'Booking {bookingNumber}', { bookingNumber })}
          </DialogDescription>
        </DialogHeader>
        <CrudForm<RecordPaymentFormValues>
          key={`${reservationId}:${formKey}`}
          embedded
          fields={fields}
          schema={paymentSchema}
          initialValues={initialValues}
          submitLabel={t('reservations.payment.dialog.submit', 'Record payment')}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}

export default RecordPaymentDialog
