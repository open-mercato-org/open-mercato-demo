/**
 * Match rules and templating for the scripted LLM provider.
 *
 * An exact `<agentId>/<inputKey>.json` fixture cannot serve a run whose input carries
 * generated ids (an end-to-end test creates a fresh ticket per run). Two additive
 * mechanisms close that gap without touching the exact-key path:
 *
 * - **Match fixtures** — `<agentId>/*.match.json` files, tried in file-name order when no
 *   exact fixture exists. Each declares `match: { "<path>": <matcher> }`. A path reads the
 *   run input (`input.<dot.path>`) or a tool result already returned in this run
 *   (`tools.<toolName>[.<callIndex>].<dot.path>`, default the latest call). A condition on
 *   a tool the run has not called yet is DEFERRED while the fixture still has scripted
 *   steps to play, and FAILS at the final answer — so fixtures that share their first
 *   tool call (typically "read the ticket") can be told apart once its result is known.
 * - **Templates** — strings in scripted tool-call inputs, the final `object` and `text`
 *   may reference the same paths as `{{input.ticketId}}` or
 *   `{{tools.reservations.get_details.balance.overpayment}}`. A string that is exactly one
 *   placeholder keeps the referenced value's type (number, object, null); placeholders
 *   inside a longer string interpolate as text. Filters: `| number`, `| lower`,
 *   `| upper`, `| json`, `| default:<json literal>` and `| match:<regex>` (first capture
 *   group, or the whole match; must be the last filter).
 */

import { z } from 'zod'

export type ScriptedScope = {
  input: unknown
  tools: Record<string, unknown[]>
}

const OPERATOR_KEYS = ['equals', 'contains', 'matches', 'exists', 'in', 'gt', 'gte', 'lt', 'lte', 'not'] as const

const scalarSchema = z.union([z.string(), z.number(), z.boolean(), z.null()])

export type ScriptedMatcherOperators = {
  equals?: unknown
  contains?: string
  matches?: string
  exists?: boolean
  in?: unknown[]
  gt?: number
  gte?: number
  lt?: number
  lte?: number
  not?: ScriptedMatcher
}

export type ScriptedMatcher = z.infer<typeof scalarSchema> | ScriptedMatcherOperators | unknown[]

export const scriptedMatchRulesSchema = z.record(z.string().min(1), z.unknown())

const PLACEHOLDER = /\{\{\s*((?:(?!\{\{|\}\})[\s\S])+?)\s*\}\}/g
const WHOLE_PLACEHOLDER = /^\{\{\s*((?:(?!\{\{|\}\})[\s\S])+?)\s*\}\}$/

type PathResolution = { status: 'found'; value: unknown } | { status: 'missing' } | { status: 'deferred' }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function tokenizePath(path: string): string[] {
  const tokens: string[] = []
  for (const segment of path.split('.')) {
    if (!segment) continue
    const parts = segment.split(/\[(\d+)\]/).filter((part) => part.length > 0)
    tokens.push(...parts)
  }
  return tokens
}

function walk(value: unknown, tokens: string[]): PathResolution {
  let current: unknown = value
  for (const token of tokens) {
    if (Array.isArray(current) && /^\d+$/.test(token)) {
      const index = Number(token)
      if (index >= current.length) return { status: 'missing' }
      current = current[index]
      continue
    }
    if (Array.isArray(current) && token === 'length') {
      current = current.length
      continue
    }
    if (!isRecord(current) || !(token in current)) return { status: 'missing' }
    current = current[token]
  }
  return { status: 'found', value: current }
}

export function normalizeScriptedToolName(name: string): string {
  return name.replace(/__/g, '.')
}

