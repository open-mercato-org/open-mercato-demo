import { describe, test, expect, jest, beforeEach } from '@jest/globals'
import type { AwilixContainer } from 'awilix'
import {
  clearWorkflowSafeCommandsForTests,
  registerWorkflowSafeCommands,
} from '@open-mercato/core/modules/workflows/lib/workflow-safe-commands'
import { AgentProposal, AgentSpan } from '../data/entities'

/**
 * AO delta spec §E — the `agent_orchestrator.execute_approved_proposal` workflow
 * function: it runs the SELECTED option of an approved proposal, in order, through
 * the command bus, gated like `UPDATE_ENTITY`, stopping on failure, and only once.
 */

const findOneWithDecryption = jest.fn<(...args: unknown[]) => Promise<unknown>>()
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

const emitEvent = jest.fn<(...args: unknown[]) => Promise<void>>(async () => {})
jest.mock('../events', () => ({
  emitAgentOrchestratorEvent: (...args: unknown[]) => emitEvent(...args),
}))

const agentEntries = new Map<string, { allowedActions?: string[] }>()
jest.mock('../lib/sdk/defineAgent', () => ({
  ensureAgentsLoaded: async () => {},
  getAgentEntry: (id: string) => agentEntries.get(id),
}))

import {
  EXECUTE_APPROVED_PROPOSAL_FUNCTION,
  createExecuteApprovedProposalFunction,
  proposalExecutionSpanId,
} from '../lib/runtime/executeApprovedProposal'

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const PROPOSAL_ID = '44444444-4444-4444-8444-444444444444'
const RUN_ID = '55555555-5555-4555-8555-555555555555'
const INSTANCE_ID = '66666666-6666-4666-8666-666666666666'
const AGENT_ID = 'triage.resolution_advisor'

const REFUND = 'reservations.refund.request'
const TRANSITION = 'tickets.ticket.transition'
const REPLY = 'tickets.reply.send'

const PAYLOAD = {
  options: [
    {
      id: 'refund',
      label: 'Refund',
      actions: [
        { type: REFUND, payload: { amount: 350 } },
        { type: TRANSITION, payload: { to: 'resolved' } },
        { type: REPLY, payload: { body: 'Hello' } },
      ],
    },
    { id: 'escalate', label: 'Escalate', actions: [{ type: TRANSITION, payload: { to: 'escalated' } }] },
  ],
}

type SpanRow = Partial<AgentSpan> & { externalSpanId: string; attributes?: unknown }

function makeProposal(overrides: Partial<AgentProposal> = {}): AgentProposal {
  return {
    id: PROPOSAL_ID,
    tenantId: TENANT,
    organizationId: ORG,
    agentId: AGENT_ID,
    runId: RUN_ID,
    workflowInstanceId: INSTANCE_ID,
    payload: PAYLOAD,
    source: 'runtime',
    disposition: 'approved',
    selectedOptionId: 'refund',
    ...overrides,
  } as AgentProposal
}

