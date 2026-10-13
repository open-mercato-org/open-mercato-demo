import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { recordStageArgsSchema } from '../data/validators'
import { emitTriageAgentsEvent } from '../events'
import { loadArticlePolicy, resolveKbVersionReader, type KbArticlePolicy, type KbArticleVersionReader, type TriageScope } from './kbArticles'
import { computePriority, normalizeDays, type ComputePriorityResult } from './priorityPolicy'
import { decideRoute, type RouteDecision } from './routePolicy'
import { isRecord, noProposalFlag, parseMaybeJsonRecord, recordTriageStage, type RecordStageResult } from './projection'

export type TriageFunctionContext = {
  workflowInstance: { id: string; tenantId: string; organizationId: string }
}

type ResolverLike = { resolve: <T = unknown>(name: string) => T }

export type TriageWorkflowFunction<TResult> = (args: unknown, context: TriageFunctionContext) => Promise<TResult>

const looseRecord = z.record(z.string(), z.unknown())

const computePriorityArgsSchema = z.object({
  daysToDeparture: z.union([z.number(), z.string(), z.null()]).optional(),
  identification: looseRecord.nullable().optional(),
  classification: looseRecord.nullable().optional(),
  topicKey: z.string().nullable().optional(),
  topicVersion: z.union([z.number(), z.string(), z.null()]).optional(),
  priorityFloor: z.string().nullable().optional(),
  urgencySignal: z.string().nullable().optional(),
})

const routeArgsSchema = z.object({
  identification: looseRecord.nullable().optional(),
  classification: looseRecord.nullable().optional(),
})

