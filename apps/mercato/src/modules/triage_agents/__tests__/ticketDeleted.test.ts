/** @jest-environment node */
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { TicketTriage } from '../data/entities'
import handle, { metadata } from '../subscribers/ticket-deleted'
import { isSupersededAttempt, recordTriageStage, toTriageView } from '../lib/projection'
import { rebuildTriageProjection } from '../lib/rebuild'
import { resolveTriageStatus } from '../components/triageTypes'

const emitMock = jest.fn()

jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))
jest.mock('../events', () => ({ emitTriageAgentsEvent: (...args: unknown[]) => emitMock(...args) }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({ findWithDecryption: jest.fn(async () => []) }))
jest.mock('@open-mercato/core/modules/workflows/data/entities', () => ({ WorkflowInstance: class WorkflowInstance {} }))

const SCOPE = { tenantId: '11111111-1111-4111-8111-111111111111', organizationId: '22222222-2222-4222-8222-222222222222' }
const TICKET_ID = '33333333-3333-4333-8333-333333333333'
const OLD_INSTANCE = '55555555-5555-4555-8555-555555555555'
const OLD_EXECUTION = '66666666-6666-4666-8666-666666666666'
const PROPOSAL_ID = '77777777-7777-4777-8777-777777777777'
const NEW_INSTANCE = '88888888-8888-4888-8888-888888888888'

function triageRow(overrides: Partial<TicketTriage> = {}): TicketTriage {
  const row = new TicketTriage()
  Object.assign(row, {
    id: '99999999-9999-4999-8999-999999999999',
    ...SCOPE,
    ticketId: TICKET_ID,
    ticketNumber: 'TCK-000002',
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
    ...overrides,
  })
  return row
}

function harness(row: TicketTriage | null, dispose: () => Promise<unknown> = async () => ({ result: { ok: true } })) {
  const em = {
    fork: () => em,
    findOne: jest.fn(async () => row),
    flush: jest.fn(async () => undefined),
    persist: jest.fn(),
    getConnection: () => ({ execute: async () => [] }),
  }
  const commandBus = { execute: jest.fn(async () => dispose()) }
  const services: Record<string, unknown> = { em, commandBus }
  const ctx = { resolve: <T = unknown>(name: string) => services[name] as T, tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId }
  return { em, commandBus, ctx }
}

const payload = { id: TICKET_ID, ticketId: TICKET_ID, ...SCOPE, number: 'TCK-000002' }

beforeEach(() => {
  emitMock.mockReset()
})

describe('ticket-deleted subscriber', () => {
  it('is a persistent subscriber of tickets.ticket.deleted', () => {
    expect(metadata).toEqual({ event: 'tickets.ticket.deleted', persistent: true, id: 'triage_agents:ticket-deleted' })
  })

  it('rejects the pending proposal with ticket_deleted and cancels the projection', async () => {
    const row = triageRow()
    const { ctx, commandBus } = harness(row)
    await handle(payload, ctx)
    expect(commandBus.execute).toHaveBeenCalledTimes(1)
    const [commandId, call] = commandBus.execute.mock.calls[0] as unknown as [string, { input: Record<string, unknown>; ctx: Record<string, unknown> }]
    expect(commandId).toBe('agent_orchestrator.proposals.dispose')
    expect(call.input).toEqual({ proposalId: PROPOSAL_ID, ...SCOPE, userId: null, disposition: 'rejected', reason: 'ticket_deleted' })
    expect(call.ctx).toMatchObject({ auth: null, selectedOrganizationId: SCOPE.organizationId })
    expect(row).toMatchObject({ stage: 'cancelled', reasonCode: 'ticket_deleted', attempt: 2, workflowInstanceId: null, proposalId: null, disposition: null })
    expect(row.attempts).toEqual([
      expect.objectContaining({ attempt: 1, workflowInstanceId: OLD_INSTANCE, stage: 'awaiting_approval', disposition: 'rejected', reasonCode: 'ticket_deleted' }),
    ])
    expect(isSupersededAttempt(row, OLD_INSTANCE)).toBe(true)
    expect(resolveTriageStatus(toTriageView(row))).toBe('cancelled')
    expect(emitMock).toHaveBeenCalledWith(
      'triage_agents.triage.updated',
      expect.objectContaining({ ticketId: TICKET_ID, stage: 'cancelled' }),
      SCOPE,
    )
  })

  it('is idempotent: a second delivery leaves the cancelled projection alone', async () => {
    const row = triageRow()
    const { ctx, commandBus } = harness(row)
    await handle(payload, ctx)
    await handle(payload, ctx)
    expect(commandBus.execute).toHaveBeenCalledTimes(1)
    expect(row.attempt).toBe(2)
    expect(row.attempts).toHaveLength(1)
    expect(emitMock).toHaveBeenCalledTimes(1)
  })

  it('cancels a projection without a pending proposal and does not dispose anything', async () => {
    const row = triageRow({ stage: 'done', aiMode: 'manual_review', reasonCode: 'proposal_rejected', disposition: 'rejected' })
    const { ctx, commandBus } = harness(row)
    await handle(payload, ctx)
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(row).toMatchObject({ stage: 'cancelled', reasonCode: 'ticket_deleted' })
    expect(row.attempts).toEqual([expect.objectContaining({ stage: 'done', reasonCode: 'proposal_rejected', disposition: 'rejected' })])
  })

  it('marks an in-flight attempt as closed by the deletion', async () => {
    const row = triageRow({ stage: 'classifying', proposalId: null, aiMode: null })
    const { ctx, commandBus } = harness(row)
    await handle(payload, ctx)
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(row.attempts).toEqual([expect.objectContaining({ stage: 'classifying', reasonCode: 'ticket_deleted', disposition: null })])
  })

  it('does nothing for a ticket that was never triaged', async () => {
    const { ctx, commandBus } = harness(null)
    await handle(payload, ctx)
    expect(commandBus.execute).not.toHaveBeenCalled()
    expect(emitMock).not.toHaveBeenCalled()
  })

  it('keeps the cancellation when the proposal was already settled', async () => {
    const row = triageRow()
    const { ctx } = harness(row, async () => {
      throw new CrudHttpError(409, { error: '[internal] proposal already disposed' })
    })
    await handle(payload, ctx)
    expect(row.stage).toBe('cancelled')
  })

  it('restores the attempt and rethrows when the dispose fails otherwise', async () => {
    const row = triageRow()
    const { ctx } = harness(row, async () => {
      throw new Error('[internal] dispose failed')
    })
    await expect(handle(payload, ctx)).rejects.toThrow('dispose failed')
    expect(row).toMatchObject({ stage: 'awaiting_approval', attempt: 1, workflowInstanceId: OLD_INSTANCE, proposalId: PROPOSAL_ID })
    expect(row.attempts).toBeNull()
  })
})

describe('cancelled projection', () => {
  it('ignores the old workflow record_stage writes after the deletion', async () => {
    const row = triageRow()
    const { ctx, em } = harness(row)
    await handle(payload, ctx)
    em.flush.mockClear()
    const result = await recordTriageStage(
      em as never,
      SCOPE,
      { ticketId: TICKET_ID, stage: 'done', aiMode: 'manual_review', reasonCode: 'proposal_rejected', disposition: 'rejected' } as never,
      OLD_INSTANCE,
    )
    expect(result).toMatchObject({ superseded: true, stage: 'cancelled' })
    expect(row.reasonCode).toBe('ticket_deleted')
    expect(em.flush).not.toHaveBeenCalled()
  })

  it('lets a re-run of a restored ticket adopt the cancelled row', async () => {
    const row = triageRow()
    const { ctx, em } = harness(row)
    await handle(payload, ctx)
    const result = await recordTriageStage(em as never, SCOPE, { ticketId: TICKET_ID, stage: 'identifying' } as never, NEW_INSTANCE)
    expect(result).toMatchObject({ superseded: false, stage: 'identifying', attempt: 2 })
    expect(row.workflowInstanceId).toBe(NEW_INSTANCE)
  })
})

describe('rebuild-projection repair', () => {
  it('cancels rebuilt rows of deleted tickets and rejects their pending proposal', async () => {
    const row = triageRow()
    const rejectProposal = jest.fn(async () => undefined)
    const ticketPresence = jest.fn(async () => new Set<string>())
    const findWithDecryption = jest.requireMock('@open-mercato/shared/lib/encryption/find').findWithDecryption as jest.Mock
    findWithDecryption.mockResolvedValueOnce([
      {
        id: OLD_INSTANCE,
        status: 'RUNNING',
        currentStepId: 'resolve',
        context: { ticketId: TICKET_ID, ticketNumber: 'TCK-000002', proposalId: PROPOSAL_ID },
      },
    ])
    const em = {
      findOne: jest.fn(async () => row),
      flush: jest.fn(async () => undefined),
      persist: jest.fn(),
      nativeDelete: jest.fn(async () => 1),
      getConnection: () => ({ execute: async () => [] }),
    }
    const result = await rebuildTriageProjection(em as never, SCOPE, { ticketPresence, rejectProposal })
    expect(result).toEqual({ instances: 1, rebuilt: 1, cancelled: 1 })
    expect(ticketPresence).toHaveBeenCalledWith(SCOPE, [TICKET_ID])
    expect(rejectProposal).toHaveBeenCalledWith(PROPOSAL_ID, 'ticket_deleted')
    expect(row.stage).toBe('cancelled')
  })
})
