/** @jest-environment jsdom */

const apiCallMock = jest.fn()
const decisionCardProps: Array<Record<string, unknown>> = []
const flowTraceProps: Array<Record<string, unknown>> = []

jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))
jest.mock('@open-mercato/shared/lib/i18n/context', () => ({
  useT: () => (key: string, fallback?: string) => fallback ?? key,
}))
jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: (...args: unknown[]) => apiCallMock(...args),
  apiCallOrThrow: (...args: unknown[]) => apiCallMock(...args),
}))
jest.mock('@open-mercato/ui/backend/injection/useAppEvent', () => ({ useAppEvent: () => undefined }))
jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({ runMutation: jest.fn(), retryLastMutation: jest.fn() }),
}))
jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/confirm-dialog', () => ({
  useConfirmDialog: () => ({ confirm: jest.fn(async () => true), ConfirmDialogElement: null }),
}))
jest.mock('@open-mercato/ui/backend/detail', () => ({ LoadingMessage: () => null }))
jest.mock('@open-mercato/enterprise/modules/agent_orchestrator/components/ProposalDecisionCard', () => ({
  ProposalDecisionCard: (props: Record<string, unknown>) => {
    decisionCardProps.push(props)
    return <div data-testid="ao-card" data-proposal-id={String(props.proposalId)} />
  },
}))
jest.mock('@open-mercato/enterprise/modules/agent_orchestrator/components/ProcessFlowTrace', () => ({
  ProcessFlowTrace: (props: Record<string, unknown>) => {
    flowTraceProps.push(props)
    return <div data-testid="ao-flow" data-execution-id={String(props.executionId)} />
  },
}))

import * as React from 'react'
import { render, screen, waitFor } from '@testing-library/react'
import { TriageDecisionCard } from '../components/TriageDecisionCard'
import { TriageFlowTab } from '../components/TriageFlowTab'
import { getCitationResolver } from '@open-mercato/enterprise/modules/agent_orchestrator/components/citationResolvers'

const TICKET_ID = 'ticket-1'

function triage(overrides: Record<string, unknown> = {}) {
  return {
    ticketId: TICKET_ID,
    stage: 'awaiting_approval',
    aiMode: 'assisted',
    proposalId: 'proposal-1',
    disposition: null,
    executionId: 'execution-2',
    attempt: 2,
    attempts: [{ attempt: 1, executionId: 'execution-1', stage: 'done', aiMode: 'assisted', reasonCode: null, disposition: 'rejected', recordedAt: '2026-10-13T09:00:00.000Z' }],
    ...overrides,
  }
}

function mockApi(triageView: Record<string, unknown> | null, grantedFeatures: string[] = []) {
  apiCallMock.mockImplementation(async (url: string) => {
    if (url === '/api/auth/feature-check') {
      return { ok: true, status: 200, result: { ok: grantedFeatures.length > 0, granted: grantedFeatures } }
    }
    return { ok: true, status: 200, result: { triage: triageView } }
  })
}

beforeEach(() => {
  apiCallMock.mockReset()
  decisionCardProps.length = 0
  flowTraceProps.length = 0
})

describe('triage decision card widget', () => {
  it('embeds the AO card for the pending proposal with the triage field editors', async () => {
    mockApi(triage(), ['reservations.refund.manage'])
    render(<TriageDecisionCard ticketId={TICKET_ID} />)
    expect(await screen.findByTestId('ao-card')).toHaveAttribute('data-proposal-id', 'proposal-1')
    expect(screen.getByTestId('triage-decision-card')).toHaveAttribute('id', 'triage-decision-card')
    await waitFor(() => {
      const latest = decisionCardProps[decisionCardProps.length - 1]
      expect((latest.fieldOverrides as Record<string, unknown>)['reservations.refund.request.bankAccountNumber']).toEqual({ widget: 'masked', revealable: true })
    })
    expect(decisionCardProps[decisionCardProps.length - 1].approveLabel).toBe('Approve & send')
    expect(getCitationResolver('kb')).toBeDefined()
  })

  it('keeps the bank account hidden without refund.manage and renders nothing without a pending proposal', async () => {
    mockApi(triage())
    const { unmount } = render(<TriageDecisionCard ticketId={TICKET_ID} />)
    await screen.findByTestId('ao-card')
    expect((decisionCardProps[decisionCardProps.length - 1].fieldOverrides as Record<string, unknown>)['reservations.refund.request.bankAccountNumber']).toEqual({
      widget: 'masked',
      revealable: false,
    })
    unmount()
    mockApi(triage({ stage: 'applying', disposition: 'edited' }))
    render(<TriageDecisionCard ticketId={TICKET_ID} />)
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith(`/api/triage_agents/tickets/${TICKET_ID}`))
    expect(screen.queryByTestId('triage-decision-card')).toBeNull()
  })
})

describe('triage flow tab widget', () => {
  it('opens the current attempt with every attempt in the selector and the AO re-run off', async () => {
    mockApi(triage())
    render(<TriageFlowTab ticketId={TICKET_ID} />)
    expect(await screen.findByTestId('ao-flow')).toHaveAttribute('data-execution-id', 'execution-2')
    expect(flowTraceProps[flowTraceProps.length - 1]).toMatchObject({
      executionId: 'execution-2',
      attempts: ['execution-1', 'execution-2'],
      showAttemptSelector: true,
      allowRerun: false,
    })
    expect(screen.getByTestId('triage-flow-rerun')).toBeEnabled()
  })

  it('shows the empty state when the ticket was never triaged', async () => {
    mockApi(null)
    render(<TriageFlowTab ticketId={TICKET_ID} />)
    expect(await screen.findByText('No triage execution has been recorded for this ticket yet.')).toBeInTheDocument()
    expect(screen.queryByTestId('ao-flow')).toBeNull()
  })
})
