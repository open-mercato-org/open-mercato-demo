/**
 * @jest-environment jsdom
 *
 * The embeddable decision card (spec §A) disposes through the same endpoint as
 * the Caseload: an edit sends the FULL re-assembled envelope with the chosen
 * option and a reason, under the optimistic-lock header; masked fields never
 * become inputs; and without the dispose feature the card is read-only.
 */

import * as React from 'react'
import { TextEncoder as NodeTextEncoder } from 'node:util'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import {
  apiCall,
  apiCallOrThrow,
  readApiResultOrThrow,
  withScopedApiRequestHeaders,
} from '@open-mercato/ui/backend/utils/apiCall'
import en from '../i18n/en.json'
import { ProposalDecisionCard } from '../components/ProposalDecisionCard'
import { registerCitationResolver } from '../components/citationResolvers'

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(),
  apiCallOrThrow: jest.fn(),
  readApiResultOrThrow: jest.fn(),
  withScopedApiRequestHeaders: jest.fn((_headers: unknown, run: () => unknown) => run()),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))

if (typeof globalThis.TextEncoder === 'undefined') {
  Object.assign(globalThis, { TextEncoder: NodeTextEncoder })
}

const dict = en as Record<string, string>
const PROPOSAL_ID = '11111111-1111-4111-8111-111111111111'
const RUN_ID = '22222222-2222-4222-8222-222222222222'
const UPDATED_AT = '2026-10-12T09:00:00.000Z'
const IBAN = 'PL61109010140000071219812874'
const TEMPLATE = 'We will refund the overpaid amount within 5 days.'

const PAYLOAD = {
  options: [
    {
      id: 'refund',
      label: 'Refund the overpayment',
      confidence: 0.91,
      actions: [
        { type: 'reservations.refund.request', payload: { amount: 350, iban: IBAN } },
        { type: 'tickets.ticket.reply', payload: { body: `Dear Jane,\n${TEMPLATE}` }, citations: ['payments.refunds.overpayment_refund@3#S5'] },
      ],
    },
  ],
  rationale: 'Paid 2,750 against a 2,400 total.',
  evidence: {
    checks: [{ key: 'overpayment_confirmed', step: 'S2', passed: true, evidence: 'paid 2,750 > total 2,400' }],
    citations: [
      { kind: 'kb', ref: 'payments.refunds.overpayment_refund@3', steps: ['S2', 'S5'], label: 'Overpayment refund (v3)' },
    ],
    segments: [
      { source: 'generated', text: 'Dear Jane,\n' },
      { source: 'template', ref: 'payments.refunds.overpayment_refund@3#reply_template', text: TEMPLATE },
    ],
  },
}

const OUTCOME_SCHEMA = {
  type: 'object',
  properties: {
    options: {
      type: 'array',
      items: {
        properties: {
          actions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', const: 'tickets.ticket.reply' },
                payload: { type: 'object', properties: { body: { type: 'string', description: 'format:long_text' } } },
              },
            },
          },
        },
      },
    },
  },
}

function proposalRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PROPOSAL_ID,
    agent_id: 'resolution_advisor',
    run_id: RUN_ID,
    payload: PAYLOAD,
    confidence: 0.91,
    disposition: 'pending',
    guard_results: [],
    created_at: '2026-10-12T08:59:00.000Z',
    updated_at: UPDATED_AT,
    ...overrides,
  }
}

function mockApi({ canDispose = true, row = proposalRow() }: { canDispose?: boolean; row?: Record<string, unknown> } = {}) {
  ;(readApiResultOrThrow as jest.Mock).mockImplementation(async (url: string) => {
    if (url.startsWith('/api/agent_orchestrator/proposals')) return { items: [row] }
    return { items: [] }
  })
  ;(apiCall as jest.Mock).mockImplementation(async (url: string) => {
    if (url === '/api/auth/feature-check') return { ok: true, status: 200, result: { ok: canDispose, granted: [] } }
    if (url.startsWith('/api/agent_orchestrator/agents')) {
      return {
        ok: true,
        status: 200,
        result: { items: [{ id: 'resolution_advisor', label: 'Resolution advisor', resultKind: 'proposal', outcomeSchema: OUTCOME_SCHEMA }] },
      }
    }
    return { ok: true, status: 200, result: { items: [] } }
  })
  ;(apiCallOrThrow as jest.Mock).mockResolvedValue({
    ok: true,
    status: 200,
    result: { proposalId: PROPOSAL_ID, disposition: 'edited', selectedOptionId: 'refund', updatedAt: '2026-10-12T09:05:00.000Z' },
  })
}

