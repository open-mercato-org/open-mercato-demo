import type { EntityManager } from '@mikro-orm/postgresql'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import { TicketTriage, type TriageAttemptRecord, type TriageRunIds } from '../data/entities'
import type { TriageAiMode, TriageDraftState, TriageStage } from '../data/constants'
import type { RecordStageArgs } from '../data/validators'
import type { TriageScope } from './kbArticles'

const logger = createLogger('triage_agents').child({ component: 'projection' })

const MAX_ATTEMPT_HISTORY = 20

type Loose = Record<string, unknown>

export function isRecord(value: unknown): value is Loose {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function parseMaybeJsonRecord(value: unknown): Loose | null {
  if (isRecord(value)) return value
  if (typeof value === 'string' && value.trim().startsWith('{')) {
    try {
      const parsed: unknown = JSON.parse(value)
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

export type ProjectedUncertainty = { code: string; message: string; blocking: boolean; source: string }

function collectUncertainty(source: string, value: unknown): ProjectedUncertainty[] {
  return readArray(value)
    .filter(isRecord)
    .map((entry) => ({
      code: readString(entry.code) ?? 'unspecified',
      message: readString(entry.message) ?? '',
      blocking: entry.blocking === true,
      source,
    }))
    .filter((entry) => entry.message.length > 0)
}

export function projectIdentification(identification: Loose | null | undefined): Loose | null {
  if (!identification) return null
  const customer = isRecord(identification.customer) ? identification.customer : {}
  const reservation = isRecord(identification.reservation) ? identification.reservation : {}
  return {
    customer: { personId: readString(customer.personId), match: readString(customer.match) ?? 'not_found' },
    reservation: {
      reservationId: readString(reservation.reservationId),
      bookingNumber: readString(reservation.bookingNumber),
      match: readString(reservation.match) ?? 'not_found',
      departureDate: readString(reservation.departureDate),
      daysToDeparture: readNumber(reservation.daysToDeparture),
      candidates: readArray(reservation.candidates)
        .filter(isRecord)
        .map((candidate) => ({
          reservationId: readString(candidate.reservationId),
          bookingNumber: readString(candidate.bookingNumber),
          label: readString(candidate.label),
          daysToDeparture: readNumber(candidate.daysToDeparture),
        })),
    },
    confidence: readNumber(identification.confidence),
  }
}

export function projectClassification(classification: Loose | null | undefined, route: Loose | null | undefined): Loose | null {
  if (!classification) return null
  const article = route && isRecord(route.article) ? route.article : null
  return {
    categoryKey: readString(classification.categoryKey),
    subcategoryKey: readString(classification.subcategoryKey),
    topicKey: readString(classification.topicKey),
    topicVersion: readNumber(article?.version) ?? readNumber(classification.topicVersion),
    categoryPath: readString(article?.categoryPath),
    intent: readString(classification.intent),
    automationLevel: readString(article?.automationLevel) ?? readString(classification.automationLevel),
    urgencySignal: readString(classification.urgencySignal),
    confidence: readNumber(classification.confidence),
  }
}

export type AdviceOutcome = {
  proposed: boolean
  recommendedActionLabel: string | null
  reasonCode: string | null
  reason: string | null
  uncertainty: ProjectedUncertainty[]
}

const KNOWN_NO_PROPOSAL_CODES = new Set(['payment_not_visible', 'kb_article_missing', 'owner_not_verified', 'overpayment_not_confirmed', 'iban_missing'])

export function readAdviceOutcome(advice: unknown): AdviceOutcome {
  const payload = parseMaybeJsonRecord(advice)
  const proposal = payload && isRecord(payload.proposal) ? payload.proposal : payload
  const options = readArray(proposal?.options).filter(isRecord)
  const evidence = proposal && isRecord(proposal.evidence) ? proposal.evidence : null
  const uncertainty = collectUncertainty('advisor', evidence?.uncertainty)
  if (options.length > 0) {
    return { proposed: true, recommendedActionLabel: readString(options[0].label), reasonCode: null, reason: null, uncertainty }
  }
  const blocking = uncertainty.find((entry) => entry.blocking) ?? uncertainty[0] ?? null
  const failedCheck = readArray(evidence?.checks)
    .filter(isRecord)
    .find((check) => check.passed === false)
  const code = blocking?.code ?? null
  return {
    proposed: false,
    recommendedActionLabel: null,
    reasonCode: code && KNOWN_NO_PROPOSAL_CODES.has(code) ? code : code ? code.slice(0, 100) : 'no_proposal',
    reason:
      blocking?.message ??
      (failedCheck ? readString(failedCheck.evidence) : null) ??
      readString(proposal?.rationale) ??
      'The resolution advisor did not propose an action.',
    uncertainty,
  }
}

export function mergeUncertainty(...lists: ProjectedUncertainty[][]): ProjectedUncertainty[] {
  const seen = new Set<string>()
  const merged: ProjectedUncertainty[] = []
  for (const list of lists) {
    for (const entry of list) {
      const key = `${entry.code}:${entry.message}`
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(entry)
    }
  }
  return merged.slice(0, 30)
}

async function resolveProcessExecutionId(em: EntityManager, scope: TriageScope, workflowInstanceId: string | null): Promise<string | null> {
  if (!workflowInstanceId) return null
  try {
    const rows = (await em.getConnection().execute(
      'SELECT id FROM process_instances WHERE workflow_instance_id = ? AND tenant_id = ? AND organization_id = ? AND deleted_at IS NULL LIMIT 1',
      [workflowInstanceId, scope.tenantId, scope.organizationId],
    )) as Array<{ id?: unknown }>
    const id = Array.isArray(rows) ? rows[0]?.id : null
    return typeof id === 'string' ? id : null
  } catch (err) {
    logger.warn('Process execution lookup unavailable', { error: err instanceof Error ? err.message : String(err) })
    reportError(err, { module: 'triage_agents', code: 'triage_agents.execution_lookup_failed' })
    return null
  }
}

export async function findTriage(em: EntityManager, scope: TriageScope, ticketId: string): Promise<TicketTriage | null> {
  return em.findOne(TicketTriage, { ticketId, tenantId: scope.tenantId, organizationId: scope.organizationId })
}

export async function findTriageByWorkflowInstance(
  em: EntityManager,
  scope: TriageScope,
  workflowInstanceId: string,
): Promise<TicketTriage | null> {
  return em.findOne(TicketTriage, { workflowInstanceId, tenantId: scope.tenantId, organizationId: scope.organizationId })
}

function attemptRecord(row: TicketTriage): TriageAttemptRecord {
  return {
    attempt: row.attempt,
    workflowInstanceId: row.workflowInstanceId ?? null,
    processExecutionId: row.processExecutionId ?? null,
    stage: row.stage,
    aiMode: row.aiMode ?? null,
    reasonCode: row.reasonCode ?? null,
    disposition: row.disposition ?? null,
    recordedAt: row.updatedAt.toISOString(),
  }
}

function resetForNewAttempt(row: TicketTriage, workflowInstanceId: string | null): void {
  const history = [...(row.attempts ?? []), attemptRecord(row)].slice(-MAX_ATTEMPT_HISTORY)
  row.attempts = history
  row.attempt = row.attempt + 1
  row.workflowInstanceId = workflowInstanceId
  row.processExecutionId = null
  row.aiMode = null
  row.reasonCode = null
  row.reason = null
  row.route = null
  row.priority = null
  row.priorityReason = null
  row.identification = null
  row.classification = null
  row.uncertainty = null
  row.confidence = null
  row.recommendedActionLabel = null
  row.proposalId = null
  row.disposition = null
  row.draftState = 'none'
  row.groundingState = 'not_checked'
  row.groundingIssues = null
  row.runIds = null
}

export type RecordStageResult = {
  ticketId: string
  stage: TriageStage
  aiMode: TriageAiMode | null
  reasonCode: string | null
  reason: string | null
  attempt: number
}

/**
 * Upserts the ticket's current triage projection. Every value is derived from what
 * the workflow already holds; nothing here decides the route.
 */
export async function recordTriageStage(
  em: EntityManager,
  scope: TriageScope,
  args: RecordStageArgs,
  workflowInstanceId: string | null,
): Promise<RecordStageResult> {
  let row = await findTriage(em, scope, args.ticketId)
  if (!row) {
    row = em.create(TicketTriage, {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      ticketId: args.ticketId,
      ticketNumber: args.ticketNumber ?? null,
      workflowInstanceId,
      stage: args.stage,
    })
    em.persist(row)
  } else if (workflowInstanceId && row.workflowInstanceId && row.workflowInstanceId !== workflowInstanceId) {
    resetForNewAttempt(row, workflowInstanceId)
  } else if (workflowInstanceId && !row.workflowInstanceId) {
    row.workflowInstanceId = workflowInstanceId
  }
  if (args.ticketNumber) row.ticketNumber = args.ticketNumber
  if (!row.processExecutionId) row.processExecutionId = await resolveProcessExecutionId(em, scope, workflowInstanceId)
  row.stage = args.stage
  if (args.aiMode !== undefined) row.aiMode = args.aiMode
  if (args.reasonCode !== undefined) row.reasonCode = args.reasonCode
  if (args.reason !== undefined) row.reason = args.reason
  if (args.identification) row.identification = projectIdentification(args.identification)
  if (args.classification) row.classification = projectClassification(args.classification, args.route ?? null)
  if (args.priority) {
    row.priority = readString(args.priority.priority)
    row.priorityReason = readString(args.priority.priorityReason)
  }
  if (args.route) {
    row.route = readString(args.route.route)
    if (args.route.route === 'manual' && args.reasonCode === undefined) {
      row.reasonCode = readString(args.route.reasonCode)
      row.reason = readString(args.route.reason)
    }
  }
  if (args.advice) {
    const outcome = readAdviceOutcome(args.advice)
    if (outcome.recommendedActionLabel) row.recommendedActionLabel = outcome.recommendedActionLabel
    if (!outcome.proposed && args.reasonCode === undefined) {
      row.reasonCode = outcome.reasonCode
      row.reason = outcome.reason
    }
  }
  if (args.disposition !== undefined) row.disposition = args.disposition
  if (args.draftState !== undefined && args.draftState !== null) row.draftState = args.draftState
  if (args.proposalId !== undefined) row.proposalId = args.proposalId
  const identificationUncertainty = collectUncertainty('identifier', args.identification?.uncertainty)
  const classificationUncertainty = collectUncertainty('classifier', args.classification?.uncertainty)
  const adviceUncertainty = args.advice ? readAdviceOutcome(args.advice).uncertainty : []
  if (identificationUncertainty.length || classificationUncertainty.length || adviceUncertainty.length) {
    const existing = (row.uncertainty ?? []).filter(isRecord).map((entry) => ({
      code: readString(entry.code) ?? 'unspecified',
      message: readString(entry.message) ?? '',
      blocking: entry.blocking === true,
      source: readString(entry.source) ?? 'unknown',
    }))
    row.uncertainty = mergeUncertainty(existing, identificationUncertainty, classificationUncertainty, adviceUncertainty)
  }
  const confidence = readNumber(args.classification?.confidence) ?? readNumber(args.identification?.confidence)
  if (confidence !== null) row.confidence = confidence.toFixed(4)
  await em.flush()
  return {
    ticketId: row.ticketId,
    stage: row.stage,
    aiMode: row.aiMode ?? null,
    reasonCode: row.reasonCode ?? null,
    reason: row.reason ?? null,
    attempt: row.attempt,
  }
}

export function noProposalFlag(advice: unknown): { reasonCode: string; reason: string } {
  const outcome = readAdviceOutcome(advice)
  return {
    reasonCode: outcome.reasonCode ?? 'no_proposal',
    reason: outcome.reason ?? 'The resolution advisor did not propose an action.',
  }
}

export function mergeRunIds(current: TriageRunIds | null | undefined, agentId: string, runId: string): TriageRunIds {
  const next: TriageRunIds = { ...(current ?? {}) }
  if (agentId.endsWith('context_identifier')) next.identifier = runId
  else if (agentId.endsWith('classifier')) next.classifier = runId
  else if (agentId.endsWith('resolution_advisor')) next.advisor = runId
  return next
}

export type TriageView = {
  aiMode: TriageAiMode | null
  stage: TriageStage
  reason: string | null
  reasonCode: string | null
  route: string | null
  priority: string | null
  priorityReason: string | null
  recommendedActionLabel: string | null
  draftState: TriageDraftState
  confidence: number | null
  proposalId: string | null
  disposition: string | null
  executionId: string | null
  workflowInstanceId: string | null
  attempt: number
  groundingState: string
  groundingIssues: string[]
  identification: Loose | null
  classification: Loose | null
  uncertainty: ProjectedUncertainty[]
  updatedAt: string
}

export function toTriageView(row: TicketTriage): TriageView {
  return {
    aiMode: row.aiMode ?? null,
    stage: row.stage,
    reason: row.reason ?? null,
    reasonCode: row.reasonCode ?? null,
    route: row.route ?? null,
    priority: row.priority ?? null,
    priorityReason: row.priorityReason ?? null,
    recommendedActionLabel: row.recommendedActionLabel ?? null,
    draftState: row.draftState,
    confidence: row.confidence === null || row.confidence === undefined ? null : Number(row.confidence),
    proposalId: row.proposalId ?? null,
    disposition: row.disposition ?? null,
    executionId: row.processExecutionId ?? null,
    workflowInstanceId: row.workflowInstanceId ?? null,
    attempt: row.attempt,
    groundingState: row.groundingState,
    groundingIssues: row.groundingIssues ?? [],
    identification: row.identification ?? null,
    classification: row.classification ?? null,
    uncertainty: (row.uncertainty ?? []).filter(isRecord).map((entry) => ({
      code: readString(entry.code) ?? 'unspecified',
      message: readString(entry.message) ?? '',
      blocking: entry.blocking === true,
      source: readString(entry.source) ?? 'unknown',
    })),
    updatedAt: row.updatedAt.toISOString(),
  }
}
