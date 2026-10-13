/** @jest-environment node */
import {
  createKbCitationResolver,
  kbArticleHref,
  mapKbVersionToCitation,
  parseKbCitationRef,
  type KbVersionResponse,
} from '../components/kbCitationResolver'
import { attemptExecutionIds, currentExecutionId, pendingProposalId, type TriageAttemptView } from '../components/triageTypes'
import { buildTriageFieldOverrides } from '../components/triageDecisionModel'
import { readTicketWidgetContext } from '../components/ticketWidgetContext'
import { buildRerunBody } from '../components/useTriageRerun'

jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))

const ARTICLE_ID = '9a5b4c4e-2f53-4f62-9d1c-0b1f7b1c3a11'

function versionResponse(version: number, extraSteps: Array<{ id: string; text: string }> = []): KbVersionResponse {
  return {
    key: 'payments.refunds.overpayment_refund',
    version,
    articleId: ARTICLE_ID,
    snapshot: {
      title: 'Overpayment refund',
      category: { name: 'Payments' },
      subcategory: { name: 'Refunds' },
      procedureSteps: [
        { id: 'S1', text: 'Verify that the requester owns the booking.', checkKey: 'owner_verified' },
        { id: 'S4', text: 'Request the refund for the overpaid amount only.' },
        { id: '', text: 'ignored' },
        ...extraSteps,
      ],
    },
  }
}

function attempt(attemptNo: number, executionId: string | null): TriageAttemptView {
  return { attempt: attemptNo, executionId, stage: 'done', aiMode: 'assisted', reasonCode: null, disposition: null, recordedAt: '2026-10-13T10:00:00.000Z' }
}