function resolveToolPath(rest: string, tools: Record<string, unknown[]>, knownToolNames: readonly string[]): PathResolution {
  const called = Object.keys(tools).sort((left, right) => right.length - left.length)
  for (const name of called) {
    if (rest !== name && !rest.startsWith(`${name}.`) && !rest.startsWith(`${name}[`)) continue
    const results = tools[name] ?? []
    let tokens = tokenizePath(rest.slice(name.length))
    let index = results.length - 1
    if (tokens.length > 0 && /^\d+$/.test(tokens[0])) {
      index = Number(tokens[0])
      tokens = tokens.slice(1)
    }
    if (index < 0 || index >= results.length) return { status: 'missing' }
    return walk(results[index], tokens)
  }
  const pending = knownToolNames.some((name) => rest === name || rest.startsWith(`${name}.`) || rest.startsWith(`${name}[`))
  if (pending) return { status: 'deferred' }
  const dotted = rest.split('.')
  if (dotted.length >= 2) return { status: 'deferred' }
  return { status: 'missing' }
}

export function resolveScriptedPath(
  path: string,
  scope: ScriptedScope,
  knownToolNames: readonly string[] = [],
): PathResolution {
  const trimmed = path.trim()
  if (trimmed === 'input') return { status: 'found', value: scope.input }
  if (trimmed.startsWith('input.') || trimmed.startsWith('input[')) {
    return walk(scope.input, tokenizePath(trimmed.slice('input'.length)))
  }
  if (trimmed.startsWith('tools.')) {
    return resolveToolPath(trimmed.slice('tools.'.length), scope.tools, knownToolNames)
  }
  return { status: 'missing' }
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true
  if (typeof left === 'number' && typeof right === 'string') return String(left) === right
  if (typeof left === 'string' && typeof right === 'number') return left === String(right)
  return JSON.stringify(left) === JSON.stringify(right)
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value)
  return null
}

function isOperatorObject(matcher: unknown): matcher is ScriptedMatcherOperators {
  return isRecord(matcher) && Object.keys(matcher).length > 0 && Object.keys(matcher).every((key) => (OPERATOR_KEYS as readonly string[]).includes(key))
}

export function testScriptedMatcher(value: unknown, present: boolean, matcher: unknown): boolean {
  if (!isOperatorObject(matcher)) return present && deepEqual(value, matcher)
  if (matcher.exists !== undefined && matcher.exists !== (present && value !== null && value !== undefined)) return false
  if (matcher.not !== undefined && testScriptedMatcher(value, present, matcher.not)) return false
  const valueChecks = OPERATOR_KEYS.filter((key) => key !== 'exists' && key !== 'not' && matcher[key] !== undefined)
  if (valueChecks.length === 0) return true
  if (!present) return false
  if (matcher.equals !== undefined && !deepEqual(value, matcher.equals)) return false
  if (matcher.contains !== undefined) {
    const haystack = Array.isArray(value) ? value.map(toText).join('\n') : toText(value)
    if (!haystack.toLowerCase().includes(String(matcher.contains).toLowerCase())) return false
  }
  if (matcher.matches !== undefined && !new RegExp(String(matcher.matches)).test(toText(value))) return false
  if (matcher.in !== undefined && !(Array.isArray(matcher.in) && matcher.in.some((entry) => deepEqual(value, entry)))) return false
  const numeric = toNumber(value)
  if (matcher.gt !== undefined && !(numeric !== null && numeric > matcher.gt)) return false
  if (matcher.gte !== undefined && !(numeric !== null && numeric >= matcher.gte)) return false
  if (matcher.lt !== undefined && !(numeric !== null && numeric < matcher.lt)) return false
  if (matcher.lte !== undefined && !(numeric !== null && numeric <= matcher.lte)) return false
  return true
}

/**
 * `final` is true when the fixture would answer on this turn (no scripted step left, or
 * the call offers no tools). Deferred tool conditions pass before that and fail at it.
 */
export function evaluateScriptedMatch(
  rules: Record<string, unknown>,
  scope: ScriptedScope,
  options: { final: boolean; knownToolNames?: readonly string[] },
): boolean {
  for (const [path, matcher] of Object.entries(rules)) {
    const resolution = resolveScriptedPath(path, scope, options.knownToolNames ?? [])
    if (resolution.status === 'deferred') {
      if (options.final) return false
      continue
    }
    const present = resolution.status === 'found'
    if (!testScriptedMatcher(present ? resolution.value : undefined, present, matcher)) return false
  }
  return true
}

