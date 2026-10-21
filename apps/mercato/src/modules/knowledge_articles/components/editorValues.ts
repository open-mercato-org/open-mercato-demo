import type {
  KnowledgeProcedureStep,
  KnowledgeRecommendedAction,
  KnowledgeRequiredCheck,
} from '../data/validators'

export type StepRow = {
  id: string
  text: string
  checkKey: string | null
  actionKey: string | null
}

export type CheckRow = {
  key: string
  label: string
  description: string | null
}

export type ActionRow = {
  actionKey: string
  label: string
  requiresApproval: boolean
  preconditions: string[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function asNullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length ? value : null
}

export function readStepRows(value: unknown): StepRow[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((entry) => ({
    id: asString(entry.id),
    text: asString(entry.text),
    checkKey: asNullableString(entry.checkKey),
    actionKey: asNullableString(entry.actionKey),
  }))
}

export function readCheckRows(value: unknown): CheckRow[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((entry) => ({
    key: asString(entry.key),
    label: asString(entry.label),
    description: asNullableString(entry.description),
  }))
}

export function readActionRows(value: unknown): ActionRow[] {
  if (!Array.isArray(value)) return []
  return value.filter(isRecord).map((entry) => ({
    actionKey: asString(entry.actionKey),
    label: asString(entry.label),
    requiresApproval: entry.requiresApproval !== false,
    preconditions: Array.isArray(entry.preconditions)
      ? entry.preconditions.filter((item): item is string => typeof item === 'string')
      : [],
  }))
}

export function toStepPayload(rows: StepRow[]): KnowledgeProcedureStep[] {
  return rows.map((row) => ({
    id: row.id,
    text: row.text.trim(),
    checkKey: row.checkKey || null,
    actionKey: row.actionKey || null,
  }))
}

export function toCheckPayload(rows: CheckRow[]): KnowledgeRequiredCheck[] {
  return rows.map((row) => ({
    key: row.key.trim(),
    label: row.label.trim(),
    description: row.description?.trim() || null,
  }))
}

export function toActionPayload(rows: ActionRow[]): KnowledgeRecommendedAction[] {
  return rows.map((row) => ({
    actionKey: row.actionKey.trim(),
    label: row.label.trim(),
    requiresApproval: row.requiresApproval,
    ...(row.preconditions.length ? { preconditions: row.preconditions } : {}),
  }))
}
