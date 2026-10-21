import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'

const logger = createLogger('triage_agents').child({ component: 'kbArticles' })

export type TriageScope = {
  tenantId: string
  organizationId: string
}

export type KbProcedureStep = { id: string; text: string; checkKey?: string | null; actionKey?: string | null }
export type KbRequiredCheck = { key: string; label: string }
export type KbRecommendedAction = { actionKey: string; label: string }

export type KbArticlePolicy = {
  key: string
  version: number
  title: string
  categoryName: string | null
  subcategoryName: string | null
  categoryPath: string
  automationLevel: string
  manualReason: string | null
  targetQueueKey: string | null
  priorityFloor: string | null
  procedureSteps: KbProcedureStep[]
  requiredChecks: KbRequiredCheck[]
  recommendedActions: KbRecommendedAction[]
}

type SnapshotRecord = Record<string, unknown>

function isRecord(value: unknown): value is SnapshotRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

function readName(value: unknown): string | null {
  return isRecord(value) ? readString(value.name) : null
}

function readList<T>(value: unknown, map: (entry: SnapshotRecord) => T | null): T[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) => (isRecord(entry) ? map(entry) : null)).filter((entry): entry is T => entry !== null)
}

function parseSnapshot(raw: unknown): SnapshotRecord | null {
  if (isRecord(raw)) return raw
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw)
      return isRecord(parsed) ? parsed : null
    } catch {
      return null
    }
  }
  return null
}

export function toArticlePolicy(articleKey: string, version: number, rawSnapshot: unknown): KbArticlePolicy | null {
  const snapshot = parseSnapshot(rawSnapshot)
  if (!snapshot) return null
  const title = readString(snapshot.title) ?? articleKey
  const categoryName = readName(snapshot.category)
  const subcategoryName = readName(snapshot.subcategory)
  return {
    key: articleKey,
    version,
    title,
    categoryName,
    subcategoryName,
    categoryPath: [categoryName, subcategoryName, title].filter((part): part is string => Boolean(part)).join(' › '),
    automationLevel: readString(snapshot.automationLevel) ?? 'manual_only',
    manualReason: readString(snapshot.manualReason),
    targetQueueKey: readString(snapshot.targetQueueKey),
    priorityFloor: readString(snapshot.priorityFloor),
    procedureSteps: readList(snapshot.procedureSteps, (entry) => {
      const id = readString(entry.id)
      const text = readString(entry.text)
      if (!id || !text) return null
      return { id, text, checkKey: readString(entry.checkKey), actionKey: readString(entry.actionKey) }
    }),
    requiredChecks: readList(snapshot.requiredChecks, (entry) => {
      const key = readString(entry.key)
      return key ? { key, label: readString(entry.label) ?? key } : null
    }),
    recommendedActions: readList(snapshot.recommendedActions, (entry) => {
      const actionKey = readString(entry.actionKey)
      return actionKey ? { actionKey, label: readString(entry.label) ?? actionKey } : null
    }),
  }
}

export const KB_VERSION_READER_KEY = 'knowledgeArticleVersionReader'

export type KbArticleVersionRecord = { key: string; version: number; snapshot: unknown }

/**
 * Structural view of the `knowledgeArticleVersionReader` DI service exposed by the
 * knowledge_articles module. Declared here so triage_agents never imports that module.
 */
export type KbArticleVersionReader = {
  readVersion(scope: TriageScope, key: string, version?: number | null): Promise<KbArticleVersionRecord | null>
}

type ResolverLike = { resolve: <T = unknown>(name: string) => T }

function isVersionReader(value: unknown): value is KbArticleVersionReader {
  return isRecord(value) && typeof value.readVersion === 'function'
}

/** Soft-optional: null when the knowledge_articles module is not enabled. */
export function resolveKbVersionReader(container: ResolverLike | null | undefined): KbArticleVersionReader | null {
  if (!container) return null
  try {
    const reader = container.resolve<unknown>(KB_VERSION_READER_KEY)
    return isVersionReader(reader) ? reader : null
  } catch {
    return null
  }
}

/**
 * Reads a published knowledge article version through the knowledge_articles DI
 * reader (immutable snapshots). Soft-optional: a missing module, article or a read
 * failure yields null.
 */
export async function loadArticlePolicy(
  reader: KbArticleVersionReader | null,
  scope: TriageScope,
  articleKey: string | null | undefined,
  version?: number | null,
): Promise<KbArticlePolicy | null> {
  const key = typeof articleKey === 'string' ? articleKey.trim() : ''
  if (!key || !reader) return null
  const requested = typeof version === 'number' && Number.isInteger(version) && version > 0 ? version : null
  try {
    const record = await reader.readVersion(scope, key, requested)
    if (!record) return null
    const recordVersion = typeof record.version === 'number' ? record.version : Number(record.version)
    if (!Number.isFinite(recordVersion)) return null
    return toArticlePolicy(readString(record.key) ?? key, recordVersion, record.snapshot)
  } catch (err) {
    logger.warn('Knowledge article lookup unavailable', { articleKey: key, error: err instanceof Error ? err.message : String(err) })
    reportError(err, { module: 'triage_agents', code: 'triage_agents.kb_lookup_failed' })
    return null
  }
}

export function parseCitationRef(ref: string): { key: string; version: number; anchor: string | null } | null {
  const match = /^([a-z0-9_.]+)@(\d+)(?:#(.+))?$/.exec(ref.trim())
  if (!match) return null
  return { key: match[1], version: Number(match[2]), anchor: match[3] ?? null }
}
