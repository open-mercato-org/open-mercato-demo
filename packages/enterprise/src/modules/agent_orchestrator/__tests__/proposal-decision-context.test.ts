const findOneWithDecryptionMock = jest.fn()
const getAgentEntryMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryptionMock(...args),
}))
jest.mock('../lib/sdk/defineAgent', () => ({
  ensureAgentsLoaded: jest.fn(async () => undefined),
  getAgentEntry: (id: string) => getAgentEntryMock(id),
}))
jest.mock('../lib/sdk/agentOutcomeContract', () => ({
  resolveAgentOutcomeJsonSchema: (entry: { outcomeSchema?: unknown }) => entry.outcomeSchema,
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import { attachProposalDecisionContext, buildProposalDecisionContext } from '../lib/proposals/decisionContext'
import { formatFactValues } from '../components/proposalFactsData'
import { mapDecisionContext } from '../components/types'

const OUTCOME_SCHEMA = {
  type: 'object',
  properties: {
    type: { const: 'tickets.ticket.reply' },
    payload: { type: 'object', properties: { body: { type: 'string', description: 'format:long_text' } } },
  },
}

const AGENT = {
  label: 'Resolution advisor',
  facts: [
    { label: 'Booking', source: 'input' as const, path: 'reservation.bookingNumber' },
    { label: 'Paid', source: 'input' as const, path: 'reservation.paid', format: 'number' as const },
    { label: 'Confidence', source: 'output' as const, path: 'confidence', format: 'percent' as const },
    { label: 'Account', source: 'input' as const, path: 'reservation.apiKey' },
    { label: 'Missing', source: 'payload' as const, path: 'nope' },
  ],
  outcomeSchema: OUTCOME_SCHEMA,
}

const RUN_INPUT = { reservation: { bookingNumber: 'TRV-1042', paid: 2750, apiKey: 'sk-live-123' }, note: 'x' }

describe('buildProposalDecisionContext', () => {
  it('resolves declared facts to raw values, drops unresolved ones and keeps long-text hints', () => {
    const context = buildProposalDecisionContext({
      agent: AGENT,
      payload: { options: [] },
      runInput: JSON.stringify(RUN_INPUT),
      runOutput: { confidence: 0.82 },
    })
    expect(context.agentLabel).toBe('Resolution advisor')
    expect(context.longTextFields).toEqual(['tickets.ticket.reply.body'])
    expect(context.facts).toEqual([
      { label: 'Booking', value: 'TRV-1042', format: null },
      { label: 'Paid', value: 2750, format: 'number' },
      { label: 'Confidence', value: 0.82, format: 'percent' },
      { label: 'Account', value: '[redacted]', format: null },
    ])
    expect(JSON.stringify(context)).not.toContain('sk-live-123')
    expect(formatFactValues(context.facts, 'en-US').map((fact) => fact.value)).toEqual(['TRV-1042', '2,750', '82%', '[redacted]'])
  })

  it('falls back to facts derived from the run input when the agent declares none or is unknown', () => {
    const context = buildProposalDecisionContext({
      agent: null,
      payload: null,
      runInput: { bookingNumber: 'TRV-1', password: 'hunter2', nested: { a: 1 } },
      runOutput: null,
    })
    expect(context.agentLabel).toBeNull()
    expect(context.longTextFields).toEqual([])
    expect(context.facts).toEqual([
      { label: 'Booking Number', value: 'TRV-1', format: null },
      { label: 'Password', value: '[redacted]', format: null },
    ])
  })

  it('round-trips through the client mapper', () => {
    const context = buildProposalDecisionContext({ agent: AGENT, payload: null, runInput: RUN_INPUT, runOutput: null })
    expect(mapDecisionContext(JSON.parse(JSON.stringify(context)))).toEqual(context)
    expect(mapDecisionContext(null)).toBeNull()
    expect(mapDecisionContext({ facts: [{ label: 'Bad', value: { deep: true } }], longTextFields: [1] })).toEqual({
      agentLabel: null,
      facts: [],
      longTextFields: [],
    })
  })
})

describe('attachProposalDecisionContext', () => {
  const em = {} as EntityManager

  beforeEach(() => {
    findOneWithDecryptionMock.mockReset()
    getAgentEntryMock.mockReset()
  })

  it('reads the run inside the proposal row scope and attaches decision_context', async () => {
    getAgentEntryMock.mockReturnValue(AGENT)
    findOneWithDecryptionMock.mockResolvedValue({ input: RUN_INPUT, output: { confidence: 0.5 } })
    const item: Record<string, unknown> = {
      id: 'p1',
      agent_id: 'triage_agents.resolution_advisor',
      run_id: 'r1',
      tenant_id: 't1',
      organization_id: 'o1',
      payload: {},
    }
    await attachProposalDecisionContext(em, item)
    const [, , where, , scope] = findOneWithDecryptionMock.mock.calls[0]
    expect(where).toEqual({ id: 'r1', tenantId: 't1', organizationId: 'o1', deletedAt: null })
    expect(scope).toEqual({ tenantId: 't1', organizationId: 'o1' })
    expect(getAgentEntryMock).toHaveBeenCalledWith('triage_agents.resolution_advisor')
    const context = mapDecisionContext(item.decision_context)
    expect(context?.facts.map((fact) => fact.label)).toEqual(['Booking', 'Paid', 'Confidence', 'Account'])
  })

  it('skips rows without a tenant or organization', async () => {
    const item: Record<string, unknown> = { id: 'p1', agent_id: 'a', run_id: 'r1' }
    await attachProposalDecisionContext(em, item)
    expect(findOneWithDecryptionMock).not.toHaveBeenCalled()
    expect(item.decision_context).toBeUndefined()
  })
})
