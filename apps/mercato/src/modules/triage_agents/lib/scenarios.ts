import type { ScenarioKey } from '../data/validators'

export type TriageScenario = {
  key: ScenarioKey
  persona: string
  fromName: string
  fromEmail: string
  subject: string
  body: string
  expectedRoute: 'assisted' | 'manual'
  expectedReasonCode: string | null
}

export const TRIAGE_SCENARIOS: ReadonlyArray<TriageScenario> = [
  {
    key: 'overpayment_refund',
    persona: 'Anna Carter',
    fromName: 'Anna Carter',
    fromEmail: 'anna.carter@example.com',
    subject: 'Refund of overpayment for booking ABC123',
    body:
      'Hello,\n\nI paid the second instalment for booking ABC123 twice by mistake. Please refund the overpayment on booking ABC123 to my account DE89 3704 0044 0532 0130 00.\n\nThank you,\nAnna Carter',
    expectedRoute: 'assisted',
    expectedReasonCode: null,
  },
  {
    key: 'payment_confirmed',
    persona: 'Peter Brooks',
    fromName: 'Peter Brooks',
    fromEmail: 'peter.brooks@example.com',
    subject: 'Bank transfer confirmation',
    body:
      'Hello,\n\nAttached is the confirmation of my bank transfer for our trip to the Algarve. Could you please confirm that you received the payment?\n\nBest regards,\nPeter Brooks',
    expectedRoute: 'assisted',
    expectedReasonCode: null,
  },
  {
    key: 'payment_not_visible',
    persona: 'Maria Lopez',
    fromName: 'Maria Lopez',
    fromEmail: 'maria.lopez@example.com',
    subject: 'Payment confirmation for my trip',
    body:
      'Hi,\n\nI am sending the payment confirmation for my trip to Tenerife. Please confirm that my booking is now fully paid.\n\nKind regards,\nMaria Lopez',
    expectedRoute: 'assisted',
    expectedReasonCode: 'payment_not_visible',
  },
  {
    key: 'room_preference',
    persona: 'Emma Wilson',
    fromName: 'Emma Wilson',
    fromEmail: 'emma.wilson@example.com',
    subject: 'Quiet room request',
    body:
      'Hello,\n\nCould we get a room in a quiet part of Hotel Aurora? We are travelling with a small child and would appreciate a calm location.\n\nThanks,\nEmma Wilson',
    expectedRoute: 'manual',
    expectedReasonCode: 'topic_manual_only',
  },
  {
    key: 'hotel_complaint',
    persona: 'Tom Walker',
    fromName: 'Tom Walker',
    fromEmail: 'tom.walker@example.com',
    subject: 'Complaint about our stay',
    body:
      'Hello,\n\nOur room at the hotel was dirty when we arrived and the air-conditioning was broken for the whole week. Nobody fixed it despite several requests at the reception. I expect an explanation and compensation.\n\nTom Walker',
    expectedRoute: 'manual',
    expectedReasonCode: 'topic_manual_only',
  },
  {
    key: 'ambiguous_date_change',
    persona: 'John Miller',
    fromName: 'John Miller',
    fromEmail: 'john.miller@example.com',
    subject: 'Change of travel date',
    body: 'Hello,\n\nCan I change the date of my trip?\n\nThanks,\nJohn Miller',
    expectedRoute: 'manual',
    expectedReasonCode: 'reservation_ambiguous',
  },
]

export function findScenario(key: string): TriageScenario | null {
  return TRIAGE_SCENARIOS.find((scenario) => scenario.key === key) ?? null
}