function makeHarness(options: { userFeatures?: string[]; failing?: Record<string, string> } = {}) {
  const spans: SpanRow[] = []
  const em = {
    fork: () => em,
    findOne: jest.fn(async (_entity: unknown, where: { externalSpanId: string }) =>
      spans.find((span) => span.externalSpanId === where.externalSpanId) ?? null,
    ),
    find: jest.fn(async () => [...spans].sort((a, b) => (b.sequence ?? 0) - (a.sequence ?? 0))),
    create: jest.fn((_entity: unknown, data: SpanRow) => ({ ...data })),
    persist: jest.fn((span: SpanRow) => {
      spans.push(span)
      return { flush: async () => {} }
    }),
    flush: jest.fn(async () => {}),
  }
  const executed: Array<{ commandId: string; input: unknown }> = []
  const commandBus = {
    execute: jest.fn(async (commandId: string, args: { input: unknown }) => {
      executed.push({ commandId, input: args.input })
      const failure = options.failing?.[commandId]
      if (failure) throw new Error(failure)
      return { result: { ok: true }, logEntry: null }
    }),
  }
  const userFeatures = new Set(options.userFeatures ?? ['reservations.refund.manage', 'tickets.manage'])
  const rbacService = {
    userHasAllFeatures: jest.fn(async (_userId: string, required: string[]) =>
      required.every((feature) => userFeatures.has(feature)),
    ),
  }
  const registrations: Record<string, unknown> = { em, commandBus, rbacService }
  const container = {
    resolve: (name: string) => {
      if (!(name in registrations)) throw new Error(`not registered: ${name}`)
      return registrations[name]
    },
  } as unknown as AwilixContainer
  const fn = createExecuteApprovedProposalFunction(container)
  const context = { workflowInstance: { id: INSTANCE_ID, tenantId: TENANT, organizationId: ORG }, userId: USER }
  return { fn, context, spans, executed, commandBus, rbacService }
}

function registerTriageCommands() {
  registerWorkflowSafeCommands([
    { commandId: REFUND, requiredFeatures: ['reservations.refund.manage'], defaultEnabled: true },
    { commandId: TRANSITION, requiredFeatures: ['tickets.manage'], defaultEnabled: true },
    { commandId: REPLY, requiredFeatures: ['tickets.manage'], defaultEnabled: true },
  ])
}

