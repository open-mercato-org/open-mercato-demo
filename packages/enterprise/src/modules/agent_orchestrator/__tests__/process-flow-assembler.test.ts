/** @jest-environment node */
import {
  assembleProcessFlow,
  diffEditedFields,
  flattenOutputFacts,
  readRerunOfExecutionId,
  summarizeToolArgs,
  type FlowAssemblerInput,
  type FlowNode,
} from '../lib/trace/flowAssembler'
import { readDefinitionTransitions } from '../lib/trace/flowLoader'

const EXECUTION_ID = '11111111-1111-4111-8111-111111111111'
const INSTANCE_ID = '22222222-2222-4222-8222-222222222222'
const RUN_ID = '33333333-3333-4333-8333-333333333333'
const PROPOSAL_ID = '44444444-4444-4444-8444-444444444444'
const ORIGINAL_ID = '55555555-5555-4555-8555-555555555555'

const at = (seconds: number) => new Date(Date.UTC(2026, 9, 12, 10, 0, seconds)).toISOString()

const PAYLOAD = {
  options: [
    {
      id: 'refund',
      label: 'Refund the overpayment',
      confidence: 0.9,
      actions: [
        { type: 'reservations.refund.request', payload: { amount: 350, iban: 'PL61109010140000071219812874' } },
        { type: 'tickets.ticket.reply', payload: { body: 'Dear customer, we refund 350.' }, citations: ['kb@3#S5'] },
      ],
    },
  ],
  rationale: 'Paid more than the total.',
  evidence: {
    checks: [{ key: 'overpayment_confirmed', step: 'S2', passed: true, evidence: 'paid 2750 > 2400' }],
    citations: [{ kind: 'kb', ref: 'payments.refunds.overpayment_refund@3', steps: ['S1', 'S2'], label: 'Overpayment refund (v3)' }],
  },
}

function baseInput(overrides: Partial<FlowAssemblerInput> = {}): FlowAssemblerInput {
  return {
    execution: {
      id: EXECUTION_ID,
      workflowInstanceId: INSTANCE_ID,
      processDefinitionId: null,
      workflowId: 'ticket_triage',
      status: 'completed',
      subjectType: 'tickets:ticket',
      subjectId: 'T-1',
      subjectLabel: 'T-1',
      triggeredBy: { kind: 'event', ref: 'tickets.ticket.created' },
      sourceEntityType: 'tickets:ticket',
      sourceEntityId: null,
      inputKeys: ['ticketId', 'apiKey'],
      openedAt: at(0),
      completedAt: at(30),
    },
    steps: [
      { id: 'si-1', stepId: 'advisor', stepName: 'Resolution advisor', stepType: 'AUTOMATED', status: 'COMPLETED', enteredAt: at(1), exitedAt: at(20), executionTimeMs: null },
      { id: 'si-2', stepId: 'apply', stepName: 'Apply proposal', stepType: 'AUTOMATED', status: 'COMPLETED', enteredAt: at(21), exitedAt: at(25), executionTimeMs: 4000 },
    ],
    events: [
      { id: 'ev-1', eventType: 'OUTCOME_ROUTED', eventData: { stepId: 'advisor', outcome: 'approved', toStepId: 'apply' }, occurredAt: at(20), stepInstanceId: 'si-1', userId: null },
      { id: 'ev-2', eventType: 'TRANSITION_EXECUTED', eventData: { transitionId: 't-classify', fromStepId: 'advisor', toStepId: 'apply' }, occurredAt: at(20), stepInstanceId: null, userId: null },
    ],
    transitions: [
      {
        transitionId: 't-classify',
        fromStepId: 'advisor',
        toStepId: 'apply',
        activities: [{ activityName: 'policy', activityType: 'EXECUTE_FUNCTION', functionName: 'triage_agents.route' }],
      },
    ],
    runs: [
      {
        id: RUN_ID,
        agentId: 'resolution_advisor',
        stepId: 'advisor',
        parentRunId: null,
        status: 'ok',
        resultKind: 'proposal',
        confidence: 0.9,
        model: 'scripted',
        latencyMs: 5000,
        errorMessage: null,
        output: { kind: 'proposal', proposal: { rationale: 'Paid more', secret: 'shh' } },
        createdAt: at(2),
        completedAt: at(7),
        rerunOfRunId: null,
      },
    ],
    spans: [],
    toolCalls: [
      {
        id: 'tc-1',
        spanId: 'sp-1',
        agentRunId: RUN_ID,
        toolName: 'reservations.get',
        requestSummary: { reservationId: 'R-9', _sessionToken: 'live-token-value' },
        responseSummary: { total: 2400, paid: 2750, holder: 'Jane Doe' },
        status: 'ok',
        latencyMs: 300,
        errorMessage: null,
        createdAt: at(4),
      },
    ],
    proposals: [
      {
        id: PROPOSAL_ID,
        runId: RUN_ID,
        agentId: 'resolution_advisor',
        stepId: 'advisor',
        payload: PAYLOAD,
        disposition: 'approved',
        dispositionBy: 'user-1',
        dispositionReason: null,
        selectedOptionId: 'refund',
        createdAt: at(8),
        updatedAt: at(15),
      },
    ],
    corrections: [],
    ...overrides,
  }
}

