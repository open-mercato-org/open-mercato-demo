/** @jest-environment node */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { workflowDefinitionDataSchema } from '@open-mercato/core/modules/workflows/data/validators'
import { definitionToGraph, validateWorkflowGraph } from '@open-mercato/core/modules/workflows/lib/graph-utils'
import { evaluateWorkflowDefinition } from '@open-mercato/core/modules/workflows/lib/definition-evaluation'
import { invokeAgentConfigSchema } from '@open-mercato/core/modules/workflows/data/activity-config-schemas'
import { processTriggersSchema } from '@open-mercato/enterprise/modules/agent_orchestrator/data/validators'
import { TRIAGE_PROCESS_TRIGGERS, buildTriageProcessTriggers } from '../lib/processSeed'
import { resolveTriageAutoStart } from '../lib/autoStart'
import { COMPUTE_PRIORITY_FUNCTION, RECORD_STAGE_FUNCTION, ROUTE_FUNCTION, WORKFLOW_COMMAND_IDS } from '../data/constants'

jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))

type Activity = { activityId: string; activityName?: string; activityType: string; config: Record<string, unknown> }
type Step = { stepId: string; stepType: string; activities?: Activity[] }
type Transition = { transitionId: string; fromStepId: string; toStepId: string; kind?: string; outcomeKind?: string; activities?: Activity[] }

const document = JSON.parse(
  readFileSync(path.join(__dirname, '..', 'examples', 'ticket-triage-workflow.json'), 'utf8'),
) as { workflowId: string; definition: { steps: Step[]; transitions: Transition[] } }
const { steps, transitions } = document.definition
const activities = [...steps.flatMap((step) => step.activities ?? []), ...transitions.flatMap((transition) => transition.activities ?? [])]

