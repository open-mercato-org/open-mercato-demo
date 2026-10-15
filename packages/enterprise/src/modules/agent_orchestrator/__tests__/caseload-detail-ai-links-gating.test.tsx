/**
 * @jest-environment jsdom
 */

import * as React from 'react'
import { screen, waitFor } from '@testing-library/react'
import { renderWithProviders } from '@open-mercato/shared/lib/testing/renderWithProviders'
import { readApiResultOrThrow } from '@open-mercato/ui/backend/utils/apiCall'
import en from '../i18n/en.json'
import ProposalDetailPage from '../backend/caseload/[proposalId]/page'

let mockGrantedFeatures: string[] = []

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}))

jest.mock('@open-mercato/ui/backend/BackendChromeProvider', () => ({
  useBackendChrome: () => ({
    payload: { grantedFeatures: mockGrantedFeatures },
    isLoading: false,
    isReady: true,
    refresh: async () => {},
  }),
}))

jest.mock('@open-mercato/ui/backend/utils/apiCall', () => ({
  apiCall: jest.fn(async () => ({ ok: true, status: 200, result: { items: [] }, response: {}, cacheStatus: null })),
  apiCallOrThrow: jest.fn(async () => ({})),
  readApiResultOrThrow: jest.fn(async () => ({ items: [] })),
  withScopedApiRequestHeaders: (_headers: unknown, run: () => unknown) => run(),
}))

jest.mock('@open-mercato/ui/backend/injection/useGuardedMutation', () => ({
  useGuardedMutation: () => ({
    runMutation: async ({ operation }: { operation: () => Promise<unknown> }) => operation(),
    retryLastMutation: jest.fn(),
  }),
}))

jest.mock('@open-mercato/ui/backend/FlashMessages', () => ({ flash: jest.fn() }))
jest.mock('@open-mercato/ui/backend/conflicts', () => ({ surfaceRecordConflict: jest.fn(() => false) }))

const dict = en as Record<string, string>
const PROPOSAL_ID = '11111111-1111-4111-8111-111111111111'
const RUN_ID = '22222222-2222-4222-8222-222222222222'
const INSTANCE_ID = '33333333-3333-4333-8333-333333333333'

function mockDetailApi() {
  ;(readApiResultOrThrow as jest.Mock).mockImplementation(async (url: string) => {
    if (url.startsWith('/api/agent_orchestrator/proposals')) {
      return {
        items: [{
          id: PROPOSAL_ID,
          agent_id: 'deal_advisor',
          run_id: RUN_ID,
          workflow_instance_id: INSTANCE_ID,
          payload: { options: [{ id: 'only', label: 'Only option', actions: [{ type: 'ping', payload: {} }] }] },
          confidence: 0.7,
          disposition: 'pending',
          guard_results: [],
          created_at: '2026-10-15T09:00:00.000Z',
          updated_at: '2026-10-15T09:00:00.000Z',
        }],
      }
    }
    return { items: [] }
  })
}

async function renderPage() {
  renderWithProviders(<ProposalDetailPage params={{ proposalId: PROPOSAL_ID }} />, { dict })
  await waitFor(() => expect(screen.getByRole('button', { name: dict['agent_orchestrator.proposal.backToCaseload'] })).toBeTruthy())
}

function queryButton(key: string) {
  return screen.queryByRole('button', { name: dict[key] })
}

beforeEach(() => {
  jest.clearAllMocks()
  mockDetailApi()
})

describe('Caseload proposal detail — AI-internal links follow their own features', () => {
  it('hides the trace, process and run inspection entry points without trace.view / processes.view', async () => {
    mockGrantedFeatures = ['agent_orchestrator.proposals.view', 'agent_orchestrator.proposals.dispose']
    await renderPage()
    expect(queryButton('agent_orchestrator.proposal.openTrace')).toBeNull()
    expect(queryButton('agent_orchestrator.proposal.openProcess')).toBeNull()
    expect(queryButton('agent_orchestrator.proposal.ioHeading')).toBeNull()
  })

  it('shows each entry point when its feature is granted', async () => {
    mockGrantedFeatures = ['agent_orchestrator.proposals.view', 'agent_orchestrator.trace.view', 'agent_orchestrator.processes.view']
    await renderPage()
    expect(queryButton('agent_orchestrator.proposal.openTrace')).toBeTruthy()
    expect(queryButton('agent_orchestrator.proposal.openProcess')).toBeTruthy()
    expect(queryButton('agent_orchestrator.proposal.ioHeading')).toBeTruthy()
  })

  it('shows the trace without the process link when only trace.view is granted', async () => {
    mockGrantedFeatures = ['agent_orchestrator.proposals.view', 'agent_orchestrator.trace.view']
    await renderPage()
    expect(queryButton('agent_orchestrator.proposal.openTrace')).toBeTruthy()
    expect(queryButton('agent_orchestrator.proposal.openProcess')).toBeNull()
  })

  it('honours wildcard grants', async () => {
    mockGrantedFeatures = ['agent_orchestrator.*']
    await renderPage()
    expect(queryButton('agent_orchestrator.proposal.openTrace')).toBeTruthy()
    expect(queryButton('agent_orchestrator.proposal.openProcess')).toBeTruthy()
  })
})
