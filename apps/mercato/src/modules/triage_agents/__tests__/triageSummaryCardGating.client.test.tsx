/** @jest-environment jsdom */

const apiCallMock = jest.fn()

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
jest.mock('@open-mercato/ui/primitives/tooltip', () => ({
  SimpleTooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}))

import * as React from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { TriageSummaryCard } from '../components/TriageSummaryCard'

const TICKET_ID = 'ticket-1'

const TRIAGE = {
  ticketId: TICKET_ID,
  stage: 'awaiting_approval',
  aiMode: 'assisted',
  proposalId: 'proposal-1',
  disposition: null,
  executionId: 'execution-1',
  attempt: 1,
  attempts: [],
  uncertainty: [],
  groundingState: 'not_checked',
  groundingIssues: [],
  draftState: 'none',
}

function mockApi(grantedFeatures: string[]) {
  apiCallMock.mockImplementation(async (url: string, init?: { body?: string }) => {
    if (url === '/api/auth/feature-check') {
      const requested = (JSON.parse(init?.body ?? '{}') as { features?: string[] }).features ?? []
      const granted = requested.filter((feature) => grantedFeatures.includes(feature))
      return { ok: true, status: 200, result: { ok: granted.length === requested.length, granted } }
    }
    return { ok: true, status: 200, result: { triage: TRIAGE } }
  })
}

beforeEach(() => {
  apiCallMock.mockReset()
})

describe('triage summary card AI-internal links', () => {
  it('hides Caseload, Open flow and Re-run for a support consultant', async () => {
    mockApi(['triage_agents.view', 'agent_orchestrator.proposals.view', 'agent_orchestrator.proposals.dispose'])
    render(<TriageSummaryCard ticketId={TICKET_ID} />)
    expect(await screen.findByTestId('triage-review-proposal')).toBeInTheDocument()
    await waitFor(() => expect(apiCallMock).toHaveBeenCalledWith('/api/auth/feature-check', expect.anything(), expect.anything()))
    await act(async () => {
      await Promise.all(apiCallMock.mock.results.map((entry) => entry.value))
    })
    expect(screen.queryByTestId('triage-open-caseload')).toBeNull()
    expect(screen.queryByTestId('triage-open-flow')).toBeNull()
    expect(screen.queryByTestId('triage-rerun')).toBeNull()
  })

  it('shows each link only with its own feature', async () => {
    mockApi(['agent_orchestrator.processes.view'])
    const { unmount } = render(<TriageSummaryCard ticketId={TICKET_ID} />)
    expect(await screen.findByTestId('triage-open-flow')).toHaveAttribute('href', '/backend/processes/execution-1')
    expect(screen.queryByTestId('triage-open-caseload')).toBeNull()
    expect(screen.queryByTestId('triage-rerun')).toBeNull()
    unmount()

    mockApi(['agent_orchestrator.trace.view', 'triage_agents.run'])
    render(<TriageSummaryCard ticketId={TICKET_ID} />)
    expect(await screen.findByTestId('triage-open-caseload')).toHaveAttribute('href', '/backend/caseload/proposal-1')
    expect(screen.getByTestId('triage-rerun')).toBeInTheDocument()
    expect(screen.queryByTestId('triage-open-flow')).toBeNull()
  })

  it('checks all three features in one round trip', async () => {
    mockApi([])
    render(<TriageSummaryCard ticketId={TICKET_ID} />)
    await screen.findByTestId('triage-review-proposal')
    const featureCalls = apiCallMock.mock.calls.filter(([url]) => url === '/api/auth/feature-check')
    expect(featureCalls).toHaveLength(1)
    expect(JSON.parse(featureCalls[0][1].body).features).toEqual([
      'agent_orchestrator.trace.view',
      'agent_orchestrator.processes.view',
      'triage_agents.run',
    ])
  })
})