function applyFilter(value: unknown, filter: string): unknown {
  const separator = filter.indexOf(':')
  const name = (separator === -1 ? filter : filter.slice(0, separator)).trim()
  const argument = separator === -1 ? '' : filter.slice(separator + 1).trim()
  switch (name) {
    case 'number':
      return toNumber(value)
    case 'lower':
      return toText(value).toLowerCase()
    case 'upper':
      return toText(value).toUpperCase()
    case 'json':
      return JSON.stringify(value ?? null)
    case 'default':
      if (value !== null && value !== undefined && value !== '') return value
      try {
        return JSON.parse(argument)
      } catch {
        return argument
      }
    case 'match': {
      const found = new RegExp(argument).exec(toText(value))
      if (!found) return null
      return found[1] ?? found[0]
    }
    default:
      throw new Error(`[internal] unknown scripted template filter "${name}"`)
  }
}

export function evaluateScriptedExpression(expression: string, scope: ScriptedScope): unknown {
  const matchIndex = expression.search(/\|\s*match:/)
  const head = matchIndex === -1 ? expression : expression.slice(0, matchIndex)
  const tail = matchIndex === -1 ? null : expression.slice(matchIndex + 1).trim()
  const [path, ...filters] = head.split('|')
  const resolution = resolveScriptedPath(path, scope)
  let value: unknown = resolution.status === 'found' ? resolution.value : undefined
  for (const filter of filters) {
    if (filter.trim()) value = applyFilter(value, filter)
  }
  if (tail) value = applyFilter(value, tail)
  return value === undefined ? null : value
}

export function renderScriptedTemplate<T>(value: T, scope: ScriptedScope): T {
  if (typeof value === 'string') {
    const whole = WHOLE_PLACEHOLDER.exec(value)
    if (whole) return evaluateScriptedExpression(whole[1], scope) as T
    if (!value.includes('{{')) return value
    return value.replace(PLACEHOLDER, (_token, expression: string) => toText(evaluateScriptedExpression(expression, scope))) as T
  }
  if (Array.isArray(value)) return value.map((entry) => renderScriptedTemplate(entry, scope)) as T
  if (isRecord(value)) {
    const rendered: Record<string, unknown> = {}
    for (const [key, entry] of Object.entries(value)) rendered[key] = renderScriptedTemplate(entry, scope)
    return rendered as T
  }
  return value
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== 'string') return value
  const trimmed = value.trim()
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return value
  try {
    return JSON.parse(trimmed)
  } catch {
    return value
  }
}

function readToolOutput(output: unknown): unknown {
  if (!isRecord(output)) return parseMaybeJson(output)
  const type = output.type
  if (type === 'json' || type === 'error-json') return parseMaybeJson(output.value)
  if (type === 'text' || type === 'error-text') return parseMaybeJson(output.value)
  if (type === 'content' && Array.isArray(output.value)) {
    const text = output.value
      .map((part) => (isRecord(part) && part.type === 'text' && typeof part.text === 'string' ? part.text : ''))
      .join('')
    return parseMaybeJson(text)
  }
  if ('value' in output) return parseMaybeJson(output.value)
  return output
}

/** Tool results already present in the prompt, keyed by dotted tool name, in call order. */
export function collectScriptedToolResults(prompt: ReadonlyArray<unknown>): Record<string, unknown[]> {
  const results: Record<string, unknown[]> = {}
  for (const message of prompt) {
    if (!isRecord(message) || message.role !== 'tool' || !Array.isArray(message.content)) continue
    for (const part of message.content) {
      if (!isRecord(part) || part.type !== 'tool-result' || typeof part.toolName !== 'string') continue
      const name = normalizeScriptedToolName(part.toolName)
      const bucket = results[name] ?? []
      bucket.push(readToolOutput(part.output ?? part.result))
      results[name] = bucket
    }
  }
  return results
}

export function parseScriptedInputText(text: string): unknown {
  const parsed = parseMaybeJson(text)
  return parsed
}
