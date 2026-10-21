/** @jest-environment node */
import { assessKbConsultation, verifyProposalGrounding } from '../lib/grounding'
import { toArticlePolicy } from '../lib/kbArticles'
import { draftStateFromEffects, mergeRunIds, noProposalFlag, readAdviceOutcome } from '../lib/projection'
import { deriveStageArgs } from '../lib/rebuild'
import { matchesTriageStatus } from '../widgets/injection/triage-queue-filter/widget'
import { resolveTriageStatus } from '../components/triageTypes'
import { TRIAGE_SCENARIOS } from '../lib/scenarios'

jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))

const ARTICLE_KEY = 'payments.refunds.overpayment_refund'

const overpaymentArticle = toArticlePolicy(ARTICLE_KEY, 3, {
  title: 'Overpayment refund',
  category: { key: 'payments', name: 'Payments' },
  subcategory: { key: 'payments.refunds', name: 'Refunds' },
  automationLevel: 'assisted',
  procedureSteps: [
    { id: 'S1', text: 'Verify owner', checkKey: 'owner_verified' },
    { id: 'S2', text: 'Confirm overpayment', checkKey: 'overpayment_confirmed' },
    { id: 'S3', text: 'Confirm IBAN', checkKey: 'iban_present' },
    { id: 'S4', text: 'Request refund', actionKey: 'reservations.refund.request' },
    { id: 'S5', text: 'Reply', actionKey: 'tickets.reply.send' },
  ],
  requiredChecks: [{ key: 'owner_verified' }, { key: 'overpayment_confirmed' }, { key: 'iban_present' }],
  recommendedActions: [{ actionKey: 'reservations.refund.request' }, { actionKey: 'tickets.reply.send' }],
})

function payload(overrides: { actionType?: string; checks?: unknown[]; citationSteps?: string[] } = {}) {
  return {
    options: [
      {
        id: 'refund_and_reply',
        label: 'Verify the overpayment and request a refund',
        actions: [
          { type: overrides.actionType ?? 'reservations.refund.request', payload: {}, citations: [`${ARTICLE_KEY}@3#S4`] },
          { type: 'tickets.reply.send', payload: {}, citations: [`${ARTICLE_KEY}@3#S5`] },
        ],
      },
    ],
    evidence: {
      checks: overrides.checks ?? [
        { key: 'owner_verified', step: 'S1', passed: true, evidence: 'ok' },
        { key: 'overpayment_confirmed', step: 'S2', passed: true, evidence: 'ok' },
        { key: 'iban_present', step: 'S3', passed: true, evidence: 'ok' },
      ],
      citations: [{ kind: 'kb', ref: `${ARTICLE_KEY}@3`, label: 'Overpayment refund (v3)', steps: overrides.citationSteps ?? ['S1', 'S2', 'S3', 'S4', 'S5'] }],
      segments: [],
      uncertainty: [],
    },
  }
}

const loader = async (key: string, version: number) => (key === ARTICLE_KEY && version === 3 ? overpaymentArticle : null)

describe('KB grounding verification (fallback)', () => {
  it('verifies a proposal that follows the article', async () => {
    expect(await verifyProposalGrounding(payload(), loader)).toEqual({ state: 'verified', issues: [], articleRefs: [`${ARTICLE_KEY}@3`] })
  })

  it('flags unknown steps, unrecommended actions and missing checks', async () => {
    const verdict = await verifyProposalGrounding(
      payload({ actionType: 'tickets.ticket.transition', checks: [{ key: 'owner_verified', step: 'S1', passed: true }], citationSteps: ['S9'] }),
      loader,
    )
    expect(verdict.state).toBe('unverified')
    expect(verdict.issues.join(' ')).toContain('has no step S9')
    expect(verdict.issues.join(' ')).toContain('tickets.ticket.transition is not recommended')
    expect(verdict.issues.join(' ')).toContain('Required check iban_present')
  })

  it('flags a citation of an article version that does not exist', async () => {
    const value = payload()
    value.evidence.citations[0].ref = `${ARTICLE_KEY}@9`
    const verdict = await verifyProposalGrounding(value, loader)
    expect(verdict.issues[0]).toContain('does not exist')
  })
})

describe('KB consultation check (fail closed)', () => {
  const cited = [`${ARTICLE_KEY}@3`]

  it('passes when the advisor fetched the cited article', () => {
    const result = assessKbConsultation(
      [
        { toolName: 'knowledge_articles__get_article', status: 'ok', requestSummary: { key: ARTICLE_KEY }, responseSummary: { found: true, key: ARTICLE_KEY, version: 3 } },
        { toolName: 'reservations__get_details', status: 'ok', requestSummary: {}, responseSummary: {} },
      ],
      cited,
    )
    expect(result).toEqual({ consulted: true, issues: [], readRefs: [`${ARTICLE_KEY}@3`] })
  })

  it('reads a truncated article response from its preview', () => {
    const preview = JSON.stringify({ found: true, key: ARTICLE_KEY, version: 3, citation: `${ARTICLE_KEY}@3`, article: {} })
    const result = assessKbConsultation(
      [{ toolName: 'knowledge_articles.get_article', status: 'ok', requestSummary: { key: ARTICLE_KEY }, responseSummary: { _truncated: true, preview } }],
      cited,
    )
    expect(result.consulted).toBe(true)
  })

  it('fails when no article was read', () => {
    const result = assessKbConsultation([{ toolName: 'tickets__get_ticket', status: 'ok' }], cited)
    expect(result.consulted).toBe(false)
    expect(result.issues[0]).toContain('did not read the knowledge base article')
  })

  it('fails when the fetch found nothing or errored', () => {
    expect(
      assessKbConsultation(
        [
          { toolName: 'knowledge_articles__get_article', status: 'ok', requestSummary: { key: ARTICLE_KEY }, responseSummary: { found: false, key: ARTICLE_KEY } },
          { toolName: 'knowledge_articles__get_article', status: 'error', requestSummary: { key: ARTICLE_KEY } },
        ],
        cited,
      ).consulted,
    ).toBe(false)
  })

  it('fails when the cited article differs from the one read', () => {
    const result = assessKbConsultation(
      [{ toolName: 'knowledge_articles__get_article', status: 'ok', responseSummary: { found: true, key: 'payments.incoming.payment_confirmation', version: 1 } }],
      cited,
    )
    expect(result.consulted).toBe(false)
    expect(result.issues[0]).toContain(`${ARTICLE_KEY}@3 is cited but was never read`)
  })
})

