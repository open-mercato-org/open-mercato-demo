import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/postgresql'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { SortDir, type QueryEngine } from '@open-mercato/shared/lib/query/types'
import { reportError } from '@open-mercato/telemetry'
import {
  CLASSIFIER_AGENT_ID,
  CONTEXT_IDENTIFIER_AGENT_ID,
  RESOLUTION_ADVISOR_AGENT_ID,
  TICKET_ENTITY_TYPE,
} from '../data/constants'
import { TicketTriage, type TriageRunIds } from '../data/entities'
import type { ScenarioKey } from '../data/validators'
import type { TriageScope } from './kbArticles'
import { TRIAGE_SCENARIOS } from './scenarios'

const logger = createLogger('triage_agents').child({ component: 'goldenEvals' })

type ResolverLike = { resolve: <T = unknown>(name: string) => T }

type Loose = Record<string, unknown>

type ReservationMatch = 'explicit_number_verified' | 'single_reservation' | 'inferred_from_content' | 'ambiguous'

export type GoldenScenarioExpectation = {
  scenario: ScenarioKey
  route: 'assisted' | 'manual'
  reservationMatch: ReservationMatch
  topicKey: string
  automationLevel: 'assisted' | 'manual_only'
  actionTypes: string[] | null
}

/**
 * The golden expectations per demo scenario (umbrella personas). `actionTypes` is
 * null where the route never reaches the resolution advisor; `[]` means the advisor
 * runs but must not propose anything (a failed required check).
 */
export const GOLDEN_EXPECTATIONS: ReadonlyArray<GoldenScenarioExpectation> = [
  {
    scenario: 'overpayment_refund',
    route: 'assisted',
    reservationMatch: 'explicit_number_verified',
    topicKey: 'payments.refunds.overpayment_refund',
    automationLevel: 'assisted',
    actionTypes: ['reservations.refund.request', 'tickets.reply.send'],
  },
  {
    scenario: 'payment_confirmed',
    route: 'assisted',
    reservationMatch: 'single_reservation',
    topicKey: 'payments.incoming.payment_confirmation',
    automationLevel: 'assisted',
    actionTypes: ['tickets.ticket.transition', 'tickets.reply.send'],
  },
  {
    scenario: 'payment_not_visible',
    route: 'assisted',
    reservationMatch: 'single_reservation',
    topicKey: 'payments.incoming.payment_confirmation',
    automationLevel: 'assisted',
    actionTypes: [],
  },
  {
    scenario: 'room_preference',
    route: 'manual',
    reservationMatch: 'inferred_from_content',
    topicKey: 'booking.special_requests.room_preference',
    automationLevel: 'manual_only',
    actionTypes: null,
  },
  {
    scenario: 'hotel_complaint',
    route: 'manual',
    reservationMatch: 'single_reservation',
    topicKey: 'complaints.service.hotel_service_complaint',
    automationLevel: 'manual_only',
    actionTypes: null,
  },
  {
    scenario: 'ambiguous_date_change',
    route: 'manual',
    reservationMatch: 'ambiguous',
    topicKey: 'booking.changes.date_change',
    automationLevel: 'manual_only',
    actionTypes: null,
  },
]

export const MAX_GOLDEN_ACTIONS = 3

export type GoldenAssertionSeed = {
  agentId: string
  key: string
  scorerKey: 'json_match' | 'json_path_compare'
  title: string
  description: string
  config: Loose
  caseOverride?: (expectation: GoldenScenarioExpectation) => Loose | null
}

const exactMatch = (path: string): Loose => ({ source: 'expected', path, mode: 'exact', ignore: [] })

/**
 * Agent-scoped deterministic gate assertions. The `json_match` ones compare a path
 * of the run output with the same path of the golden case's `expected`, so they are
 * skipped (no expected) for live runs that match no golden case. The citation check
 * is a generic "cites an article" rule; each golden case narrows it to its topic key.
 */
