/** @jest-environment node */
import {
  classifierResultSchema,
  contextIdentifierResultSchema,
  resolutionAdvisorResultSchema,
} from '../data/validators'
import { containsIban, maskBankAccount } from '../lib/pii'

const TICKET_ID = '11111111-1111-4111-8111-111111111111'
const PERSON_ID = '22222222-2222-4222-8222-222222222222'
const RESERVATION_ID = '33333333-3333-4333-8333-333333333333'
const ARTICLE = 'payments.refunds.overpayment_refund@3'

const identification = {
  customer: { personId: PERSON_ID, match: 'confirmed' },
  reservation: {
    reservationId: RESERVATION_ID,
    bookingNumber: 'ABC123',
    match: 'explicit_number_verified',
    candidates: [],
    departureDate: '2026-10-15',
    daysToDeparture: 3,
  },
  evidence: [{ source: 'ticket', quote: 'booking ABC123' }],
  uncertainty: [],
  confidence: 0.95,
}

const classification = {
  categoryKey: 'payments',
  subcategoryKey: 'payments.refunds',
  topicKey: 'payments.refunds.overpayment_refund',
  topicVersion: 3,
  summary: 'The customer paid booking ABC123 twice and asks for the overpayment back. An IBAN was provided.',
  intent: 'refund an overpayment',
  urgencySignal: 'none',
  urgencyEvidence: null,
  automationLevel: 'assisted',
  extracted: { refundAmount: null, bankAccount: 'DE89 3704 0044 0532 0130 00', paymentDate: null },
  uncertainty: [],
  confidence: 0.92,
}

function proposal(overrides: Record<string, unknown> = {}) {
  return {
    kind: 'proposal',
    proposal: {
      options: [
        {
          id: 'refund_and_reply',
          label: 'Verify the overpayment and request a refund',
          rationale: 'All required checks passed.',
          confidence: 0.9,
          actions: [
            {
              type: 'reservations.refund.request',
              payload: {
                reservationId: RESERVATION_ID,
                amount: 350,
                currencyCode: 'EUR',
                bankAccountNumber: 'DE89370400440532013000',
                reason: 'Overpayment per reservation balance',
                relatedTicketId: TICKET_ID,
                sourceType: 'agent_proposal',
              },
              citations: [`${ARTICLE}#S4`],
            },
            {
              type: 'tickets.reply.send',
              payload: { ticketId: TICKET_ID, subject: 'Re: refund', body: 'Dear Anna, …', resolveAfterSend: false },
              citations: [`${ARTICLE}#S5`],
            },
          ],
        },
      ],
      rationale: 'The overpayment is confirmed.',
      evidence: {
        checks: [
          { key: 'owner_verified', step: 'S1', passed: true, evidence: 'sender owns ABC123' },
          { key: 'overpayment_confirmed', step: 'S2', passed: true, evidence: 'paid 2,750 > total 2,400' },
          { key: 'iban_present', step: 'S3', passed: true, evidence: 'IBAN provided' },
        ],
        citations: [{ kind: 'kb', ref: ARTICLE, label: 'Payments › Refunds › Overpayment refund (v3)', steps: ['S1', 'S2', 'S3', 'S4', 'S5'] }],
        segments: [
          { source: 'template', ref: `${ARTICLE}#reply_template`, text: 'Dear Anna,' },
          { source: 'generated', ref: null, text: 'Thank you for your patience.' },
        ],
        uncertainty: [],
      },
      ...overrides,
    },
  }
}

describe('context identifier result schema', () => {
  it('accepts a verified identification', () => {
    expect(contextIdentifierResultSchema.safeParse({ kind: 'research', data: identification }).success).toBe(true)
  })

  it('rejects a reservation id on an identity mismatch', () => {
    const data = { ...identification, reservation: { ...identification.reservation, match: 'identity_mismatch' } }
    expect(contextIdentifierResultSchema.safeParse({ kind: 'research', data }).success).toBe(false)
  })

  it('requires two candidates for an ambiguous match', () => {
    const data = {
      ...identification,
      reservation: { ...identification.reservation, reservationId: null, match: 'ambiguous', candidates: [] },
    }
    expect(contextIdentifierResultSchema.safeParse({ kind: 'research', data }).success).toBe(false)
  })
})

describe('classifier result schema', () => {
  it('accepts a short summary', () => {
    expect(classifierResultSchema.safeParse({ kind: 'research', data: classification }).success).toBe(true)
  })

  it('rejects a full IBAN in the summary', () => {
    const data = { ...classification, summary: 'Refund to DE89 3704 0044 0532 0130 00 please.' }
    expect(classifierResultSchema.safeParse({ kind: 'research', data }).success).toBe(false)
  })

  it('rejects an over-long or four-sentence summary', () => {
    expect(classifierResultSchema.safeParse({ kind: 'research', data: { ...classification, summary: 'x'.repeat(601) } }).success).toBe(false)
    expect(classifierResultSchema.safeParse({ kind: 'research', data: { ...classification, summary: 'One. Two. Three. Four.' } }).success).toBe(false)
  })

  it('rejects a topic outside its subcategory', () => {
    expect(classifierResultSchema.safeParse({ kind: 'research', data: { ...classification, topicKey: 'booking.changes.date_change' } }).success).toBe(false)
  })
})

describe('resolution advisor result schema', () => {
  it('accepts a grounded proposal', () => {
    const result = resolutionAdvisorResultSchema.safeParse(proposal())
    expect(result.error?.issues ?? []).toEqual([])
  })

  it('rejects an action without citations', () => {
    const value = proposal()
    value.proposal.options[0].actions[0].citations = []
    expect(resolutionAdvisorResultSchema.safeParse(value).success).toBe(false)
  })

  it('rejects a citation of an article the evidence does not list', () => {
    const value = proposal()
    value.proposal.options[0].actions[0].citations = ['payments.incoming.payment_confirmation@1#S2']
    expect(resolutionAdvisorResultSchema.safeParse(value).success).toBe(false)
  })

  it('rejects a proposal next to a failed check', () => {
    const value = proposal()
    value.proposal.evidence.checks[1].passed = false
    expect(resolutionAdvisorResultSchema.safeParse(value).success).toBe(false)
  })

  it('accepts none_proposed only with a blocking reason', () => {
    const base = proposal({ options: [] })
    expect(resolutionAdvisorResultSchema.safeParse(base).success).toBe(false)
    base.proposal.evidence.uncertainty = [{ code: 'payment_not_visible', message: 'No booked payment yet.', blocking: true }]
    expect(resolutionAdvisorResultSchema.safeParse(base).success).toBe(true)
  })

  it('rejects an action type outside the allowed vocabulary', () => {
    const value = proposal()
    const actions = value.proposal.options[0].actions as Array<Record<string, unknown>>
    actions[0] = { type: 'customers.update_deal_stage', payload: {}, citations: [`${ARTICLE}#S4`] }
    expect(resolutionAdvisorResultSchema.safeParse(value).success).toBe(false)
  })
})

describe('pii helpers', () => {
  it('detects IBANs with and without spaces and ignores masked ones', () => {
    expect(containsIban('DE89370400440532013000')).toBe(true)
    expect(containsIban('to DE89 3704 0044 0532 0130 00 please')).toBe(true)
    expect(containsIban('DE•• •••• 3000')).toBe(false)
    expect(containsIban('booking ABC123 on 2026-10-15')).toBe(false)
  })

  it('masks bank accounts to the country prefix and last four digits', () => {
    expect(maskBankAccount('DE89 3704 0044 0532 0130 00')).toBe('DE•• •••• 3000')
  })
})
