import type { EntityManager } from '@mikro-orm/postgresql'
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

type VersionRow = { article_key?: unknown; version?: unknown; snapshot?: unknown }

/**
 * Reads a published knowledge article version through its table contract
 * (`knowledge_article_versions`, immutable rows) without importing the
 * knowledge_articles module. Soft-optional: a missing module or table yields null.
 */
export async function loadArticlePolicy(
  em: EntityManager,
  scope: TriageScope,
  articleKey: string | null | undefined,
  version?: number | null,
): Promise<KbArticlePolicy | null> {
  const key = typeof articleKey === 'string' ? articleKey.trim() : ''
  if (!key) return null
  const params: unknown[] = [scope.tenantId, scope.organizationId, key]
  let sql = 'SELECT article_key, version, snapshot FROM knowledge_article_versions WHERE tenant_id = ? AND organization_id = ? AND article_key = ?'
  if (typeof version === 'number' && Number.isInteger(version) && version > 0) {
    sql += ' AND version = ?'
    params.push(version)
  }
  sql += ' ORDER BY version DESC LIMIT 1'
  try {
    const rows = (await em.getConnection().execute(sql, params)) as VersionRow[]
    const row = Array.isArray(rows) ? rows[0] : undefined
    if (!row) return null
    const rowVersion = typeof row.version === 'number' ? row.version : Number(row.version)
    if (!Number.isFinite(rowVersion)) return null
    return toArticlePolicy(String(row.article_key ?? key), rowVersion, row.snapshot)
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