describe('projection helpers', () => {
  it('reads a none_proposed advice into a manual-review flag', () => {
    const advice = {
      options: [],
      rationale: 'The payment is not booked yet.',
      evidence: { checks: [{ key: 'payment_booked', step: 'S1', passed: false, evidence: 'only a pending payment' }], uncertainty: [{ code: 'payment_not_visible', message: 'The transfer is not booked yet.', blocking: true }] },
    }
    expect(noProposalFlag(advice)).toEqual({ reasonCode: 'payment_not_visible', reason: 'The transfer is not booked yet.' })
    expect(readAdviceOutcome(JSON.stringify(advice)).proposed).toBe(false)
  })

  it('reads the recommended action of a proposal', () => {
    expect(readAdviceOutcome(payload()).recommendedActionLabel).toBe('Verify the overpayment and request a refund')
  })

  it('derives the draft state from effector results', () => {
    expect(draftStateFromEffects({ ok: true, results: [{ type: 'tickets.reply.send', status: 'ok' }] })).toBe('sent')
    expect(draftStateFromEffects({ ok: false, results: [{ type: 'tickets.reply.send', status: 'skipped' }] })).toBe('prepared')
    expect(draftStateFromEffects({ ok: true, results: [] })).toBeNull()
  })

  it('maps run ids by agent', () => {
    expect(mergeRunIds(null, 'triage_agents.classifier', 'r2')).toEqual({ classifier: 'r2' })
  })
})

describe('projection rebuild', () => {
  const base = { ticketId: '11111111-1111-4111-8111-111111111111', ticketNumber: 'TCK-000001' }

  it('rebuilds an assisted, executed triage', () => {
    const args = deriveStageArgs({ ...base, disposition: 'edited', proposalId: '22222222-2222-4222-8222-222222222222', triage_effects: { result: { ok: true, results: [] } } }, 'COMPLETED', 'end')
    expect(args).toMatchObject({ stage: 'done', aiMode: 'assisted', disposition: 'edited' })
  })

  it('rebuilds manual, rejected and failed triages', () => {
    expect(deriveStageArgs({ ...base, triage_route: { result: { route: 'manual' } } }, 'COMPLETED', 'end')).toMatchObject({ stage: 'done', aiMode: 'manual_review' })
    expect(deriveStageArgs({ ...base, disposition: 'rejected' }, 'COMPLETED', 'end')).toMatchObject({ reasonCode: 'proposal_rejected', draftState: 'rejected' })
    expect(deriveStageArgs(base, 'FAILED', 'identify')).toMatchObject({ stage: 'failed', reasonCode: 'ai_failed' })
    expect(deriveStageArgs({ ...base, proposalId: '33333333-3333-4333-8333-333333333333' }, 'RUNNING', 'resolve')).toMatchObject({ stage: 'awaiting_approval' })
    expect(deriveStageArgs(base, 'RUNNING', 'resolve')).toMatchObject({ stage: 'advising' })
    expect(deriveStageArgs({}, 'COMPLETED', 'end')).toBeNull()
  })
})

describe('queue status', () => {
  it('maps projection rows to the AI status filter', () => {
    expect(resolveTriageStatus({ stage: 'classifying', aiMode: null })).toBe('analyzing')
    expect(resolveTriageStatus({ stage: 'advising', aiMode: null })).toBe('advising')
    expect(matchesTriageStatus({ _triage: { stage: 'advising', aiMode: null } }, 'advising')).toBe(true)
    expect(resolveTriageStatus({ stage: 'done', aiMode: 'manual_review' })).toBe('manual_review')
    expect(matchesTriageStatus({ _triage: { stage: 'awaiting_approval', aiMode: 'assisted' } }, 'awaiting_approval')).toBe(true)
    expect(matchesTriageStatus({ _triage: null }, 'assisted')).toBe(false)
    expect(matchesTriageStatus({ _triage: null }, '')).toBe(true)
  })
})

describe('demo scenarios', () => {
  it('ships the six umbrella personas in English', () => {
    expect(TRIAGE_SCENARIOS.map((scenario) => scenario.fromEmail)).toEqual([
      'anna.carter@example.com',
      'peter.brooks@example.com',
      'maria.lopez@example.com',
      'emma.wilson@example.com',
      'tom.walker@example.com',
      'john.miller@example.com',
    ])
    expect(TRIAGE_SCENARIOS[0].body).toContain('ABC123')
  })
})
