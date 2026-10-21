/** @jest-environment node */
import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { TicketTriage } from '../data/entities'
import { startTriageRerun } from '../lib/rerun'
import { isSupersededAttempt, recordTriageStage, supersedeCurrentAttempt, toAttemptViews, toTriageView } from '../lib/projection'

jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))

const SCOPE = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const TICKET_ID = '33333333-3333-4333-8333-333333333333'
const USER_ID = '44444444-4444-4444-8444-444444444444'
const OLD_INSTANCE = '55555555-5555-4555-8555-555555555555'
const OLD_EXECUTION = '66666666-6666-4666-8666-666666666666'
const PROPOSAL_ID = '77777777-7777-4777-8777-777777777777'
const NEW_EXECUTION = '88888888-8888-4888-8888-888888888888'

function pendingRow(): TicketTriage {
  const row = new TicketTriage()
  Object.assign(row, {
    id: '99999999-9999-4999-8999-999999999999',
    ...SCOPE,
    ticketId: TICKET_ID,
    ticketNumber: 'TCK-1',
    workflowInstanceId: OLD_INSTANCE,
    processExecutionId: OLD_EXECUTION,
    stage: 'awaiting_approval',
    aiMode: 'assisted',
    proposalId: PROPOSAL_ID,
    disposition: null,
    draftState: 'prepared',
    groundingState: 'verified',
    recommendedActionLabel: 'Verify the overpayment and request a refund',
    attempt: 1,
    attempts: null,
    updatedAt: new Date('2026-10-13T09:00:00.000Z'),
  })
  return row
}

type Harness = {
  row: TicketTriage
  calls: string[]
  commandBus: { execute: jest.Mock }
  rbac: { userHasAllFeatures: jest.Mock }
  container: { resolve: <T = unknown>(name: string) => T }
}

function harness(options: { canDispose?: boolean; disposeFails?: boolean } = {}): Harness {
  const row = pendingRow()
  const calls: string[] = []
  const em = {
    fork: () => em,
    getConnection: () => ({ execute: async () => [{ id: TICKET_ID, number: 'TCK-1' }] }),
    findOne: async (entity: unknown) => (entity === TicketTriage ? row : { id: 'process-definition-1' }),
    flush: jest.fn(async () => {
      calls.push(`flush:${row.workflowInstanceId ?? 'none'}`)
    }),
  }
  const commandBus = {
    execute: jest.fn(async (commandId: string) => {
      calls.push(commandId)
      if (commandId === 'agent_orchestrator.proposals.dispose' && options.disposeFails) throw new Error('[internal] dispose failed')
      return { result: commandId === 'agent_orchestrator.processes.startExecution' ? { executionId: NEW_EXECUTION } : { ok: true } }
    }),
  }
  const rbac = { userHasAllFeatures: jest.fn(async () => options.canDispose !== false) }
  const services: Record<string, unknown> = { em, commandBus, rbacService: rbac }
  return { row, calls, commandBus, rbac, container: { resolve: <T = unknown>(name: string) => services[name] as T } }
}

const ctx = { auth: { sub: USER_ID }, request: new Request('http://localhost/api') } as unknown as CommandRuntimeContext