export const GOLDEN_ASSERTIONS: ReadonlyArray<GoldenAssertionSeed> = [
  {
    agentId: CONTEXT_IDENTIFIER_AGENT_ID,
    key: 'triage_golden_reservation_match',
    scorerKey: 'json_match',
    title: 'Reservation match level',
    description: 'The identified reservation match level equals the golden case.',
    config: exactMatch('data.reservation.match'),
  },
  {
    agentId: CLASSIFIER_AGENT_ID,
    key: 'triage_golden_topic_key',
    scorerKey: 'json_match',
    title: 'Knowledge base topic',
    description: 'The classified topic key equals the golden case.',
    config: exactMatch('data.topicKey'),
  },
  {
    agentId: CLASSIFIER_AGENT_ID,
    key: 'triage_golden_route',
    scorerKey: 'json_match',
    title: 'Route (automation level)',
    description: "The topic's automation level, which decides assisted vs manual routing, equals the golden case.",
    config: exactMatch('data.automationLevel'),
  },
  ...Array.from({ length: MAX_GOLDEN_ACTIONS }, (_, index): GoldenAssertionSeed => ({
    agentId: RESOLUTION_ADVISOR_AGENT_ID,
    key: `triage_golden_action_${index + 1}`,
    scorerKey: 'json_match',
    title: `Proposed action ${index + 1}`,
    description: `The type of proposed action ${index + 1} equals the golden case (absent when the case expects fewer actions).`,
    config: exactMatch(`proposal.options[0].actions[${index}].type`),
  })),
  {
    agentId: RESOLUTION_ADVISOR_AGENT_ID,
    key: 'triage_golden_citation_key',
    scorerKey: 'json_path_compare',
    title: 'Cites the knowledge base article',
    description: 'The first cited source is a knowledge base article (golden cases: the topic article key).',
    config: { path: 'proposal.evidence.citations[0].ref', operator: 'contains', value: '@' },
    caseOverride: (expectation) => ({ value: `${expectation.topicKey}@` }),
  },
]

export function goldenExpected(agentId: string, expectation: GoldenScenarioExpectation): Loose | null {
  if (agentId === CONTEXT_IDENTIFIER_AGENT_ID) {
    return { kind: 'research', data: { reservation: { match: expectation.reservationMatch } } }
  }
  if (agentId === CLASSIFIER_AGENT_ID) {
    return { kind: 'research', data: { topicKey: expectation.topicKey, automationLevel: expectation.automationLevel } }
  }
  if (agentId === RESOLUTION_ADVISOR_AGENT_ID && expectation.actionTypes) {
    return {
      kind: 'proposal',
      proposal: {
        options: expectation.actionTypes.length > 0 ? [{ actions: expectation.actionTypes.map((type) => ({ type })) }] : [],
        evidence: { citations: [{ ref: expectation.topicKey }] },
      },
    }
  }
  return null
}

function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

type ScenarioTicket = { ticketId: string; scenario: ScenarioKey }

/**
 * The newest ticket of each demo persona, found through the query engine by the
 * requester email hash (the tickets module is addressed by entity id only).
 */
export async function findLatestScenarioTickets(container: ResolverLike, scope: TriageScope): Promise<ScenarioTicket[]> {
  const queryEngine = container.resolve<QueryEngine>('queryEngine')
  const scenarioByHash = new Map<string, ScenarioKey>()
  for (const scenario of TRIAGE_SCENARIOS) {
    for (const hash of lookupHashCandidates(scenario.fromEmail)) scenarioByHash.set(hash, scenario.key)
  }
  const result = await queryEngine.query<Loose>(TICKET_ENTITY_TYPE, {
    tenantId: scope.tenantId,
    organizationId: scope.organizationId,
    fields: ['id', 'requester_email_hash', 'created_at'],
    filters: { requester_email_hash: { $in: [...scenarioByHash.keys()] } },
    sort: [{ field: 'created_at', dir: SortDir.Desc }],
    page: { page: 1, pageSize: 100 },
  })
  const latest = new Map<ScenarioKey, string>()
  for (const row of (result.items ?? []).filter(isRecord)) {
    const id = readString(row.id)
    const hash = readString(row.requester_email_hash) ?? readString(row.requesterEmailHash)
    const scenario = hash ? scenarioByHash.get(hash) : undefined
    if (id && scenario && !latest.has(scenario)) latest.set(scenario, id)
  }
  return [...latest.entries()].map(([scenario, ticketId]) => ({ scenario, ticketId }))
}

export type SeedGoldenEvalsResult = {
  available: boolean
  assertionsCreated: number
  casesCreated: number
  casesExisting: number
  missingScenarios: ScenarioKey[]
}

type AgentOrchestratorEvalModule = {
  entities: typeof import('@open-mercato/enterprise/modules/agent_orchestrator/data/entities')
  canonicalInputKey: (input: unknown) => string
}

