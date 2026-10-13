/** @jest-environment node */
import { GET as getFlow, metadata as flowMetadata } from '../api/executions/[id]/flow/route'
import { POST as postRerun, metadata as rerunMetadata } from '../api/executions/[id]/rerun/route'
import { runListQuerySchema, processExecutionListQuerySchema, processRunTriggeredBySchema } from '../data/validators'

jest.mock('@open-mercato/shared/lib/auth/server', () => ({ getAuthFromRequest: jest.fn() }))
jest.mock('@open-mercato/shared/lib/di/container', () => ({ createRequestContainer: jest.fn() }))
jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: jest.fn(),
  findWithDecryption: jest.fn(),
}))
jest.mock('@open-mercato/shared/lib/crud/mutation-guard', () => ({
  validateCrudMutationGuard: jest.fn(async () => null),
  runCrudMutationGuardAfterSuccess: jest.fn(),
}))

const TENANT = '11111111-1111-4111-8111-111111111111'
const ORG = '22222222-2222-4222-8222-222222222222'
const USER = '33333333-3333-4333-8333-333333333333'
const EXECUTION = '44444444-4444-4444-8444-444444444444'
const INSTANCE = '55555555-5555-4555-8555-555555555555'
const DEFINITION = '66666666-6666-4666-8666-666666666666'
const PROPOSAL = '77777777-7777-4777-8777-777777777777'
const NEW_EXECUTION = '88888888-8888-4888-8888-888888888888'

const EXECUTION_ROW = {
  id: EXECUTION,
  tenantId: TENANT,
  organizationId: ORG,
  workflowInstanceId: INSTANCE,
  processDefinitionId: DEFINITION,
  workflowId: 'ticket_triage',
  status: 'waiting_on_you',
  input: { ticketId: 'T-1' },
  sourceEntityType: 'tickets:ticket',
  sourceEntityId: null,
  triggeredBy: { kind: 'event', ref: 'tickets.ticket.created' },
  openedAt: new Date('2026-10-12T10:00:00.000Z'),
  completedAt: null,
}

const DEFINITION_ROW = {
  id: DEFINITION,
  triggers: [{ kind: 'manual', requireFeatures: [] }, { kind: 'event', eventPattern: 'tickets.ticket.created' }],
}

type Setup = {
  execution?: unknown
  pending?: Array<{ id: string }>
  definition?: unknown
  canDispose?: boolean
}