function byKind(nodes: FlowNode[], kind: FlowNode['kind']): FlowNode[] {
  return nodes.filter((node) => node.kind === kind)
}

describe('assembleProcessFlow — success path', () => {
  const flow = assembleProcessFlow(
    baseInput({
      spans: [
        {
          id: 'span-exec',
          agentRunId: RUN_ID,
          externalSpanId: `proposal-execution:${PROPOSAL_ID}`,
          name: 'agent_orchestrator.proposal.execute',
          kind: 'system',
          status: 'ok',
          startedAt: at(22),
          endedAt: at(23),
          durationMs: 900,
          attributes: {
            state: 'done',
            ok: true,
            results: [
              { type: 'reservations.refund.request', commandId: 'reservations.refund.request', status: 'ok' },
              { type: 'tickets.ticket.reply', commandId: 'tickets.ticket.reply', status: 'ok' },
            ],
          },
        },
      ],
    }),
  )

  it('orders every node by recorded time with a dense 1-based seq', () => {
    expect(flow.nodes.map((node) => node.seq)).toEqual(flow.nodes.map((_, index) => index + 1))
    expect(flow.nodes.map((node) => node.kind)).toEqual([
      'trigger',
      'step',
      'agent_run',
      'tool_call',
      'disposition',
      'function',
      'step',
      'effector',
    ])
  })

  it('nests agent runs under their step, tool calls under their run, the effector under the disposition', () => {
    const [run] = byKind(flow.nodes, 'agent_run')
    const [tool] = byKind(flow.nodes, 'tool_call')
    const [disposition] = byKind(flow.nodes, 'disposition')
    const [effector] = byKind(flow.nodes, 'effector')
    expect(run.parentId).toBe('step:si-1')
    expect(tool.parentId).toBe(run.id)
    expect(disposition.parentId).toBe(run.id)
    expect(effector.parentId).toBe(disposition.id)
  })

  it('derives statuses and summaries from the joined records', () => {
    const [advisor] = byKind(flow.nodes, 'step')
    expect(advisor.status).toBe('succeeded')
    expect(advisor.summary).toMatchObject({ routedOutcome: 'approved', routedTo: 'apply' })
    expect(advisor.durationMs).toBe(19000)
    const [disposition] = byKind(flow.nodes, 'disposition')
    expect(disposition.status).toBe('succeeded')
    expect(disposition.summary).toMatchObject({ decision: 'approved', actorKind: 'user', selectedOptionId: 'refund' })
    expect(disposition.summary.proposal).toMatchObject({
      actionTypes: ['reservations.refund.request', 'tickets.ticket.reply'],
      citations: [{ kind: 'kb', ref: 'payments.refunds.overpayment_refund@3', label: 'Overpayment refund (v3)' }],
      checks: [{ key: 'overpayment_confirmed', passed: true, step: 'S2' }],
    })
    const [effector] = byKind(flow.nodes, 'effector')
    expect(effector.status).toBe('succeeded')
    expect(effector.refs).toMatchObject({ proposalId: PROPOSAL_ID, commandId: 'reservations.refund.request' })
    const [fn] = byKind(flow.nodes, 'function')
    expect(fn).toMatchObject({ label: 'triage_agents.route', status: 'succeeded', parentId: 'step:si-1' })
  })

  it('reports the execution header', () => {
    expect(flow.execution).toMatchObject({
      id: EXECUTION_ID,
      workflowInstanceId: INSTANCE_ID,
      processKey: 'ticket_triage',
      subject: { type: 'tickets:ticket', id: 'T-1', label: 'T-1' },
      rerunOfExecutionId: null,
    })
  })
})