async function loadAgentOrchestrator(): Promise<AgentOrchestratorEvalModule | null> {
  try {
    const entities = await import('@open-mercato/enterprise/modules/agent_orchestrator/data/entities')
    const { canonicalInputKey } = await import('@open-mercato/enterprise/modules/agent_orchestrator/lib/eval/canonicalInputKey')
    return { entities, canonicalInputKey }
  } catch (err) {
    logger.warn('Agent orchestrator unavailable; skipping the golden eval seed', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

const RUN_KEY_BY_AGENT: Record<string, keyof TriageRunIds> = {
  [CONTEXT_IDENTIFIER_AGENT_ID]: 'identifier',
  [CLASSIFIER_AGENT_ID]: 'classifier',
  [RESOLUTION_ADVISOR_AGENT_ID]: 'advisor',
}

/**
 * Seeds the triage golden eval set (AO programmatic pattern): agent-scoped gate
 * assertions (idempotent by org + agent + key) and one APPROVED golden case per
 * scenario and agent that runs for it (idempotent by agent + canonical input key).
 * The case input is the recorded input of that agent's run for the newest triaged
 * ticket of the scenario persona, so live runs and replays match the golden case.
 * Soft-optional: does nothing when the agent orchestrator is unavailable.
 */
export async function seedTriageGoldenEvals(
  container: ResolverLike,
  scope: TriageScope,
  options: { loadAgentOrchestrator?: () => Promise<AgentOrchestratorEvalModule | null>; findTickets?: typeof findLatestScenarioTickets } = {},
): Promise<SeedGoldenEvalsResult> {
  const ao = await (options.loadAgentOrchestrator ?? loadAgentOrchestrator)()
  if (!ao) return { available: false, assertionsCreated: 0, casesCreated: 0, casesExisting: 0, missingScenarios: [] }
  const { AgentEvalAssertion, AgentEvalCase, AgentRun } = ao.entities
  const em = container.resolve<EntityManager>('em').fork()

  const assertionIds = new Map<string, string>()
  let assertionsCreated = 0
  for (const seed of GOLDEN_ASSERTIONS) {
    const existing = await em.findOne(AgentEvalAssertion, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      appliesTo: seed.agentId,
      key: seed.key,
    })
    if (existing) {
      assertionIds.set(seed.key, existing.id)
      continue
    }
    const created = em.create(AgentEvalAssertion, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      key: seed.key,
      scorerKey: seed.scorerKey,
      title: seed.title,
      description: seed.description,
      appliesTo: seed.agentId,
      type: 'deterministic',
      severity: 'gate',
      config: seed.config,
      enabled: true,
      deletedAt: null,
    })
    em.persist(created)
    await em.flush()
    assertionIds.set(seed.key, created.id)
    assertionsCreated += 1
  }

  let tickets: ScenarioTicket[] = []
  try {
    tickets = await (options.findTickets ?? findLatestScenarioTickets)(container, scope)
  } catch (err) {
    logger.warn('Demo ticket lookup failed', { error: err instanceof Error ? err.message : String(err) })
    reportError(err, { module: 'triage_agents', code: 'triage_agents.golden_ticket_lookup_failed' })
  }
  const ticketByScenario = new Map(tickets.map((entry) => [entry.scenario, entry.ticketId]))

  let casesCreated = 0
  let casesExisting = 0
  const missingScenarios: ScenarioKey[] = []
  for (const expectation of GOLDEN_EXPECTATIONS) {
    const ticketId = ticketByScenario.get(expectation.scenario)
    const triage = ticketId
      ? await em.findOne(TicketTriage, { ticketId, tenantId: scope.tenantId, organizationId: scope.organizationId })
      : null
    const agentIds = [CONTEXT_IDENTIFIER_AGENT_ID, CLASSIFIER_AGENT_ID, ...(expectation.actionTypes ? [RESOLUTION_ADVISOR_AGENT_ID] : [])]
    let complete = Boolean(triage)
    for (const agentId of agentIds) {
      const runId = triage?.runIds?.[RUN_KEY_BY_AGENT[agentId]] ?? null
      const runs = runId
        ? await findWithDecryption(em, AgentRun, { id: runId, agentId, tenantId: scope.tenantId, organizationId: scope.organizationId }, { limit: 1 }, scope)
        : []
      const run = runs[0]
      const expected = goldenExpected(agentId, expectation)
      if (!run || run.input === null || run.input === undefined || !expected) {
        complete = false
        continue
      }
      const inputKey = ao.canonicalInputKey(run.input)
      const existingCase = await em.findOne(AgentEvalCase, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        agentDefinitionId: agentId,
        inputKey,
      })
      if (existingCase) {
        casesExisting += 1
        continue
      }
      const refs = GOLDEN_ASSERTIONS.filter((seed) => seed.agentId === agentId && seed.caseOverride).flatMap((seed) => {
        const assertionId = assertionIds.get(seed.key)
        const configOverride = seed.caseOverride?.(expectation) ?? null
        return assertionId && configOverride ? [{ assertionId, configOverride }] : []
      })
      em.persist(
        em.create(AgentEvalCase, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          sourceType: 'golden_run',
          sourceId: run.id ?? randomUUID(),
          agentDefinitionId: agentId,
          name: `Triage golden: ${expectation.scenario} (${expectation.route})`,
          processType: null,
          input: run.input,
          inputKey,
          expected,
          assertions: refs.length > 0 ? refs : null,
          status: 'approved',
          approvedByUserId: null,
          deletedAt: null,
        }),
      )
      casesCreated += 1
    }
    if (!complete) missingScenarios.push(expectation.scenario)
  }
  if (casesCreated > 0) await em.flush()
  return { available: true, assertionsCreated, casesCreated, casesExisting, missingScenarios }
}