describe('triage re-run with supersede', () => {
  it('refuses a re-run while a proposal is pending unless supersede is requested', async () => {
    const { container, commandBus } = harness()
    await expect(startTriageRerun(container, ctx, SCOPE, TICKET_ID, USER_ID)).rejects.toMatchObject({ status: 409, body: { code: 'pending_proposal' } })
    expect(commandBus.execute).not.toHaveBeenCalled()
  })

  it('requires agent_orchestrator.proposals.dispose to supersede', async () => {
    const { container, commandBus, rbac, row } = harness({ canDispose: false })
    await expect(startTriageRerun(container, ctx, SCOPE, TICKET_ID, USER_ID, { supersede: true })).rejects.toMatchObject({ status: 403 })
    expect(rbac.userHasAllFeatures).toHaveBeenCalledWith(USER_ID, ['agent_orchestrator.proposals.dispose'], SCOPE)
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(row.proposalId).toBe(PROPOSAL_ID)
  })

  it('closes the attempt, rejects the proposal through AO dispose and links the new execution', async () => {
    const { container, commandBus, row, calls } = harness()
    const result = await startTriageRerun(container, ctx, SCOPE, TICKET_ID, USER_ID, { supersede: true })
    expect(result).toEqual({ executionId: NEW_EXECUTION, attempt: 2, supersededProposalIds: [PROPOSAL_ID] })
    expect(calls).toEqual(['flush:none', 'agent_orchestrator.proposals.dispose', 'agent_orchestrator.processes.startExecution'])
    const dispose = commandBus.execute.mock.calls[0][1] as { input: Record<string, unknown>; ctx: { request?: unknown } }
    expect(dispose.input).toMatchObject({ proposalId: PROPOSAL_ID, disposition: 'rejected', reason: 'superseded_by_rerun', userId: USER_ID, ...SCOPE })
    expect(dispose.ctx.request).toBeUndefined()
    const start = commandBus.execute.mock.calls[1][1] as { input: Record<string, unknown> }
    expect(start.input).toMatchObject({
      input: { ticketId: TICKET_ID, ticketNumber: 'TCK-1' },
      triggeredBy: { kind: 'manual', ref: USER_ID, rerunOfExecutionId: OLD_EXECUTION },
    })
    expect(row).toMatchObject({ attempt: 2, stage: 'queued', workflowInstanceId: null, processExecutionId: null, proposalId: null, disposition: null })
    expect(row.attempts).toEqual([
      expect.objectContaining({ attempt: 1, workflowInstanceId: OLD_INSTANCE, processExecutionId: OLD_EXECUTION, disposition: 'rejected', reasonCode: 'superseded_by_rerun' }),
    ])
    expect(isSupersededAttempt(row, OLD_INSTANCE)).toBe(true)
  })

  it('restores the projection when the dispose fails', async () => {
    const { container, row, commandBus } = harness({ disposeFails: true })
    await expect(startTriageRerun(container, ctx, SCOPE, TICKET_ID, USER_ID, { supersede: true })).rejects.toThrow('dispose failed')
    expect(row).toMatchObject({ attempt: 1, stage: 'awaiting_approval', workflowInstanceId: OLD_INSTANCE, proposalId: PROPOSAL_ID })
    expect(row.attempts).toBeNull()
    expect(commandBus.execute).toHaveBeenCalledTimes(1)
  })

  it('does not link a plain re-run of a settled triage', async () => {
    const { container, commandBus, row } = harness()
    row.stage = 'done'
    row.disposition = 'edited'
    const result = await startTriageRerun(container, ctx, SCOPE, TICKET_ID, USER_ID, { supersede: true })
    expect(result.supersededProposalIds).toEqual([])
    expect(commandBus.execute).toHaveBeenCalledTimes(1)
    expect((commandBus.execute.mock.calls[0][1] as { input: { triggeredBy: Record<string, unknown> } }).input.triggeredBy).toEqual({ kind: 'manual', ref: USER_ID })
  })
})

describe('superseded attempt projection', () => {
  it('ignores late writes of the superseded workflow and reports them as superseded', async () => {
    const row = pendingRow()
    supersedeCurrentAttempt(row)
    const em = { findOne: async () => row, flush: jest.fn(), persist: jest.fn(), getConnection: jest.fn() }
    const result = await recordTriageStage(
      em as never,
      SCOPE,
      { ticketId: TICKET_ID, stage: 'done', aiMode: 'manual_review', reasonCode: 'proposal_rejected', disposition: 'rejected' } as never,
      OLD_INSTANCE,
    )
    expect(result).toMatchObject({ superseded: true, stage: 'queued', attempt: 2 })
    expect(row.reasonCode).toBeNull()
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('exposes the attempt history with execution ids on the triage view', () => {
    const row = pendingRow()
    supersedeCurrentAttempt(row)
    row.processExecutionId = NEW_EXECUTION
    expect(toAttemptViews(row)).toEqual([
      {
        attempt: 1,
        executionId: OLD_EXECUTION,
        stage: 'awaiting_approval',
        aiMode: 'assisted',
        reasonCode: 'superseded_by_rerun',
        disposition: 'rejected',
        recordedAt: '2026-10-13T09:00:00.000Z',
      },
    ])
    expect(toTriageView(row)).toMatchObject({ executionId: NEW_EXECUTION, attempt: 2, attempts: [expect.objectContaining({ executionId: OLD_EXECUTION })] })
  })
})
