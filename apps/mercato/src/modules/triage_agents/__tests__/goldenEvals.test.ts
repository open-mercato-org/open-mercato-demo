/** @jest-environment node */
const findWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
  findOneWithDecryption: jest.fn(),
}))
jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))

import { jsonMatch, jsonPathCompare } from '@open-mercato/enterprise/modules/agent_orchestrator/lib/eval/registry/structured'
import { CLASSIFIER_AGENT_ID, CONTEXT_IDENTIFIER_AGENT_ID, RESOLUTION_ADVISOR_AGENT_ID } from '../data/constants'
import { TicketTriage } from '../data/entities'
import { GOLDEN_ASSERTIONS, GOLDEN_EXPECTATIONS, goldenExpected, seedTriageGoldenEvals } from '../lib/goldenEvals'
import { TRIAGE_SCENARIOS } from '../lib/scenarios'

const scope = { tenantId: '00000000-0000-4000-8000-0000000000aa', organizationId: '00000000-0000-4000-8000-0000000000bb' }

class FakeAssertion {}
class FakeCase {}
class FakeRun {}

type Row = Record<string, unknown>

function fakeEm(triages: Map<string, Row>, existing: { assertions: Row[]; cases: Row[] }) {
  const created: Array<{ entity: unknown; data: Row }> = []
  let sequence = 0
  const em = {
    fork: () => em,
    findOne: jest.fn(async (entity: unknown, where: Row) => {
      if (entity === TicketTriage) return triages.get(String(where.ticketId)) ?? null
      if (entity === FakeAssertion) return existing.assertions.find((row) => row.key === where.key && row.appliesTo === where.appliesTo) ?? null
      if (entity === FakeCase) return existing.cases.find((row) => row.inputKey === where.inputKey && row.agentDefinitionId === where.agentDefinitionId) ?? null
      return null
    }),
    create: jest.fn((entity: unknown, data: Row) => {
      sequence += 1
      const row = { id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`, ...data }
      created.push({ entity, data: row })
      if (entity === FakeAssertion) existing.assertions.push(row)
      if (entity === FakeCase) existing.cases.push(row)
      return row
    }),
    persist: jest.fn(),
    flush: jest.fn(async () => undefined),
  }
  return { em, created }
}

function runIdsFor(index: number) {
  return { identifier: `run-${index}-identifier`, classifier: `run-${index}-classifier`, advisor: `run-${index}-advisor` }
}

function setup() {
  const triages = new Map<string, Row>()
  TRIAGE_SCENARIOS.forEach((scenario, index) => {
    triages.set(`ticket-${scenario.key}`, { ticketId: `ticket-${scenario.key}`, runIds: runIdsFor(index) })
  })
  const existing = { assertions: [] as Row[], cases: [] as Row[] }
  const { em, created } = fakeEm(triages, existing)
  findWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown, where: Row) => [
    { id: where.id, agentId: where.agentId, input: { ticketId: String(where.id).split('-')[1] ?? 'x', runId: where.id } },
  ])
  const container = { resolve: <T,>(): T => em as unknown as T }
  const options = {
    loadAgentOrchestrator: async () => ({
      entities: { AgentEvalAssertion: FakeAssertion, AgentEvalCase: FakeCase, AgentRun: FakeRun } as never,
      canonicalInputKey: (input: unknown) => JSON.stringify(input),
    }),
    findTickets: async () => TRIAGE_SCENARIOS.map((scenario) => ({ scenario: scenario.key, ticketId: `ticket-${scenario.key}` })),
  }
  return { container, options, created, existing }
}

describe('triage golden eval cases', () => {
  beforeEach(() => findWithDecryption.mockReset())

  it('covers the six demo scenarios with the umbrella routes', () => {
    expect(GOLDEN_EXPECTATIONS.map((entry) => entry.scenario).sort()).toEqual(TRIAGE_SCENARIOS.map((scenario) => scenario.key).sort())
    for (const scenario of TRIAGE_SCENARIOS) {
      expect(GOLDEN_EXPECTATIONS.find((entry) => entry.scenario === scenario.key)?.route).toBe(scenario.expectedRoute)
    }
  })

  it('declares assertions whose configs the AO scorers accept', () => {
    for (const seed of GOLDEN_ASSERTIONS) {
      const scorer = seed.scorerKey === 'json_match' ? jsonMatch : jsonPathCompare
      expect(scorer.configSchema.safeParse(seed.config).success).toBe(true)
    }
  })

  it('scores a matching run as passed and a diverging run as failed', () => {
    const expectation = GOLDEN_EXPECTATIONS.find((entry) => entry.scenario === 'overpayment_refund')!
    const expected = goldenExpected(RESOLUTION_ADVISOR_AGENT_ID, expectation)
    const output = {
      kind: 'proposal',
      proposal: {
        options: [{ actions: [{ type: 'reservations.refund.request', payload: { amount: 350 } }, { type: 'tickets.reply.send', payload: {} }] }],
        evidence: { citations: [{ ref: 'payments.refunds.overpayment_refund@3' }] },
      },
    }
    const actionSeeds = GOLDEN_ASSERTIONS.filter((seed) => seed.agentId === RESOLUTION_ADVISOR_AGENT_ID && seed.scorerKey === 'json_match')
    for (const seed of actionSeeds) {
      const config = jsonMatch.configSchema.parse(seed.config)
      expect(jsonMatch.score({ output } as never, expected as never, config).passed).toBe(true)
    }
    const citation = GOLDEN_ASSERTIONS.find((seed) => seed.key === 'triage_golden_citation_key')!
    const citationConfig = jsonPathCompare.configSchema.parse({ ...citation.config, ...citation.caseOverride?.(expectation) })
    expect(jsonPathCompare.score({ output } as never, null, citationConfig).passed).toBe(true)

    const noProposal = goldenExpected(RESOLUTION_ADVISOR_AGENT_ID, GOLDEN_EXPECTATIONS.find((entry) => entry.scenario === 'payment_not_visible')!)
    const firstAction = jsonMatch.configSchema.parse(actionSeeds[0].config)
    expect(jsonMatch.score({ output } as never, noProposal as never, firstAction).passed).toBe(false)

    const identifier = GOLDEN_ASSERTIONS.find((seed) => seed.agentId === CONTEXT_IDENTIFIER_AGENT_ID)!
    const identifierExpected = goldenExpected(CONTEXT_IDENTIFIER_AGENT_ID, GOLDEN_EXPECTATIONS.find((entry) => entry.scenario === 'ambiguous_date_change')!)
    const identifierConfig = jsonMatch.configSchema.parse(identifier.config)
    expect(jsonMatch.score({ output: { kind: 'research', data: { reservation: { match: 'ambiguous' } } } } as never, identifierExpected as never, identifierConfig).passed).toBe(true)
    expect(jsonMatch.score({ output: { kind: 'research', data: { reservation: { match: 'single_reservation' } } } } as never, identifierExpected as never, identifierConfig).passed).toBe(false)
  })

  it('seeds approved golden cases from the recorded runs, idempotently', async () => {
    const { container, options, created } = setup()
    const first = await seedTriageGoldenEvals(container, scope, options)
    expect(first).toMatchObject({ available: true, assertionsCreated: GOLDEN_ASSERTIONS.length, casesCreated: 15, casesExisting: 0, missingScenarios: [] })
    const cases = created.filter((entry) => entry.entity === FakeCase).map((entry) => entry.data)
    expect(cases.filter((row) => row.agentDefinitionId === CONTEXT_IDENTIFIER_AGENT_ID)).toHaveLength(6)
    expect(cases.filter((row) => row.agentDefinitionId === CLASSIFIER_AGENT_ID)).toHaveLength(6)
    expect(cases.filter((row) => row.agentDefinitionId === RESOLUTION_ADVISOR_AGENT_ID)).toHaveLength(3)
    for (const row of cases) {
      expect(row).toMatchObject({ status: 'approved', sourceType: 'golden_run', tenantId: scope.tenantId, organizationId: scope.organizationId })
      expect(row.inputKey).toBe(JSON.stringify(row.input))
    }
    const advisorCase = cases.find((row) => row.agentDefinitionId === RESOLUTION_ADVISOR_AGENT_ID && String(row.name).includes('overpayment_refund'))
    expect(advisorCase?.assertions).toEqual([{ assertionId: expect.any(String), configOverride: { value: 'payments.refunds.overpayment_refund@' } }])

    const second = await seedTriageGoldenEvals(container, scope, options)
    expect(second).toMatchObject({ assertionsCreated: 0, casesCreated: 0, casesExisting: 15 })
  })

  it('reports scenarios without a recorded triage and skips when AO is absent', async () => {
    const { container, options } = setup()
    const partial = await seedTriageGoldenEvals(container, scope, {
      ...options,
      findTickets: async () => [{ scenario: 'overpayment_refund', ticketId: 'ticket-overpayment_refund' }],
    })
    expect(partial.casesCreated).toBe(3)
    expect(partial.missingScenarios).toHaveLength(5)

    const absent = await seedTriageGoldenEvals(container, scope, { loadAgentOrchestrator: async () => null })
    expect(absent).toEqual({ available: false, assertionsCreated: 0, casesCreated: 0, casesExisting: 0, missingScenarios: [] })
  })
})
