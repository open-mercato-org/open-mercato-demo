import { describe, test, expect } from '@jest/globals'
import {
  normalizeProposalEnvelope,
  readProposalActions,
  readProposalEvidence,
  replaceOptionActions,
} from '../data/proposalEnvelope'
import { PROPOSAL_EVIDENCE_MAX_BYTES, agentProposalSchema, baseAgentResultSchema } from '../data/validators'
import { actionEditsToActions, deriveActionEdits, reassembleProposalPayload } from '../components/proposalEdit'

/**
 * AO delta spec §F — the optional `evidence` block and per-action `citations` must
 * survive every path a proposal payload travels: agent result validation, envelope
 * normalization (persistence), and the operator's structured edit (reassembly).
 */

const EVIDENCE = {
  checks: [{ key: 'overpayment_confirmed', step: 'S2', passed: true, evidence: 'paid 2,750 > total 2,400' }],
  citations: [{ kind: 'kb', ref: 'refund-overpayment@3', label: 'Refund of an overpayment', steps: ['S1', 'S2'] }],
  segments: [
    { source: 'template' as const, ref: 'refund-overpayment@3#reply', text: 'Dear customer,' },
    { source: 'generated' as const, text: 'we refund 350 EUR.' },
  ],
  uncertainty: [{ code: 'iban_unverified', message: 'IBAN taken from the email body', blocking: false }],
}

const PAYLOAD = {
  rationale: 'Overpayment is visible in the booking.',
  evidence: EVIDENCE,
  options: [
    {
      id: 'refund',
      label: 'Refund',
      confidence: 0.9,
      actions: [
        {
          type: 'reservations.refund.request',
          payload: { amount: 350, note: 'overpayment' },
          citations: ['refund-overpayment@3#S2', 'check:overpayment_confirmed'],
        },
      ],
    },
  ],
}

describe('proposal evidence envelope', () => {
  test('normalization keeps the evidence block and the action citations', () => {
    const normalized = normalizeProposalEnvelope(PAYLOAD)
    expect(normalized.evidence).toEqual(EVIDENCE)
    expect(normalized.options[0].actions[0].citations).toEqual(['refund-overpayment@3#S2', 'check:overpayment_confirmed'])
    expect(normalized.rationale).toBe(PAYLOAD.rationale)
  })

  test('a payload stored as decrypted JSON text keeps its evidence too', () => {
    expect(readProposalEvidence(JSON.stringify(PAYLOAD))).toEqual(EVIDENCE)
    expect(normalizeProposalEnvelope(JSON.stringify(PAYLOAD)).evidence).toEqual(EVIDENCE)
  })

  test('a payload without evidence normalizes exactly as before', () => {
    const { evidence, ...withoutEvidence } = PAYLOAD
    expect(evidence).toBeDefined()
    const normalized = normalizeProposalEnvelope(withoutEvidence)
    expect('evidence' in normalized).toBe(false)
  })

  test('the agent result contract accepts and keeps evidence', () => {
    const parsed = baseAgentResultSchema.parse({ kind: 'proposal', proposal: PAYLOAD })
    expect(parsed.kind === 'proposal' ? parsed.proposal.evidence : null).toEqual(EVIDENCE)
  })

  test('evidence over the size cap is rejected by the contract and dropped by normalization', () => {
    const huge = {
      ...PAYLOAD,
      evidence: { segments: [{ source: 'generated', text: 'x'.repeat(PROPOSAL_EVIDENCE_MAX_BYTES + 1) }] },
    }
    expect(agentProposalSchema.safeParse(huge).success).toBe(false)
    const normalized = normalizeProposalEnvelope(huge)
    expect(normalized.evidence).toBeUndefined()
    expect(normalized.options).toHaveLength(1)
  })

  test('a malformed citations list costs the citations, never the action', () => {
    const payload = {
      options: [
        {
          id: 'refund',
          label: 'Refund',
          actions: [{ type: 'reservations.refund.request', payload: { amount: 1 }, citations: [42] }],
        },
      ],
    }
    const actions = readProposalActions(payload, 'refund')
    expect(actions).toEqual([{ type: 'reservations.refund.request', payload: { amount: 1 } }])
  })

  test('replacing the selected option actions keeps the evidence', () => {
    const replaced = replaceOptionActions(PAYLOAD, [{ type: 'reservations.refund.request', payload: { amount: 300 } }], 'refund')
    expect(replaced.evidence).toEqual(EVIDENCE)
  })

  test('an operator edit round-trip keeps evidence and the action citations', () => {
    const edits = deriveActionEdits(PAYLOAD, 'refund')
    expect(edits).not.toBeNull()
    const amended = (edits ?? []).map((edit) => ({
      ...edit,
      fields: edit.fields.map((field) => (field.key === 'amount' ? { ...field, value: 300 } : field)),
    }))
    const reassembled = reassembleProposalPayload(PAYLOAD, actionEditsToActions(amended), 'refund')
    const normalized = normalizeProposalEnvelope(reassembled)
    expect(normalized.evidence).toEqual(EVIDENCE)
    expect(normalized.options[0].actions[0]).toEqual({
      type: 'reservations.refund.request',
      payload: { amount: 300, note: 'overpayment' },
      citations: ['refund-overpayment@3#S2', 'check:overpayment_confirmed'],
    })
  })

  test('strict structured-output nulls normalize to absent keys instead of dropping the evidence block', () => {
    const evidence = readProposalEvidence({
      ...PAYLOAD,
      evidence: {
        checks: [{ key: 'overpayment_confirmed', step: null, passed: true, evidence: 'paid 2,750 > total 2,400' }],
        citations: [{ kind: 'kb', ref: 'refund-overpayment@3', label: null, steps: null, href: null }],
        segments: [{ source: 'generated', ref: null, text: 'we refund 350 EUR.' }],
        uncertainty: [{ code: 'iban_unverified', message: 'IBAN taken from the email body', blocking: null }],
      },
    })
    expect(evidence).toEqual({
      checks: [{ key: 'overpayment_confirmed', passed: true, evidence: 'paid 2,750 > total 2,400' }],
      citations: [{ kind: 'kb', ref: 'refund-overpayment@3' }],
      segments: [{ source: 'generated', text: 'we refund 350 EUR.' }],
      uncertainty: [{ code: 'iban_unverified', message: 'IBAN taken from the email body' }],
    })
  })
})