describe('assembleProcessFlow — manual route', () => {
  it('marks the routed outcome on the step and a waiting decision', () => {
    const flow = assembleProcessFlow(
      baseInput({
        execution: { ...baseInput().execution, status: 'waiting_on_you', completedAt: null },
        steps: [
          { id: 'si-1', stepId: 'advisor', stepName: null, stepType: 'AUTOMATED', status: 'COMPLETED', enteredAt: at(1), exitedAt: at(9), executionTimeMs: null },
          { id: 'si-3', stepId: 'manual_review', stepName: 'Manual review', stepType: 'USER_TASK', status: 'WAITING', enteredAt: at(10), exitedAt: null, executionTimeMs: null },
        ],
        events: [
          { id: 'ev-1', eventType: 'OUTCOME_ROUTED', eventData: { stepId: 'advisor', outcome: 'guardrailBlocked', toStepId: 'manual_review' }, occurredAt: at(9), stepInstanceId: null, userId: null },
        ],
        transitions: [],
        proposals: [{ ...baseInput().proposals[0], disposition: 'pending', dispositionBy: null, selectedOptionId: null, updatedAt: at(8) }],
      }),
    )
    const steps = byKind(flow.nodes, 'step')
    expect(steps[0].label).toBe('advisor')
    expect(steps[0].summary).toMatchObject({ routedOutcome: 'guardrailBlocked', routedTo: 'manual_review' })
    expect(steps[1]).toMatchObject({ label: 'Manual review', status: 'waiting', endedAt: null })
    const [disposition] = byKind(flow.nodes, 'disposition')
    expect(disposition).toMatchObject({ status: 'waiting', endedAt: null, durationMs: null })
    expect(byKind(flow.nodes, 'effector')).toHaveLength(0)
  })
})

describe('assembleProcessFlow — rejected', () => {
  it('renders a rejected decision with its reason and no effector', () => {
    const flow = assembleProcessFlow(
      baseInput({
        proposals: [
          { ...baseInput().proposals[0], disposition: 'rejected', selectedOptionId: null, dispositionReason: 'superseded_by_rerun' },
        ],
      }),
    )
    const [disposition] = byKind(flow.nodes, 'disposition')
    expect(disposition.status).toBe('failed')
    expect(disposition.summary).toMatchObject({ decision: 'rejected', reason: 'superseded_by_rerun' })
    expect(byKind(flow.nodes, 'effector')).toHaveLength(0)
  })

  it('reports the operator edit as a per-field diff', () => {
    const edited = JSON.parse(JSON.stringify(PAYLOAD))
    edited.options[0].actions[1].payload.body = 'Dear customer, we refund 300.'
    edited.options[0].actions[0].payload.amount = 300
    const flow = assembleProcessFlow(
      baseInput({
        proposals: [{ ...baseInput().proposals[0], disposition: 'edited', payload: edited }],
        corrections: [{ proposalId: PROPOSAL_ID, action: 'edit', proposedValue: PAYLOAD, correctedValue: edited }],
      }),
    )
    const [disposition] = byKind(flow.nodes, 'disposition')
    expect(disposition.summary.editedFields).toEqual([
      { action: 0, type: 'reservations.refund.request', field: 'amount', before: 350, after: 300 },
      { action: 1, type: 'tickets.ticket.reply', field: 'body', before: 'Dear customer, we refund 350.', after: 'Dear customer, we refund 300.' },
    ])
  })
})