function scopeOf(context: TriageFunctionContext): TriageScope {
  const instance = context?.workflowInstance
  if (!instance?.tenantId || !instance.organizationId) {
    throw new Error('[internal] triage_agents workflow functions need a tenant- and organization-scoped workflow instance')
  }
  return { tenantId: instance.tenantId, organizationId: instance.organizationId }
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function parseArgs<T extends z.ZodTypeAny>(schema: T, args: unknown, name: string): z.infer<T> {
  const parsed = schema.safeParse(args ?? {})
  if (!parsed.success) {
    throw new Error(`[internal] ${name}: invalid arguments — ${parsed.error.issues[0]?.message ?? 'invalid'}`)
  }
  return parsed.data
}

export function resolveDaysToDeparture(identification: Record<string, unknown> | null | undefined): number | null {
  const reservation = identification && isRecord(identification.reservation) ? identification.reservation : null
  const direct = normalizeDays(reservation?.daysToDeparture)
  if (direct !== null) return direct
  const candidates = Array.isArray(reservation?.candidates) ? reservation.candidates.filter(isRecord) : []
  const days = candidates.map((candidate) => normalizeDays(candidate.daysToDeparture)).filter((value): value is number => value !== null)
  const upcoming = days.filter((value) => value >= 0)
  if (upcoming.length > 0) return Math.min(...upcoming)
  return days.length > 0 ? Math.max(...days) : null
}

function topicOf(classification: Record<string, unknown> | null | undefined, explicit?: string | null): string | null {
  return readString(explicit) ?? readString(classification?.topicKey)
}

function versionOf(classification: Record<string, unknown> | null | undefined, explicit?: number | string | null): number | null {
  const value = normalizeDays(explicit ?? classification?.topicVersion)
  return value !== null && value > 0 ? value : null
}

export async function loadTopicArticle(
  reader: KbArticleVersionReader | null,
  scope: TriageScope,
  topicKey: string | null,
  topicVersion: number | null,
): Promise<KbArticlePolicy | null> {
  if (!topicKey) return null
  const exact = await loadArticlePolicy(reader, scope, topicKey, topicVersion)
  if (exact || topicVersion === null) return exact
  return loadArticlePolicy(reader, scope, topicKey, null)
}

export type ComputePriorityFunctionResult = ComputePriorityResult & { topicKey: string | null; priorityFloor: string | null; reviewPriority: ReviewPriority }

export type ReviewPriority = 'low' | 'medium' | 'high' | 'extreme'

export const REVIEW_PRIORITY: Record<ComputePriorityResult['priority'], ReviewPriority> = {
  low: 'low',
  normal: 'medium',
  high: 'high',
  urgent: 'extreme',
}

export function createComputePriorityFunction(container: ResolverLike): TriageWorkflowFunction<ComputePriorityFunctionResult> {
  return async (rawArgs, context) => {
    const args = parseArgs(computePriorityArgsSchema, rawArgs, 'triage_agents.compute_priority')
    const scope = scopeOf(context)
    const topicKey = topicOf(args.classification, args.topicKey)
    let priorityFloor = args.priorityFloor === undefined ? undefined : readString(args.priorityFloor)
    if (priorityFloor === undefined) {
      const article = await loadTopicArticle(resolveKbVersionReader(container), scope, topicKey, versionOf(args.classification, args.topicVersion))
      priorityFloor = article?.priorityFloor ?? null
    }
    const days = args.daysToDeparture !== undefined ? normalizeDays(args.daysToDeparture) : resolveDaysToDeparture(args.identification)
    const urgencySignal = readString(args.urgencySignal) ?? readString(args.classification?.urgencySignal) ?? 'none'
    const result = computePriority({ daysToDeparture: days, priorityFloor, urgencySignal })
    return { ...result, topicKey, priorityFloor: priorityFloor ?? null, reviewPriority: REVIEW_PRIORITY[result.priority] }
  }
}

export type ClassifyCommandInput = {
  customerPersonId: string | null
  reservationId: string | null
  reservationNumberSnapshot: string | null
  categoryKey: string | null
  subcategoryKey: string | null
  topicKey: string | null
  categoryPathSnapshot: string | null
  summary: string | null
}

export type RouteFunctionResult = RouteDecision & {
  hasTargetQueue: boolean
  article: { key: string; version: number; automationLevel: string; categoryPath: string } | null
  classify: ClassifyCommandInput
}

export function buildClassifyInput(
  identification: Record<string, unknown> | null | undefined,
  classification: Record<string, unknown> | null | undefined,
  article: KbArticlePolicy | null,
): ClassifyCommandInput {
  const customer = identification && isRecord(identification.customer) ? identification.customer : null
  const reservation = identification && isRecord(identification.reservation) ? identification.reservation : null
  const reservationId = readString(reservation?.reservationId)
  return {
    customerPersonId: readString(customer?.personId),
    reservationId,
    reservationNumberSnapshot: reservationId ? readString(reservation?.bookingNumber) : null,
    categoryKey: readString(classification?.categoryKey),
    subcategoryKey: readString(classification?.subcategoryKey),
    topicKey: readString(classification?.topicKey),
    categoryPathSnapshot: article?.categoryPath ?? null,
    summary: readString(classification?.summary),
  }
}

export function createRouteFunction(container: ResolverLike): TriageWorkflowFunction<RouteFunctionResult> {
  return async (rawArgs, context) => {
    const args = parseArgs(routeArgsSchema, rawArgs, 'triage_agents.route')
    const scope = scopeOf(context)
    const classification = args.classification ?? null
    const article = await loadTopicArticle(resolveKbVersionReader(container), scope, topicOf(classification), versionOf(classification))
    const decision = decideRoute(args.identification ?? null, classification, article)
    return {
      ...decision,
      hasTargetQueue: Boolean(decision.targetQueueKey),
      article: article
        ? { key: article.key, version: article.version, automationLevel: article.automationLevel, categoryPath: article.categoryPath }
        : null,
      classify: buildClassifyInput(args.identification, classification, article),
    }
  }
}

export type RecordStageFunctionResult = RecordStageResult & { flag: { reasonCode: string; reason: string } | null }

export function createRecordStageFunction(container: ResolverLike): TriageWorkflowFunction<RecordStageFunctionResult> {
  return async (rawArgs, context) => {
    const args = parseArgs(recordStageArgsSchema, normalizeRecordStageArgs(rawArgs), 'triage_agents.record_stage')
    const scope = scopeOf(context)
    const em = container.resolve<EntityManager>('em').fork()
    const result = await recordTriageStage(em, scope, args, context.workflowInstance.id)
    await emitTriageAgentsEvent(
      'triage_agents.triage.updated',
      { ticketId: result.ticketId, stage: result.stage, aiMode: result.aiMode, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    return { ...result, flag: args.advice ? noProposalFlag(args.advice) : null }
  }
}

const RECORD_STAGE_OBJECT_KEYS = ['identification', 'classification', 'priority', 'route', 'advice', 'effects'] as const

export function normalizeRecordStageArgs(rawArgs: unknown): unknown {
  if (!isRecord(rawArgs)) return rawArgs
  const normalized: Record<string, unknown> = { ...rawArgs }
  for (const key of RECORD_STAGE_OBJECT_KEYS) {
    const value = normalized[key]
    if (value === undefined || value === null) continue
    const parsed = parseMaybeJsonRecord(value)
    if (parsed) normalized[key] = parsed
    else if (typeof value === 'string' && value.includes('{{')) delete normalized[key]
  }
  for (const [key, value] of Object.entries(normalized)) {
    if (typeof value === 'string' && /^\{\{.+\}\}$/.test(value.trim())) delete normalized[key]
  }
  return normalized
}
