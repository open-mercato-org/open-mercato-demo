import type { DecisionFieldOverrides } from '@open-mercato/enterprise/modules/agent_orchestrator/components/decisionCardModel'

export const REFUND_MANAGE_FEATURE = 'reservations.refund.manage'

/** Editors for the triage advisor's action fields (refund request, reply, ticket transition). */
export function buildTriageFieldOverrides(canRevealBankAccount: boolean): DecisionFieldOverrides {
  return {
    'tickets.reply.send.body': { widget: 'long_text' },
    'reservations.refund.request.amount': { widget: 'money' },
    'reservations.refund.request.bankAccountNumber': { widget: 'masked', revealable: canRevealBankAccount },
    '*.ticketId': { widget: 'readonly' },
    '*.reservationId': { widget: 'readonly' },
    '*.relatedTicketId': { widget: 'readonly' },
  }
}