beforeEach(() => {
  jest.clearAllMocks()
})

describe('ProposalDecisionCard', () => {
  it('renders the long-text reply with the template segment highlighted, the IBAN masked, and the citations panel', async () => {
    mockApi()
    const unregister = registerCitationResolver('kb', () => ({
      title: 'Payments › Refunds › Overpayment refund (v3)',
      href: '/backend/knowledge_articles/1',
      steps: [
        { id: 'S2', text: 'Confirm the paid amount exceeds the total.' },
        { id: 'S5', text: 'Reply with the refund template.' },
      ],
    }))
    const { container } = renderWithProviders(
      <ProposalDecisionCard proposalId={PROPOSAL_ID} fieldOverrides={{ '*.iban': { widget: 'masked' } }} />,
      { dict },
    )
    await screen.findByText('Refund the overpayment')
    const mark = await waitFor(() => {
      const node = container.querySelector('[data-long-text-field="body"] mark[data-segment-source="template"]')
      expect(node).toBeTruthy()
      return node as HTMLElement
    })
    expect(mark.textContent).toBe(TEMPLATE)
    expect(screen.queryByText(IBAN)).toBeNull()
    expect(screen.getByText('••••••••••••2874')).toBeTruthy()
    const citations = container.querySelector('[data-testid="ao-decision-citations"]') as HTMLElement
    await within(citations).findByText('Payments › Refunds › Overpayment refund (v3)')
    expect(within(citations).getByText('Reply with the refund template.')).toBeTruthy()
    expect(within(citations).getByText('overpayment_confirmed')).toBeTruthy()
    unregister()
  })

  it('edits the long-text field and disposes `edited` with the full envelope, option, reason and lock header', async () => {
    mockApi()
    const onDisposed = jest.fn()
    renderWithProviders(
      <ProposalDecisionCard proposalId={PROPOSAL_ID} fieldOverrides={{ '*.iban': { widget: 'masked' } }} onDisposed={onDisposed} />,
      { dict },
    )
    await screen.findByText('Refund the overpayment')
    await waitFor(() => expect((screen.getByRole('button', { name: /Edit/ }) as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(screen.getByRole('button', { name: /Edit/ }))

    const textareas = await screen.findAllByRole('textbox')
    const body = textareas.find((element) => (element as HTMLTextAreaElement).value.startsWith('Dear Jane')) as HTMLTextAreaElement
    expect(body.tagName).toBe('TEXTAREA')
    fireEvent.change(body, { target: { value: `Dear Ms Doe,\n${TEMPLATE}` } })
    expect(screen.queryByDisplayValue(IBAN)).toBeNull()

    fireEvent.click(screen.getByRole('button', { name: dict['agent_orchestrator.proposal.actions.saveEdit'] }))
    const dialog = await screen.findByRole('dialog')
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Greeting uses the surname' } })
    fireEvent.keyDown(within(dialog).getByRole('textbox'), { key: 'Enter', ctrlKey: true })

    await waitFor(() => expect(apiCallOrThrow).toHaveBeenCalledTimes(1))
    const [url, init] = (apiCallOrThrow as jest.Mock).mock.calls[0]
    expect(url).toBe(`/api/agent_orchestrator/proposals/${PROPOSAL_ID}/dispose`)
    const sent = JSON.parse(init.body)
    expect(sent).toMatchObject({ disposition: 'edited', selectedOptionId: 'refund', reason: 'Greeting uses the surname' })
    expect(sent.payload.options[0].actions[0].payload).toEqual({ amount: 350, iban: IBAN })
    expect(sent.payload.options[0].actions[1].payload.body).toBe(`Dear Ms Doe,\n${TEMPLATE}`)
    expect(sent.payload.options[0].actions[1].citations).toEqual(['payments.refunds.overpayment_refund@3#S5'])
    expect(sent.payload.evidence.citations[0].ref).toBe('payments.refunds.overpayment_refund@3')
    expect(sent.payload.rationale).toBe('Paid 2,750 against a 2,400 total.')
    const lockHeaders = (withScopedApiRequestHeaders as jest.Mock).mock.calls[0][0] as Record<string, string>
    expect(Object.values(lockHeaders)).toContain(UPDATED_AT)
    await waitFor(() =>
      expect(onDisposed).toHaveBeenCalledWith(expect.objectContaining({ proposalId: PROPOSAL_ID, disposition: 'edited', selectedOptionId: 'refund' })),
    )
  })

  it('approves with Cmd/Ctrl+Enter, naming the selected option and no payload', async () => {
    mockApi()
    renderWithProviders(<ProposalDecisionCard proposalId={PROPOSAL_ID} approveLabel="Approve & send" />, { dict })
    const approve = await screen.findByRole('button', { name: /Approve & send/ })
    await waitFor(() => expect((approve as HTMLButtonElement).disabled).toBe(false))
    fireEvent.keyDown(screen.getByTestId('ao-proposal-decision-card'), { key: 'Enter', metaKey: true })
    await waitFor(() => expect(apiCallOrThrow).toHaveBeenCalledTimes(1))
    expect(JSON.parse((apiCallOrThrow as jest.Mock).mock.calls[0][1].body)).toEqual({ disposition: 'approved', selectedOptionId: 'refund' })
  })

  it('rejects only with a reason, never naming an option', async () => {
    mockApi()
    renderWithProviders(<ProposalDecisionCard proposalId={PROPOSAL_ID} />, { dict })
    const reject = await screen.findByRole('button', { name: dict['agent_orchestrator.proposal.actions.reject'] })
    await waitFor(() => expect((reject as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(reject)
    const dialog = await screen.findByRole('dialog')
    const confirm = within(dialog).getByRole('button', { name: dict['agent_orchestrator.proposal.reject.confirm'] })
    expect((confirm as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(within(dialog).getByRole('textbox'), { target: { value: 'Wrong customer' } })
    fireEvent.click(confirm)
    await waitFor(() => expect(apiCallOrThrow).toHaveBeenCalledTimes(1))
    expect(JSON.parse((apiCallOrThrow as jest.Mock).mock.calls[0][1].body)).toEqual({ disposition: 'rejected', reason: 'Wrong customer' })
  })

  it('renders facts, label and long text from decision_context without calling the agents or runs endpoints', async () => {
    mockApi({
      row: proposalRow({
        decision_context: {
          agentLabel: 'Resolution advisor (ctx)',
          facts: [
            { label: 'Booking', value: 'TRV-1042', format: null },
            { label: 'Paid', value: 2750, format: 'number' },
          ],
          longTextFields: ['tickets.ticket.reply.body'],
        },
      }),
    })
    const { container } = renderWithProviders(<ProposalDecisionCard proposalId={PROPOSAL_ID} />, { dict })
    await screen.findByText('TRV-1042')
    expect(screen.getByText('Booking')).toBeTruthy()
    expect(screen.getByText('Paid')).toBeTruthy()
    expect(container.textContent).toContain('Resolution advisor (ctx)')
    expect(container.querySelector('[data-long-text-field="body"]')).toBeTruthy()
    const calledUrls = (apiCall as jest.Mock).mock.calls.map(([url]) => String(url))
    expect(calledUrls.some((url) => url.startsWith('/api/agent_orchestrator/agents'))).toBe(false)
    expect(calledUrls.some((url) => url.startsWith('/api/agent_orchestrator/runs'))).toBe(false)
  })

  it('is read-only without agent_orchestrator.proposals.dispose', async () => {
    mockApi({ canDispose: false })
    renderWithProviders(<ProposalDecisionCard proposalId={PROPOSAL_ID} />, { dict })
    await screen.findByText(dict['agent_orchestrator.decisionCard.readOnly'])
    expect(screen.queryByRole('button', { name: dict['agent_orchestrator.proposal.actions.approve'] })).toBeNull()
    expect(screen.queryByRole('button', { name: /Edit/ })).toBeNull()
  })
})
