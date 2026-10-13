/**
 * Pure helpers behind `ProposalDecisionCard` (spec §A): which editor a payload
 * field gets, which fields the agent's own schema marks as long text, how a
 * verdict becomes a dispose request body, and where the template segments sit
 * inside a drafted text. No React, so every rule is unit-testable.
 */

import type { ActionEdit, EditableActionField } from './proposalEdit'

export const LONG_TEXT_FORMAT_MARKER = 'format:long_text'

export type DecisionFieldWidget = 'long_text' | 'money' | 'readonly' | 'masked'

export type DecisionFieldOverride = {
  widget: DecisionFieldWidget
  labelKey?: string
  /** `masked` only: the viewer may reveal the full value (the host decides who can). */
  revealable?: boolean
}

/** Keyed `<actionType>.<field>`; `*.<field>` applies to every action type. */
export type DecisionFieldOverrides = Record<string, DecisionFieldOverride>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function describesLongText(node: Record<string, unknown>): boolean {
  return typeof node.description === 'string' && node.description.includes(LONG_TEXT_FORMAT_MARKER)
}

function constOf(node: unknown): string | null {
  if (!isRecord(node)) return null
  if (typeof node.const === 'string') return node.const
  if (Array.isArray(node.enum) && node.enum.length === 1 && typeof node.enum[0] === 'string') return node.enum[0]
  return null
}

/**
 * Walks an agent OUTCOME JSON-Schema (as served by `GET /agents`) and collects the
 * action payload fields described with `format:long_text` (`.describe('format:long_text')`
 * on the zod schema). A field inside an action whose `type` is a constant is keyed
 * `<type>.<field>`; otherwise `*.<field>`.
 */
export function collectLongTextFields(schema: unknown): Set<string> {
  const keys = new Set<string>()
  const seen = new WeakSet<object>()
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      node.forEach(visit)
      return
    }
    if (!isRecord(node) || seen.has(node)) return
    seen.add(node)
    const properties = isRecord(node.properties) ? node.properties : null
    if (properties && isRecord(properties.payload)) {
      const actionType = constOf(properties.type)
      const payloadProperties = isRecord(properties.payload.properties) ? properties.payload.properties : {}
      for (const [field, fieldSchema] of Object.entries(payloadProperties)) {
        if (isRecord(fieldSchema) && describesLongText(fieldSchema)) keys.add(`${actionType ?? '*'}.${field}`)
      }
    }
    for (const value of Object.values(node)) visit(value)
  }
  visit(schema)
  return keys
}

export function resolveFieldOverride(
  actionType: string,
  field: string,
  overrides: DecisionFieldOverrides | undefined,
  schemaLongText: Set<string>,
): DecisionFieldOverride | null {
  const explicit = overrides?.[`${actionType}.${field}`] ?? overrides?.[`*.${field}`]
  if (explicit) return explicit
  if (schemaLongText.has(`${actionType}.${field}`) || schemaLongText.has(`*.${field}`)) return { widget: 'long_text' }
  return null
}

/** A field the operator may change: masked and read-only fields pass through verbatim. */
export function isEditableWidget(override: DecisionFieldOverride | null, field: EditableActionField): boolean {
  if (!override) return true
  if (override.widget === 'readonly' || override.widget === 'masked') return false
  if (override.widget === 'long_text') return field.kind === 'string'
  return true
}

export function maskValue(value: string, visible = 4): string {
  if (value.length <= visible) return '•'.repeat(value.length)
  return `${'•'.repeat(Math.min(value.length - visible, 12))}${value.slice(-visible)}`
}

export type DisposeVerdict = 'approved' | 'edited' | 'rejected'

export type DisposeRequestBody = {
  disposition: DisposeVerdict
  selectedOptionId?: string
  payload?: Record<string, unknown>
  reason?: string
}

export type DisposeBodyResult = { ok: true; body: DisposeRequestBody } | { ok: false; error: 'option' | 'reason' | 'payload' }

/**
 * Builds the dispose body the endpoint accepts: approve and edit name the chosen
 * option, edit and reject carry a reason, edit carries the FULL re-assembled
 * envelope, and reject never names an option.
 */
export function buildDisposeBody(
  verdict: DisposeVerdict,
  input: { selectedOptionId: string | null; payload?: Record<string, unknown> | null; reason?: string | null },
): DisposeBodyResult {
  const reason = input.reason?.trim() ?? ''
  if (verdict === 'rejected') {
    if (!reason) return { ok: false, error: 'reason' }
    return { ok: true, body: { disposition: 'rejected', reason } }
  }
  if (!input.selectedOptionId) return { ok: false, error: 'option' }
  if (verdict === 'approved') {
    return {
      ok: true,
      body: { disposition: 'approved', selectedOptionId: input.selectedOptionId, ...(reason ? { reason } : {}) },
    }
  }
  if (!reason) return { ok: false, error: 'reason' }
  if (!input.payload) return { ok: false, error: 'payload' }
  return {
    ok: true,
    body: { disposition: 'edited', selectedOptionId: input.selectedOptionId, payload: input.payload, reason },
  }
}

export type HighlightPart = { text: string; source: 'template' | 'generated' | 'plain'; ref?: string }

/**
 * Splits `text` into parts, marking every `template` segment that still appears
 * verbatim. An operator edit that rewrites a template sentence simply stops
 * highlighting it — the highlight claims "this came from the source", so it must
 * never outlive the text it describes.
 */
export function highlightTemplateSegments(
  text: string,
  segments: Array<{ source: 'template' | 'generated'; text: string; ref?: string }> | undefined,
): HighlightPart[] {
  const templates = (segments ?? []).filter((segment) => segment.source === 'template' && segment.text.trim().length > 0)
  if (!text) return []
  if (templates.length === 0) return [{ text, source: 'plain' }]
  const matches: Array<{ start: number; end: number; ref?: string }> = []
  for (const segment of templates) {
    const needle = segment.text.trim()
    let from = 0
    while (from <= text.length) {
      const index = text.indexOf(needle, from)
      if (index < 0) break
      const end = index + needle.length
      if (!matches.some((match) => index < match.end && end > match.start)) {
        matches.push({ start: index, end, ref: segment.ref })
      }
      from = end
    }
  }
  matches.sort((left, right) => left.start - right.start)
  const parts: HighlightPart[] = []
  let cursor = 0
  for (const match of matches) {
    if (match.start > cursor) parts.push({ text: text.slice(cursor, match.start), source: 'plain' })
    parts.push({ text: text.slice(match.start, match.end), source: 'template', ...(match.ref ? { ref: match.ref } : {}) })
    cursor = match.end
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), source: 'plain' })
  return parts
}

/** Field values of the edited plan, keyed `<actionIndex>.<field>`, for change detection. */
export function snapshotActionEdits(edits: ActionEdit[]): Record<string, string> {
  const snapshot: Record<string, string> = {}
  edits.forEach((edit, index) => {
    for (const field of edit.fields) snapshot[`${index}.${field.key}`] = String(field.value)
  })
  return snapshot
}

export function countChangedFields(before: ActionEdit[], after: ActionEdit[]): number {
  const left = snapshotActionEdits(before)
  const right = snapshotActionEdits(after)
  return Object.keys(right).filter((key) => left[key] !== right[key]).length
}
