"use client"

import * as React from 'react'
import { z } from 'zod'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@open-mercato/ui/primitives/dialog'
import { CrudForm, type CrudField } from '@open-mercato/ui/backend/CrudForm'
import { createCrud } from '@open-mercato/ui/backend/utils/crud'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { flash } from '@open-mercato/ui/backend/FlashMessages'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { isValidIban } from '../lib/iban'
import { formatMoney } from './ReservationBadges'

const CONTEXT_ID = 'reservations:refund-request'

export type RefundRequestFormValues = {
  amount: number | string
  bankAccountNumber: string
  reason: string
}

type RefundRequestDialogProps = {
  open: boolean
  reservationId: string
  bookingNumber: string
  currencyCode: string
  overpayment: number
  onClose: () => void
  onCreated: () => void
}

export function buildRefundRequestSchema(overpayment: number) {
  return z.object({
    amount: z.coerce
      .number({ message: 'reservations.refund.errors.amountRequired' })
      .positive('reservations.refund.errors.amountPositive')
      .max(overpayment, 'reservations.errors.refundExceedsOverpayment'),
    bankAccountNumber: z
      .string()
      .trim()
      .min(1, 'reservations.refund.errors.ibanRequired')
      .refine((value) => isValidIban(value), 'reservations.errors.invalidIban'),
    reason: z.string().trim().max(2000).optional(),
  })
}

export function RefundRequestDialog({
  open,
  reservationId,
  bookingNumber,
  currencyCode,
  overpayment,
  onClose,
  onCreated,
}: RefundRequestDialogProps) {
  const t = useT()
  const [formKey, setFormKey] = React.useState(0)
  React.useEffect(() => {
    if (open) setFormKey((current) => current + 1)
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

  const schema = React.useMemo(
    () => buildRefundRequestSchema(overpayment) as unknown as z.ZodType<RefundRequestFormValues>,
    [overpayment],
  )

  const fields = React.useMemo<CrudField[]>(() => [
    {
      id: 'amount',
      label: t('reservations.refund.fields.amount', 'Amount ({currency})', { currency: currencyCode }),
      type: 'number',
      required: true,
      description: t('reservations.refund.fields.amount.help', 'Up to {amount} can be refunded.', {
        amount: formatMoney(overpayment, currencyCode),
      }),
    },
    {
      id: 'bankAccountNumber',
      label: t('reservations.refund.fields.iban', 'Bank account (IBAN)'),
      type: 'text',
      required: true,
      placeholder: t('reservations.refund.fields.iban.placeholder', 'DE89 3704 0044 0532 0130 00'),
    },
    {
      id: 'reason',
      label: t('reservations.refund.fields.reason', 'Reason'),
      type: 'textarea',
      placeholder: t('reservations.refund.fields.reason.placeholder', 'e.g. Overpayment on the final instalment'),
    },
  ], [currencyCode, overpayment, t])

  const initialValues = React.useMemo<Partial<RefundRequestFormValues>>(
    () => ({ amount: overpayment > 0 ? overpayment : '', bankAccountNumber: '', reason: '' }),
    [overpayment],
  )

  const handleSubmit = React.useCallback(async (values: RefundRequestFormValues) => {
    const payload = {
      reservationId,
      amount: Number(values.amount),
      currencyCode,
      bankAccountNumber: values.bankAccountNumber,
      reason: values.reason?.trim() ? values.reason.trim() : null,
    }
    await runMutation({
      operation: () => createCrud('reservations/refunds', payload),
      mutationPayload: payload,
      context: {
        formId: CONTEXT_ID,
        resourceKind: 'reservations.reservation',
        resourceId: reservationId,
        retryLastMutation,
      },
    })
    flash(t('reservations.refund.flash.requested', 'Refund requested'), 'success')
    onCreated()
    onClose()
  }, [currencyCode, onClose, onCreated, reservationId, retryLastMutation, runMutation, t])

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('reservations.refund.dialog.title', 'Request refund')}</DialogTitle>
          <DialogDescription>
            {t('reservations.refund.dialog.description', 'Booking {bookingNumber} · overpayment {amount}', {
              bookingNumber,
              amount: formatMoney(overpayment, currencyCode),
            })}
          </DialogDescription>
        </DialogHeader>
        <CrudForm<RefundRequestFormValues>
          key={`${reservationId}:${formKey}`}
          embedded
          fields={fields}
          schema={schema}
          initialValues={initialValues}
          submitLabel={t('reservations.refund.dialog.submit', 'Request refund')}
          onSubmit={handleSubmit}
        />
      </DialogContent>
    </Dialog>
  )
}

export default RefundRequestDialog