describe('execute_approved_proposal', () => {
  beforeEach(() => {
    clearWorkflowSafeCommandsForTests()
    registerTriageCommands()
    agentEntries.clear()
    agentEntries.set(AGENT_ID, { allowedActions: [REFUND, TRANSITION, REPLY] })
    findOneWithDecryption.mockReset()
    emitEvent.mockClear()
  })

  test('runs the selected option in the proposed order, identity-mapped, and reports ok', async () => {
    findOneWithDecryption.mockResolvedValue(makeProposal())
    const { fn, context, executed } = makeHarness()

    const result = await fn({ proposalId: PROPOSAL_ID }, context)

    expect(executed.map((entry) => entry.commandId)).toEqual([REFUND, TRANSITION, REPLY])
    expect(executed[0].input).toEqual({ amount: 350 })
    expect(result).toEqual({
      ok: true,
      proposalId: PROPOSAL_ID,
      selectedOptionId: 'refund',
      replayed: false,
      results: [
        { type: REFUND, commandId: REFUND, status: 'ok' },
        { type: TRANSITION, commandId: TRANSITION, status: 'ok' },
        { type: REPLY, commandId: REPLY, status: 'ok' },
      ],
    })
    expect(emitEvent).toHaveBeenCalledWith(
      'agent_orchestrator.proposal.executed',
      expect.objectContaining({ proposalId: PROPOSAL_ID, ok: true, tenantId: TENANT, organizationId: ORG }),
      { persistent: true },
    )
  })

  test('loads the proposal scoped to the workflow tenant and organization', async () => {
    findOneWithDecryption.mockResolvedValue(makeProposal())
    const { fn, context } = makeHarness()

    await fn({ proposalId: PROPOSAL_ID }, context)

    expect(findOneWithDecryption).toHaveBeenCalledWith(
      expect.anything(),
      AgentProposal,
      expect.objectContaining({ id: PROPOSAL_ID, tenantId: TENANT, organizationId: ORG, deletedAt: null }),
      undefined,
      { tenantId: TENANT, organizationId: ORG },
    )
  })

  test('stops on the first failure and skips the rest (default stopOnFailure)', async () => {
    findOneWithDecryption.mockResolvedValue(makeProposal())
    const { fn, context, executed } = makeHarness({ failing: { [TRANSITION]: 'invalid transition' } })

    const result = await fn({ proposalId: PROPOSAL_ID }, context)

    expect(executed.map((entry) => entry.commandId)).toEqual([REFUND, TRANSITION])
    expect(result.ok).toBe(false)
    expect(result.results.map((entry) => entry.status)).toEqual(['ok', 'error', 'skipped'])
    expect(result.results[1].error).toBe('invalid transition')
  })

  test('stopOnFailure=false keeps running after a failed action', async () => {
    findOneWithDecryption.mockResolvedValue(makeProposal())
    const { fn, context, executed } = makeHarness({ failing: { [TRANSITION]: 'invalid transition' } })

    const result = await fn({ proposalId: PROPOSAL_ID, stopOnFailure: 'false' }, context)

    expect(executed.map((entry) => entry.commandId)).toEqual([REFUND, TRANSITION, REPLY])
    expect(result.results.map((entry) => entry.status)).toEqual(['ok', 'error', 'ok'])
  })

  test('an action outside the agent allowedActions fails closed: nothing runs', async () => {
    agentEntries.set(AGENT_ID, { allowedActions: [REFUND, TRANSITION] })
    findOneWithDecryption.mockResolvedValue(makeProposal())
    const { fn, context, executed } = makeHarness()

    const result = await fn({ proposalId: PROPOSAL_ID }, context)

    expect(executed).toHaveLength(0)
    expect(result.ok).toBe(false)
    expect(result.results[2]).toMatchObject({ type: REPLY, status: 'skipped' })
    expect(result.results[2].error).toContain('outside the effective action vocabulary')
  })

  test('an agent no longer registered allows nothing', async () => {
    agentEntries.clear()
    findOneWithDecryption.mockResolvedValue(makeProposal())
    const { fn, context, executed } = makeHarness()

    const result = await fn({ proposalId: PROPOSAL_ID }, context)

    expect(executed).toHaveLength(0)
    expect(result.ok).toBe(false)
  })

  test('the workflow user must hold the command features (UPDATE_ENTITY gate)', async () => {
    findOneWithDecryption.mockResolvedValue(makeProposal())
    const { fn, context, executed } = makeHarness({ userFeatures: ['tickets.manage'] })

    const result = await fn({ proposalId: PROPOSAL_ID }, context)

    expect(executed).toHaveLength(0)
    expect(result.results[0]).toMatchObject({ type: REFUND, status: 'skipped' })
    expect(result.results[0].error).toContain('not authorized')
  })

  test('a command the tenant has not enabled is blocked', async () => {
    clearWorkflowSafeCommandsForTests()
    registerWorkflowSafeCommands([
      { commandId: REFUND, requiredFeatures: ['reservations.refund.manage'] },
      { commandId: TRANSITION, requiredFeatures: ['tickets.manage'], defaultEnabled: true },
      { commandId: REPLY, requiredFeatures: ['tickets.manage'], defaultEnabled: true },
    ])
    findOneWithDecryption.mockResolvedValue(makeProposal())
    const { fn, context, executed } = makeHarness()

    const result = await fn({ proposalId: PROPOSAL_ID }, context)

    expect(executed).toHaveLength(0)
    expect(result.results[0].error).toContain('not enabled for this tenant')
  })

  test('without an acting workflow user nothing runs', async () => {
    findOneWithDecryption.mockResolvedValue(makeProposal())
    const { fn, context, executed } = makeHarness()

    const result = await fn({ proposalId: PROPOSAL_ID }, { ...context, userId: undefined })

    expect(executed).toHaveLength(0)
    expect(result.ok).toBe(false)
  })

  test.each(['pending', 'rejected', 'none_proposed'] as const)('a %s proposal is rejected', async (disposition) => {
    findOneWithDecryption.mockResolvedValue(makeProposal({ disposition, selectedOptionId: null }))
    const { fn, context, executed } = makeHarness()

    await expect(fn({ proposalId: PROPOSAL_ID }, context)).rejects.toThrow('proposal is not approved')
    expect(executed).toHaveLength(0)
  })

  test('edited and auto_approved proposals execute', async () => {
    for (const disposition of ['edited', 'auto_approved'] as const) {
      findOneWithDecryption.mockResolvedValue(makeProposal({ disposition }))
      const { fn, context } = makeHarness()
      const result = await fn({ proposalId: PROPOSAL_ID }, context)
      expect(result.ok).toBe(true)
    }
  })

  test('an approved proposal with no recorded selection fails closed', async () => {
    findOneWithDecryption.mockResolvedValue(makeProposal({ selectedOptionId: null }))
    const { fn, context } = makeHarness()

    await expect(fn({ proposalId: PROPOSAL_ID }, context)).rejects.toThrow('no selected option')
  })

  test('a missing proposal and an eval-replay proposal are refused', async () => {
    findOneWithDecryption.mockResolvedValue(null)
    const first = makeHarness()
    await expect(first.fn({ proposalId: PROPOSAL_ID }, first.context)).rejects.toThrow('proposal not found')

    findOneWithDecryption.mockResolvedValue(makeProposal({ source: 'eval' }))
    const second = makeHarness()
    await expect(second.fn({ proposalId: PROPOSAL_ID }, second.context)).rejects.toThrow('eval-replay')
  })

  test('invalid arguments are refused', async () => {
    const { fn, context } = makeHarness()
    await expect(fn({ proposalId: 'not-a-uuid' }, context)).rejects.toThrow('valid "proposalId"')
  })

  test('is idempotent: a second call replays the recorded results and runs nothing', async () => {
    findOneWithDecryption.mockResolvedValue(makeProposal())
    const { fn, context, executed, spans } = makeHarness({ failing: { [REPLY]: 'smtp down' } })

    const first = await fn({ proposalId: PROPOSAL_ID }, context)
    const second = await fn({ proposalId: PROPOSAL_ID }, context)

    expect(executed).toHaveLength(3)
    expect(spans).toHaveLength(1)
    expect(spans[0]).toMatchObject({
      externalSpanId: proposalExecutionSpanId(PROPOSAL_ID),
      agentRunId: RUN_ID,
      kind: 'system',
      status: 'error',
    })
    expect(second).toEqual({ ...first, replayed: true })
    expect(emitEvent).toHaveBeenCalledTimes(1)
  })

  test('a claim still running is not executed again', async () => {
    findOneWithDecryption.mockResolvedValue(makeProposal())
    const { fn, context, executed, spans } = makeHarness()
    spans.push({
      externalSpanId: proposalExecutionSpanId(PROPOSAL_ID),
      sequence: 4,
      attributes: { state: 'running', proposalId: PROPOSAL_ID, selectedOptionId: 'refund' },
    })

    await expect(fn({ proposalId: PROPOSAL_ID }, context)).rejects.toThrow('already in progress')
    expect(executed).toHaveLength(0)
  })

  test('a caller-supplied actionCommandMap overrides the identity mapping', async () => {
    registerWorkflowSafeCommands([
      { commandId: 'tickets.reply.send_v2', requiredFeatures: ['tickets.manage'], defaultEnabled: true },
    ])
    agentEntries.set(AGENT_ID, { allowedActions: [REFUND, TRANSITION, REPLY] })
    findOneWithDecryption.mockResolvedValue(makeProposal())
    const { fn, context, executed } = makeHarness()

    const result = await fn(
      { proposalId: PROPOSAL_ID, actionCommandMap: { [REPLY]: 'tickets.reply.send_v2' } },
      context,
    )

    expect(executed.map((entry) => entry.commandId)).toEqual([REFUND, TRANSITION, 'tickets.reply.send_v2'])
    expect(result.results[2]).toEqual({ type: REPLY, commandId: 'tickets.reply.send_v2', status: 'ok' })
  })

  test('the function name is the documented one', () => {
    expect(EXECUTE_APPROVED_PROPOSAL_FUNCTION).toBe('agent_orchestrator.execute_approved_proposal')
  })
})