async function setup({ execution = EXECUTION_ROW, pending = [], definition = DEFINITION_ROW, canDispose = true }: Setup = {}) {
  const { getAuthFromRequest } = await import('@open-mercato/shared/lib/auth/server')
  const { createRequestContainer } = await import('@open-mercato/shared/lib/di/container')
  const { findOneWithDecryption, findWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
  ;(getAuthFromRequest as jest.Mock).mockResolvedValue({ sub: USER, tenantId: TENANT, orgId: ORG })
  ;(findOneWithDecryption as jest.Mock).mockImplementation(async (_em: unknown, entity: { name?: string }, where: Record<string, unknown>) => {
    if (entity?.name === 'ProcessDefinition') return definition
    if (where.workflowInstanceId === INSTANCE || where.id === EXECUTION) return execution
    return null
  })
  ;(findWithDecryption as jest.Mock).mockImplementation(async (_em: unknown, entity: { name?: string }) =>
    entity?.name === 'AgentProposal' ? pending : [],
  )
  const execute = jest.fn(async (commandId: string) => {
    if (commandId === 'agent_orchestrator.processes.startExecution') return { result: { executionId: NEW_EXECUTION, deduplicated: false } }
    return { result: { proposalId: PROPOSAL, disposition: 'rejected' } }
  })
  const userHasAllFeatures = jest.fn(async (_user: string, features: string[]) =>
    features.includes('agent_orchestrator.proposals.dispose') ? canDispose : true,
  )
  ;(createRequestContainer as jest.Mock).mockResolvedValue({
    resolve: (token: string) => {
      if (token === 'em') return { fork: () => ({ find: async () => [], findOne: async () => null }) }
      if (token === 'commandBus') return { execute }
      if (token === 'rbacService') return { userHasAllFeatures }
      return null
    },
  })
  return { execute, userHasAllFeatures }
}

function rerunRequest(body: unknown) {
  return new Request(`http://localhost/api/agent_orchestrator/executions/${EXECUTION}/rerun`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('flow + rerun route gates', () => {
  it('flow requires trace.view; rerun requires processes.run', () => {
    expect(flowMetadata.GET).toEqual({ requireAuth: true, requireFeatures: ['agent_orchestrator.trace.view'] })
    expect(rerunMetadata.POST).toEqual({ requireAuth: true, requireFeatures: ['agent_orchestrator.processes.run'] })
  })

  it('accepts the additive list filters and the rerun link on triggered_by', () => {
    expect(runListQuerySchema.parse({ workflowInstanceId: INSTANCE }).workflowInstanceId).toBe(INSTANCE)
    expect(runListQuerySchema.safeParse({ workflowInstanceId: 'nope' }).success).toBe(false)
    expect(processExecutionListQuerySchema.parse({ subjectType: 'tickets:ticket', subjectId: 'T-1' }).subjectId).toBe('T-1')
    expect(processRunTriggeredBySchema.parse({ kind: 'manual', ref: USER, rerunOfExecutionId: EXECUTION })).toEqual({
      kind: 'manual',
      ref: USER,
      rerunOfExecutionId: EXECUTION,
    })
  })
})

describe('GET /executions/:id/flow', () => {
  beforeEach(() => jest.clearAllMocks())

  it('404s an execution outside the caller scope', async () => {
    await setup({ execution: null })
    const res = await getFlow(new Request('http://localhost/x'), { params: Promise.resolve({ id: EXECUTION }) })
    expect(res.status).toBe(404)
  })

  it('scopes the lookup to the caller tenant and organization and returns the flow', async () => {
    await setup()
    const { findOneWithDecryption } = await import('@open-mercato/shared/lib/encryption/find')
    const res = await getFlow(new Request('http://localhost/x'), { params: Promise.resolve({ id: INSTANCE }) })
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.execution).toMatchObject({ id: EXECUTION, workflowInstanceId: INSTANCE })
    expect(body.nodes[0]).toMatchObject({ kind: 'trigger', seq: 1 })
    expect((findOneWithDecryption as jest.Mock).mock.calls[0][2]).toMatchObject({ tenantId: TENANT, organizationId: ORG, deletedAt: null })
  })
})

describe('POST /executions/:id/rerun', () => {
  beforeEach(() => jest.clearAllMocks())

  it('starts a new execution with the original input, linked to the original', async () => {
    const { execute } = await setup()
    const res = await postRerun(rerunRequest({}), { params: Promise.resolve({ id: EXECUTION }) })
    expect(res.status).toBe(202)
    expect(await res.json()).toEqual({ executionId: NEW_EXECUTION, rerunOfExecutionId: EXECUTION, supersededProposalIds: [] })
    expect(execute).toHaveBeenCalledTimes(1)
    expect(execute.mock.calls[0][0]).toBe('agent_orchestrator.processes.startExecution')
    expect(execute.mock.calls[0][1].input).toMatchObject({
      tenantId: TENANT,
      organizationId: ORG,
      processDefinitionId: DEFINITION,
      input: { ticketId: 'T-1' },
      sourceEntityType: 'tickets:ticket',
      idempotencyKey: null,
      triggeredBy: { kind: 'manual', ref: USER, rerunOfExecutionId: EXECUTION },
    })
  })

  it('refuses with 409 pending_proposal while the original awaits a decision', async () => {
    const { execute } = await setup({ pending: [{ id: PROPOSAL }] })
    const res = await postRerun(rerunRequest({}), { params: Promise.resolve({ id: EXECUTION }) })
    expect(res.status).toBe(409)
    expect(await res.json()).toMatchObject({ code: 'pending_proposal', pendingProposalIds: [PROPOSAL] })
    expect(execute).not.toHaveBeenCalled()
  })

  it('supersede rejects the pending proposal through the dispose command before starting', async () => {
    const { execute } = await setup({ pending: [{ id: PROPOSAL }] })
    const res = await postRerun(rerunRequest({ supersede: true }), { params: Promise.resolve({ id: EXECUTION }) })
    expect(res.status).toBe(202)
    expect(execute.mock.calls.map((call) => call[0])).toEqual([
      'agent_orchestrator.proposals.dispose',
      'agent_orchestrator.processes.startExecution',
    ])
    expect(execute.mock.calls[0][1].input).toMatchObject({
      proposalId: PROPOSAL,
      disposition: 'rejected',
      reason: 'superseded_by_rerun',
      userId: USER,
    })
  })

  it('supersede without proposals.dispose is 403', async () => {
    await setup({ pending: [{ id: PROPOSAL }], canDispose: false })
    const res = await postRerun(rerunRequest({ supersede: true }), { params: Promise.resolve({ id: EXECUTION }) })
    expect(res.status).toBe(403)
  })

  it('refuses a process with no manual trigger', async () => {
    await setup({ definition: { ...DEFINITION_ROW, triggers: [{ kind: 'event', eventPattern: 'x.y.z' }] } })
    const res = await postRerun(rerunRequest({}), { params: Promise.resolve({ id: EXECUTION }) })
    expect(res.status).toBe(403)
    expect(await res.json()).toMatchObject({ code: 'no_manual_trigger' })
  })
})