describe('ticket triage workflow definition', () => {
  it('passes the workflow definition schema and the Studio evaluation', () => {
    const parsed = workflowDefinitionDataSchema.safeParse(document.definition)
    expect(parsed.error?.issues ?? []).toEqual([])
    const evaluation = evaluateWorkflowDefinition(document.definition as never)
    expect(evaluation.problems.filter((problem) => problem.severity === 'error')).toEqual([])
    expect(evaluation.valid).toBe(true)
    const { nodes, edges } = definitionToGraph(document.definition as never, { autoLayout: false })
    expect(validateWorkflowGraph(nodes, edges).filter((issue) => issue.type === 'error')).toEqual([])
  })

  it('wires every agent step for researcher, error and guardrail outcomes', () => {
    for (const stepId of ['identify', 'classify', 'resolve']) {
      const kinds = transitions.filter((transition) => transition.fromStepId === stepId && transition.kind === 'outcome').map((transition) => transition.outcomeKind)
      expect(kinds).toEqual(expect.arrayContaining(['researcher', 'error', 'guardrailBlocked']))
    }
    const resolveKinds = transitions.filter((transition) => transition.fromStepId === 'resolve').map((transition) => transition.outcomeKind)
    expect(resolveKinds).toEqual(expect.arrayContaining(['approved', 'rejected']))
  })

  it('asks a human for every advisor proposal and stamps the ticket subject', () => {
    const advisor = activities.find((activity) => activity.config.agentId === 'triage_agents.resolution_advisor')
    const config = invokeAgentConfigSchema.parse(advisor?.config)
    expect(config.onResult).toEqual({ alwaysAsk: true })
    expect(config.subject).toMatchObject({ subjectType: 'tickets:ticket', subjectId: '{{context.ticketId}}' })
  })

  it('only uses the triage functions, the AO effector and the enabled workflow-safe commands', () => {
    const functions = new Set(activities.filter((activity) => activity.activityType === 'EXECUTE_FUNCTION').map((activity) => activity.config.functionName))
    expect([...functions].sort()).toEqual(
      [COMPUTE_PRIORITY_FUNCTION, ROUTE_FUNCTION, RECORD_STAGE_FUNCTION, 'agent_orchestrator.execute_approved_proposal'].sort(),
    )
    const commands = activities.filter((activity) => activity.activityType === 'UPDATE_ENTITY').map((activity) => String(activity.config.commandId))
    for (const commandId of commands) expect(WORKFLOW_COMMAND_IDS).toContain(commandId)
  })

  it('keeps activity names free of dots so conditions can address their output', () => {
    for (const activity of activities) {
      if (activity.activityType === 'EXECUTE_FUNCTION' || activity.activityType === 'UPDATE_ENTITY') {
        expect(activity.activityName ?? '').not.toContain('.')
      }
    }
  })

  it('records the advising stage when the resolution advisor starts', () => {
    const assisted = transitions.find((transition) => transition.fromStepId === 'classified' && transition.toStepId === 'resolve')
    const stage = assisted?.activities?.find((activity) => activity.config.functionName === RECORD_STAGE_FUNCTION)
    expect(stage?.config.args).toMatchObject({ stage: 'advising' })
  })

  it('keeps a manual classification instead of applying the AI one', () => {
    const fromPolicy = transitions.filter((transition) => transition.fromStepId === 'policy' && transition.kind !== 'error') as Array<
      Transition & { priority: number; condition?: { field?: string; value?: unknown } }
    >
    const keep = fromPolicy.find((transition) => transition.condition?.field === 'triage_route.result.humanClassified')
    const apply = fromPolicy.find((transition) => transition.activities?.some((activity) => activity.config.commandId === 'tickets.ticket.classify'))
    expect(keep?.condition?.value).toBe(true)
    expect(keep?.toStepId).toBe('classified')
    expect(keep?.activities?.some((activity) => activity.activityType === 'UPDATE_ENTITY')).toBe(false)
    expect(keep && apply && keep.priority > apply.priority).toBe(true)
    const route = activities.find((activity) => activity.config.functionName === ROUTE_FUNCTION)
    expect(route?.config.args).toMatchObject({ ticketId: '{{context.ticketId}}' })
    const advisor = activities.find((activity) => activity.config.agentId === 'triage_agents.resolution_advisor')
    expect(advisor?.config.input).toMatchObject({
      identification: '{{context.triage_route.result.identification}}',
      classification: '{{context.triage_route.result.classification}}',
    })
  })

  it('records a rejection first and flags the ticket only when the proposal was not superseded by a re-run', () => {
    const record = transitions.find((transition) => transition.fromStepId === 'rejected')
    expect(record?.toStepId).toBe('rejected_recorded')
    expect(record?.activities?.map((activity) => activity.activityName)).toEqual(['stage_rejected'])
    const fromRecorded = transitions.filter((transition) => transition.fromStepId === 'rejected_recorded') as Array<
      Transition & { priority: number; condition?: { field?: string; operator?: string; value?: unknown } }
    >
    const superseded = fromRecorded.find((transition) => transition.condition?.field === 'stage_rejected.result.superseded')
    const flag = fromRecorded.find((transition) => transition.activities?.some((activity) => activity.config.commandId === 'tickets.ticket.flag_manual_review'))
    expect(superseded).toMatchObject({ toStepId: 'end', condition: { operator: '=', value: true } })
    expect(superseded?.activities ?? []).toEqual([])
    expect(flag?.condition).toBeUndefined()
    expect(superseded!.priority).toBeGreaterThan(flag!.priority)
  })

  it('declares valid process triggers mapping the ticket id from the event payload', () => {
    const parsed = processTriggersSchema.parse(TRIAGE_PROCESS_TRIGGERS)
    const event = parsed.find((trigger) => trigger.kind === 'event')
    expect(event).toMatchObject({ eventPattern: 'tickets.ticket.created' })
    expect(parsed.some((trigger) => trigger.kind === 'manual')).toBe(true)
  })

  it('enables the ticket-created trigger only when triage auto-starts', () => {
    const eventOf = (autoStart: boolean) => processTriggersSchema.parse(buildTriageProcessTriggers(autoStart)).find((trigger) => trigger.kind === 'event')
    expect(eventOf(true)).toMatchObject({ enabled: true })
    expect(eventOf(false)).toMatchObject({ enabled: false })
    expect(buildTriageProcessTriggers(false).some((trigger) => trigger.kind === 'manual')).toBe(true)
  })

  it('auto-starts by default, not in integration runs, and honours OM_TRIAGE_AUTO_START', () => {
    expect(resolveTriageAutoStart({})).toBe(true)
    expect(resolveTriageAutoStart({ OM_INTEGRATION_TEST: 'true' })).toBe(false)
    expect(resolveTriageAutoStart({ OM_INTEGRATION_TEST: 'true', OM_TRIAGE_AUTO_START: '1' })).toBe(true)
    expect(resolveTriageAutoStart({ OM_TRIAGE_AUTO_START: 'false' })).toBe(false)
  })
})
