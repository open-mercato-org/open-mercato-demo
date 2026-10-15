"use client"

import * as React from 'react'
import { useT } from '@open-mercato/shared/lib/i18n/context'
import { useConfirmDialog } from '@open-mercato/ui/backend/confirm-dialog'
import { useGuardedMutation } from '@open-mercato/ui/backend/injection/useGuardedMutation'
import { deleteCrud } from '@open-mercato/ui/backend/utils/crud'
import { withScopedApiRequestHeaders } from '@open-mercato/ui/backend/utils/apiCall'
import { buildOptimisticLockHeader } from '@open-mercato/ui/backend/utils/optimisticLock'
import { surfaceRecordConflict } from '@open-mercato/ui/backend/conflicts'
import { flash } from '@open-mercato/ui/backend/FlashMessages'

export type DeletableTicket = {
  id: string
  number?: string | null
  subject?: string | null
  updatedAt?: string | null
}

type TicketDeleteContext = {
  formId: string
  resourceKind: 'tickets.ticket'
  resourceId: string
  retryLastMutation: () => Promise<boolean>
}

export function useTicketDelete(contextId: string) {
  const t = useT()
  const { confirm, ConfirmDialogElement } = useConfirmDialog()
  const { runMutation, retryLastMutation } = useGuardedMutation<TicketDeleteContext>({ contextId })

  const deleteTicket = React.useCallback(async (ticket: DeletableTicket): Promise<boolean> => {
    const label = [ticket.number, ticket.subject].filter(Boolean).join(' · ')
    const approved = await confirm({
      title: t('tickets.delete.confirmTitle', 'Delete ticket?'),
      description: t('tickets.delete.confirmDescription', '{ticket} and its conversation will be removed. You can undo this from the action log.', { ticket: label || ticket.id }),
      confirmText: t('tickets.delete.confirm', 'Delete ticket'),
      cancelText: t('tickets.delete.cancel', 'Cancel'),
      variant: 'destructive',
    })
    if (!approved) return false
    try {
      await runMutation({
        operation: () => withScopedApiRequestHeaders(
          buildOptimisticLockHeader(ticket.updatedAt ?? undefined),
          () => deleteCrud('tickets/tickets', { id: ticket.id }),
        ),
        context: {
          formId: contextId,
          resourceKind: 'tickets.ticket',
          resourceId: ticket.id,
          retryLastMutation,
        },
        mutationPayload: { id: ticket.id, operation: 'deleteTicket' },
      })
    } catch (err) {
      if (!surfaceRecordConflict(err, t)) {
        flash(
          err instanceof Error && err.message.trim().length > 0
            ? err.message
            : t('tickets.delete.error', 'Failed to delete the ticket.'),
          'error',
        )
      }
      return false
    }
    flash(t('tickets.delete.success', 'Ticket deleted.'), 'success')
    return true
  }, [confirm, contextId, retryLastMutation, runMutation, t])

  return { deleteTicket, ConfirmDialogElement }
}