describe('assembleProcessFlow — effector failure', () => {
  it('marks the effector failed with the command error, and a failed transition function', () => {
    const flow = assembleProcessFlow(
      baseInput({
        events: [
          { id: 'ev-f', eventType: 'ACTIVITY_FAILED', eventData: { transitionId: 't-classify', failedActivities: [{ activityName: 'policy', error: 'boom' }] }, occurredAt: at(20), stepInstanceId: null, userId: null },
          { id: 'ev-t', eventType: 'TRANSITION_EXECUTED', eventData: { transitionId: 't-classify' }, occurredAt: at(20), stepInstanceId: null, userId: null },
        ],
        spans: [
          {
            id: 'span-exec',
            agentRunId: RUN_ID,
            externalSpanId: `proposal-execution:${PROPOSAL_ID}`,
            name: 'agent_orchestrator.proposal.execute',
            kind: 'system',
            status: 'error',
            startedAt: at(22),
            endedAt: at(23),
            durationMs: null,
            attributes: {
              state: 'done',
              ok: false,
              results: [
                { type: 'reservations.refund.request', commandId: 'reservations.refund.request', status: 'error', error: 'refund window closed' },
                { type: 'tickets.ticket.reply', commandId: 'tickets.ticket.reply', status: 'skipped', error: 'stopped after failure' },
              ],
            },
          },
        ],
      }),
    )
    const [effector] = byKind(flow.nodes, 'effector')
    expect(effector.status).toBe('failed')
    expect(effector.durationMs).toBe(1000)
    expect(effector.summary).toMatchObject({
      ok: false,
      results: [
        { commandId: 'reservations.refund.request', status: 'error', error: 'refund window closed' },
        { commandId: 'tickets.ticket.reply', status: 'skipped' },
      ],
    })
    const functions = byKind(flow.nodes, 'function')
    expect(functions).toHaveLength(1)
    expect(functions[0]).toMatchObject({ status: 'failed', summary: expect.objectContaining({ error: 'boom' }) })
  })
})

describe('flow redaction', () => {
  const flow = assembleProcessFlow(baseInput())
  const serialized = JSON.stringify(flow)

  it('never carries a tool argument or result value, only keys and the size', () => {
    const [tool] = byKind(flow.nodes, 'tool_call')
    expect(tool.summary).toEqual({ toolName: 'reservations.get', argKeys: ['reservationId', '[redacted]'], resultBytes: expect.any(Number) })
    expect(tool.summary.resultBytes).toBeGreaterThan(0)
    expect(serialized).not.toContain('live-token-value')
    expect(serialized).not.toContain('R-9')
    expect(serialized).not.toContain('Jane Doe')
  })

  it('masks secret-shaped keys in output facts and trigger input keys', () => {
    const [run] = byKind(flow.nodes, 'agent_run')
    expect(run.summary.outputFacts).toMatchObject({ 'proposal.secret': '[redacted]', 'proposal.rationale': 'Paid more' })
    expect(serialized).not.toContain('shh')
    const [trigger] = byKind(flow.nodes, 'trigger')
    expect(trigger.summary.inputKeys).toEqual(['ticketId', '[redacted]'])
  })

  it('summarizes JSON-text arguments and caps output facts', () => {
    expect(summarizeToolArgs('{"a":1,"password":"x"}')).toEqual(['a', '[redacted]'])
    expect(summarizeToolArgs('not json')).toEqual([])
    const big = Object.fromEntries(Array.from({ length: 100 }, (_, index) => [`k${index}`, index]))
    expect(Object.keys(flattenOutputFacts(big))).toHaveLength(60)
  })
})

describe('rerun link and helpers', () => {
  it('reads the rerun link from triggered_by', () => {
    expect(readRerunOfExecutionId({ kind: 'manual', ref: 'u', rerunOfExecutionId: ORIGINAL_ID })).toBe(ORIGINAL_ID)
    expect(readRerunOfExecutionId(JSON.stringify({ kind: 'manual', rerunOfExecutionId: ORIGINAL_ID }))).toBe(ORIGINAL_ID)
    expect(readRerunOfExecutionId({ kind: 'event', ref: 'x' })).toBeNull()
    const flow = assembleProcessFlow(
      baseInput({ execution: { ...baseInput().execution, triggeredBy: { kind: 'manual', ref: 'u', rerunOfExecutionId: ORIGINAL_ID } } }),
    )
    expect(flow.execution.rerunOfExecutionId).toBe(ORIGINAL_ID)
    expect(byKind(flow.nodes, 'trigger')[0].summary.rerunOfExecutionId).toBe(ORIGINAL_ID)
  })

  it('diffs nothing when the payloads cannot be read', () => {
    expect(diffEditedFields(null, PAYLOAD, 'refund')).toEqual([])
  })

  it('reads transition activities off a workflow definition', () => {
    expect(
      readDefinitionTransitions({
        transitions: [
          { transitionId: 't1', fromStepId: 'a', toStepId: 'b', activities: [{ activityName: 'x', activityType: 'EXECUTE_FUNCTION', config: { functionName: 'm.fn' } }] },
          { transitionId: 't2', fromStepId: 'b' },
        ],
      }),
    ).toEqual([
      { transitionId: 't1', fromStepId: 'a', toStepId: 'b', activities: [{ activityName: 'x', activityType: 'EXECUTE_FUNCTION', functionName: 'm.fn' }] },
    ])
  })
})