describe('KB citation resolver', () => {
  it('parses key@version refs, with or without a step anchor', () => {
    expect(parseKbCitationRef('payments.refunds.overpayment_refund@3')).toEqual({ key: 'payments.refunds.overpayment_refund', version: 3 })
    expect(parseKbCitationRef('payments.refunds.overpayment_refund@4#S2')).toEqual({ key: 'payments.refunds.overpayment_refund', version: 4 })
    expect(parseKbCitationRef('payments.refunds.overpayment_refund')).toEqual({ key: 'payments.refunds.overpayment_refund', version: 'latest' })
    expect(parseKbCitationRef('payments.refunds.overpayment_refund@latest')).toEqual({ key: 'payments.refunds.overpayment_refund', version: 'latest' })
    expect(parseKbCitationRef('payments.refunds.overpayment_refund@0')).toBeNull()
    expect(parseKbCitationRef('@3')).toBeNull()
    expect(parseKbCitationRef('')).toBeNull()
  })

  it('maps a version snapshot to the citation title, article link and step texts', () => {
    const resolved = mapKbVersionToCitation(versionResponse(4), { kind: 'kb', ref: 'payments.refunds.overpayment_refund@4' })
    expect(resolved).toEqual({
      title: 'Payments › Refunds › Overpayment refund (v4)',
      href: kbArticleHref(ARTICLE_ID),
      steps: [
        { id: 'S1', text: 'Verify that the requester owns the booking.' },
        { id: 'S4', text: 'Request the refund for the overpaid amount only.' },
      ],
    })
    expect(kbArticleHref(ARTICLE_ID)).toBe(`/backend/knowledge/articles/${ARTICLE_ID}`)
  })

  it('returns null for a missing snapshot so the panel falls back to the label', () => {
    expect(mapKbVersionToCitation(null, { kind: 'kb', ref: 'x@1' })).toBeNull()
    expect(mapKbVersionToCitation({ snapshot: { title: '' } }, { kind: 'kb', ref: 'x@1' })).toBeNull()
  })

  it('fetches the cited version once and re-reads latest every time', async () => {
    const fetcher = jest.fn(async ({ version }: { key: string; version: number | 'latest' }) => versionResponse(version === 'latest' ? 5 : version))
    const resolver = createKbCitationResolver(fetcher)
    const first = await resolver({ kind: 'kb', ref: 'payments.refunds.overpayment_refund@3' })
    await resolver({ kind: 'kb', ref: 'payments.refunds.overpayment_refund@3' })
    expect(first?.title).toBe('Payments › Refunds › Overpayment refund (v3)')
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher).toHaveBeenCalledWith({ key: 'payments.refunds.overpayment_refund', version: 3 })
    await resolver({ kind: 'kb', ref: 'payments.refunds.overpayment_refund' })
    await resolver({ kind: 'kb', ref: 'payments.refunds.overpayment_refund' })
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(await resolver({ kind: 'kb', ref: 'not a ref@x' })).toBeNull()
  })

  it('does not cache a version that could not be read', async () => {
    const fetcher = jest.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(versionResponse(4))
    const resolver = createKbCitationResolver(fetcher)
    expect(await resolver({ kind: 'kb', ref: 'payments.refunds.overpayment_refund@4' })).toBeNull()
    expect((await resolver({ kind: 'kb', ref: 'payments.refunds.overpayment_refund@4' }))?.title).toContain('(v4)')
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
})

describe('triage decision card model', () => {
  it('shows the card only for a proposal still waiting for a decision', () => {
    expect(pendingProposalId({ stage: 'awaiting_approval', proposalId: 'p1', disposition: null })).toBe('p1')
    expect(pendingProposalId({ stage: 'awaiting_approval', proposalId: 'p1', disposition: 'edited' })).toBeNull()
    expect(pendingProposalId({ stage: 'applying', proposalId: 'p1', disposition: null })).toBeNull()
    expect(pendingProposalId({ stage: 'awaiting_approval', proposalId: null, disposition: null })).toBeNull()
    expect(pendingProposalId(null)).toBeNull()
  })

  it('configures the reply, refund and id editors; the IBAN reveal follows refund.manage', () => {
    const withReveal = buildTriageFieldOverrides(true)
    expect(withReveal['tickets.reply.send.body']).toEqual({ widget: 'long_text' })
    expect(withReveal['reservations.refund.request.amount']).toEqual({ widget: 'money' })
    expect(withReveal['reservations.refund.request.bankAccountNumber']).toEqual({ widget: 'masked', revealable: true })
    expect(buildTriageFieldOverrides(false)['reservations.refund.request.bankAccountNumber']).toEqual({ widget: 'masked', revealable: false })
    for (const key of ['*.ticketId', '*.reservationId', '*.relatedTicketId']) expect(withReveal[key]).toEqual({ widget: 'readonly' })
  })

  it('reads the ticket id and reload callbacks from the ticket detail and composer spots', () => {
    const reload = jest.fn(async () => undefined)
    const reloadDrafts = jest.fn(async () => undefined)
    expect(readTicketWidgetContext({ resourceKind: 'tickets.ticket', resourceId: 't1', reload, reloadDrafts }, { ticket: { id: 't1' } })).toEqual({
      ticketId: 't1',
      reload,
      reloadDrafts,
    })
    expect(readTicketWidgetContext(null, { ticket: { id: 't2' }, reloadDrafts })).toEqual({ ticketId: 't2', reload: null, reloadDrafts })
    expect(readTicketWidgetContext(undefined, { id: 't3' })).toEqual({ ticketId: 't3', reload: null, reloadDrafts: null })
    expect(readTicketWidgetContext({ resourceKind: 'other', resourceId: 'x' }, null).ticketId).toBeNull()
  })
})

describe('triage flow tab model', () => {
  it('lists every attempt execution oldest first with the current one last', () => {
    const triage = {
      executionId: 'e3',
      attempts: [attempt(2, 'e2'), attempt(1, 'e1'), attempt(3, null)],
    }
    expect(attemptExecutionIds(triage)).toEqual(['e1', 'e2', 'e3'])
    expect(currentExecutionId(triage)).toBe('e3')
  })

  it('falls back to the latest recorded attempt while a superseding re-run has not recorded its execution', () => {
    const triage = { executionId: null, attempts: [attempt(1, 'e1'), attempt(2, 'e2')] }
    expect(attemptExecutionIds(triage)).toEqual(['e1', 'e2'])
    expect(currentExecutionId(triage)).toBe('e2')
    expect(currentExecutionId({ executionId: null, attempts: [] })).toBeNull()
    expect(attemptExecutionIds(null)).toEqual([])
  })

  it('does not duplicate the current execution when it is also in the history', () => {
    expect(attemptExecutionIds({ executionId: 'e1', attempts: [attempt(1, 'e1'), attempt(2, 'e2')] })).toEqual(['e2', 'e1'])
  })

  it('sends supersede only when a proposal is pending', () => {
    expect(buildRerunBody(true)).toEqual({ supersede: true })
    expect(buildRerunBody(false)).toEqual({})
  })
})
