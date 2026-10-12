/**
 * ScriptedAdapter — a deterministic, offline `LlmProvider` for integration tests and
 * demo rehearsals. It never reaches a network: every model call is answered from a
 * fixture file recorded for the calling agent and input.
 *
 * Active only when `OM_AI_PROVIDER=scripted`, and never in production unless the
 * operator also sets `OM_AI_SCRIPTED_ALLOW=1`. Fixtures live at
 * `<root>/<agentId>/<inputKey>.json`, where `<root>` is any directory listed in
 * `OM_AI_SCRIPTED_FIXTURES_DIR` (path-delimiter separated) or registered through
 * {@link registerScriptedLlmFixtureDirs}, and `<agentId>`/`<inputKey>` come from the
 * caller's {@link withScriptedLlmContext} binding. A missing fixture is a
 * deterministic `scripted_fixture_missing` error — never a fallback to a real model.
 *
 * A fixture may script tool calls before its final answer (`steps[].toolCalls`), so a
 * tool-loop run executes the real tools and its trace carries real tool spans.
 *
 * When no exact fixture exists, `<agentId>/*.match.json` files are tried in file-name
 * order: each carries `match` rules over the run input and the tool results already
 * returned, and its tool-call inputs / final answer may template both
 * (`{{input.ticketId}}`, `{{tools.reservations.get_details.balance.overpayment}}`).
 * See `scripted-matching.ts`.
 *
 * @see packages/shared/src/lib/ai/llm-provider.ts
 * @see .ai/specs/enterprise/agent-orchestrator/2026-10-12-process-flow-trace-replay-and-embeddable-decision-card.md §G
 */

import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import { MockLanguageModelV4, simulateReadableStream } from 'ai/test'
import { z } from 'zod'
import { parseBooleanToken } from '@open-mercato/shared/lib/boolean'
import type {
  EnvLookup,
  LlmCreateModelOptions,
  LlmModelInfo,
  LlmProvider,
} from '@open-mercato/shared/lib/ai/llm-provider'
import { getScriptedLlmContext, type ScriptedLlmContext } from './scripted-context'
import {
  collectScriptedToolResults,
  evaluateScriptedMatch,
  normalizeScriptedToolName,
  parseScriptedInputText,
  renderScriptedTemplate,
  scriptedMatchRulesSchema,
  type ScriptedScope,
} from './scripted-matching'

export const SCRIPTED_PROVIDER_ID = 'scripted'
export const SCRIPTED_FIXTURE_MISSING = 'scripted_fixture_missing'
export const SCRIPTED_FIXTURE_INVALID = 'scripted_fixture_invalid'
export const SCRIPTED_DEFAULT_AGENT_ID = '_default'
export const SCRIPTED_MATCH_FIXTURE_SUFFIX = '.match.json'

const DEFAULT_MODEL = 'scripted'
const DEFAULT_MODELS: readonly LlmModelInfo[] = [
  { id: DEFAULT_MODEL, name: 'Scripted fixtures', contextWindow: 1000000, tags: ['testing'] },
]
const SAFE_SEGMENT = /^[A-Za-z0-9_.:-]+$/

type MockModelOptions = NonNullable<ConstructorParameters<typeof MockLanguageModelV4>[0]>
type DoGenerateFunction = Extract<NonNullable<MockModelOptions['doGenerate']>, (...args: never[]) => unknown>
type DoStreamFunction = Extract<NonNullable<MockModelOptions['doStream']>, (...args: never[]) => unknown>
type ScriptedCallOptions = Parameters<DoGenerateFunction>[0]
type ScriptedGenerateResult = Awaited<ReturnType<DoGenerateFunction>>
type ScriptedStreamResult = Awaited<ReturnType<DoStreamFunction>>
type ScriptedStreamPart = ScriptedStreamResult['stream'] extends ReadableStream<infer Part> ? Part : never
type ScriptedContent = ScriptedGenerateResult['content'][number]

const scriptedToolCallSchema = z.object({
  toolName: z.string().min(1),
  input: z.record(z.string(), z.unknown()).optional(),
})

const scriptedFixtureUsageSchema = z.object({
  inputTokens: z.number().int().min(0).optional(),
  outputTokens: z.number().int().min(0).optional(),
})

const scriptedFixtureSchema = z
  .object({
    steps: z.array(z.object({ toolCalls: z.array(scriptedToolCallSchema).min(1) })).optional(),
    object: z.unknown().optional(),
    text: z.string().optional(),
    usage: scriptedFixtureUsageSchema.optional(),
  })
  .refine((fixture) => fixture.object !== undefined || fixture.text !== undefined, {
    message: 'a scripted fixture must declare a final "object" or "text"',
  })

export type ScriptedFixture = z.infer<typeof scriptedFixtureSchema>

export class ScriptedLlmFixtureError extends Error {
  readonly code: typeof SCRIPTED_FIXTURE_MISSING | typeof SCRIPTED_FIXTURE_INVALID
  readonly agentId: string
  readonly inputKey: string

  constructor(
    code: typeof SCRIPTED_FIXTURE_MISSING | typeof SCRIPTED_FIXTURE_INVALID,
    context: ScriptedLlmContext,
    detail: string,
  ) {
    super(`[internal] ${code}: agent "${context.agentId}" input "${context.inputKey}" — ${detail}`)
    this.name = 'ScriptedLlmFixtureError'
    this.code = code
    this.agentId = context.agentId
    this.inputKey = context.inputKey
  }
}

const registeredFixtureDirs = new Set<string>()

/**
 * Add fixture roots programmatically — a module contributes its own
 * `agents-fixtures/` directory this way. Relative paths resolve against the process
 * working directory. Idempotent.
 */
export function registerScriptedLlmFixtureDirs(dirs: readonly string[]): void {
  for (const dir of dirs) {
    const trimmed = dir.trim()
    if (trimmed) registeredFixtureDirs.add(path.resolve(trimmed))
  }
}

export function clearScriptedLlmFixtureDirsForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('[internal] clearScriptedLlmFixtureDirsForTests is test-only')
  }
  registeredFixtureDirs.clear()
}

export function listScriptedLlmFixtureDirs(env: EnvLookup = process.env): string[] {
  const fromEnv = (env.OM_AI_SCRIPTED_FIXTURES_DIR ?? '')
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0)
    .map((entry) => path.resolve(entry))
  return [...new Set([...fromEnv, ...registeredFixtureDirs])]
}

/**
 * The production guard. `OM_AI_PROVIDER` must name this provider explicitly, and a
 * production process additionally needs `OM_AI_SCRIPTED_ALLOW=1`.
 */
export function isScriptedLlmProviderEnabled(env: EnvLookup = process.env): boolean {
  const selected = (env.OM_AI_PROVIDER ?? '').trim().toLowerCase()
  if (selected !== SCRIPTED_PROVIDER_ID) return false
  if (env.NODE_ENV !== 'production') return true
  return parseBooleanToken(env.OM_AI_SCRIPTED_ALLOW ?? null) === true
}

function hashText(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function lastUserText(options: ScriptedCallOptions): string {
  const userMessages = options.prompt.filter((message) => message.role === 'user')
  const last = userMessages[userMessages.length - 1]
  if (!last || last.role !== 'user') return ''
  return last.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .join('\n')
}

/**
 * The binding set by the caller, or — for a call made outside one — the
 * `_default` agent keyed by the SHA-256 of the last user message text.
 */
export function resolveScriptedLlmContext(options: ScriptedCallOptions): ScriptedLlmContext {
  return getScriptedLlmContext() ?? { agentId: SCRIPTED_DEFAULT_AGENT_ID, inputKey: hashText(lastUserText(options)) }
}

function assertSafeContext(context: ScriptedLlmContext): void {
  if (!SAFE_SEGMENT.test(context.agentId) || !SAFE_SEGMENT.test(context.inputKey)) {
    throw new ScriptedLlmFixtureError(SCRIPTED_FIXTURE_MISSING, context, 'agent id or input key is not a safe path segment')
  }
}

function readFixtureFile<T>(file: string, schema: z.ZodType<T>, context: ScriptedLlmContext): T {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    throw new ScriptedLlmFixtureError(SCRIPTED_FIXTURE_INVALID, context, `${file} is not valid JSON`)
  }
  const parsed = schema.safeParse(raw)
  if (!parsed.success) {
    throw new ScriptedLlmFixtureError(SCRIPTED_FIXTURE_INVALID, context, `${file}: ${parsed.error.issues[0]?.message ?? 'invalid'}`)
  }
  return parsed.data
}

function missingFixtureError(context: ScriptedLlmContext, roots: string[], detail?: string): ScriptedLlmFixtureError {
  const searched = roots.length > 0 ? roots.join(', ') : 'no fixture directory configured'
  return new ScriptedLlmFixtureError(SCRIPTED_FIXTURE_MISSING, context, `${detail ? `${detail}; ` : ''}searched: ${searched}`)
}

function findExactScriptedFixture(context: ScriptedLlmContext, roots: string[]): ScriptedFixture | null {
  for (const root of roots) {
    const file = path.join(root, context.agentId, `${context.inputKey}.json`)
    if (existsSync(file)) return readFixtureFile(file, scriptedFixtureSchema, context)
  }
  return null
}

export function loadScriptedFixture(context: ScriptedLlmContext, env: EnvLookup = process.env): ScriptedFixture {
  assertSafeContext(context)
  const roots = listScriptedLlmFixtureDirs(env)
  const fixture = findExactScriptedFixture(context, roots)
  if (fixture) return fixture
  throw missingFixtureError(context, roots)
}

const scriptedMatchFixtureSchema = z
  .object({
    match: scriptedMatchRulesSchema,
    steps: z.array(z.object({ toolCalls: z.array(scriptedToolCallSchema).min(1) })).optional(),
    object: z.unknown().optional(),
    text: z.string().optional(),
    usage: scriptedFixtureUsageSchema.optional(),
  })
  .refine((fixture) => fixture.object !== undefined || fixture.text !== undefined, {
    message: 'a scripted fixture must declare a final "object" or "text"',
  })

export type ScriptedMatchFixture = z.infer<typeof scriptedMatchFixtureSchema> & { file: string }

export function listScriptedMatchFixtures(context: ScriptedLlmContext, env: EnvLookup = process.env): ScriptedMatchFixture[] {
  assertSafeContext(context)
  const fixtures: ScriptedMatchFixture[] = []
  for (const root of listScriptedLlmFixtureDirs(env)) {
    const dir = path.join(root, context.agentId)
    if (!existsSync(dir)) continue
    const files = readdirSync(dir).filter((name) => name.endsWith(SCRIPTED_MATCH_FIXTURE_SUFFIX)).sort()
    for (const name of files) {
      const file = path.join(dir, name)
      fixtures.push({ ...readFixtureFile(file, scriptedMatchFixtureSchema, context), file })
    }
  }
  return fixtures
}

function scriptedScopeFor(context: ScriptedLlmContext, options: ScriptedCallOptions): ScriptedScope {
  const input = context.input !== undefined ? context.input : parseScriptedInputText(lastUserText(options))
  return { input, tools: collectScriptedToolResults(options.prompt) }
}

function isFinalTurn(fixture: { steps?: unknown[] }, options: ScriptedCallOptions): boolean {
  const toolsOffered = (options.tools ?? []).length > 0
  return !toolsOffered || countAssistantTurns(options) >= (fixture.steps?.length ?? 0)
}

function stepToolNames(fixture: { steps?: Array<{ toolCalls: Array<{ toolName: string }> }> }): string[] {
  return (fixture.steps ?? []).flatMap((step) => step.toolCalls.map((call) => normalizeScriptedToolName(call.toolName)))
}

/**
 * The fixture answering this model call: the exact `<inputKey>.json` when present,
 * otherwise the first `*.match.json` whose rules hold for the run input and the tool
 * results so far. The returned fixture has its templates rendered for this turn.
 */
export function resolveScriptedFixture(
  context: ScriptedLlmContext,
  options: ScriptedCallOptions,
  env: EnvLookup = process.env,
): ScriptedFixture {
  assertSafeContext(context)
  const roots = listScriptedLlmFixtureDirs(env)
  const scope = scriptedScopeFor(context, options)
  const exact = findExactScriptedFixture(context, roots)
  if (exact) return renderScriptedTemplate(exact, scope)
  const candidates = listScriptedMatchFixtures(context, env)
  for (const candidate of candidates) {
    const final = isFinalTurn(candidate, options)
    if (!evaluateScriptedMatch(candidate.match, scope, { final, knownToolNames: stepToolNames(candidate) })) continue
    const { match: _match, file: _file, ...fixture } = candidate
    return renderScriptedTemplate(fixture, scope)
  }
  throw missingFixtureError(
    context,
    roots,
    candidates.length > 0 ? `no match fixture accepted the input (${candidates.length} tried)` : undefined,
  )
}

function resolveToolName(requested: string, options: ScriptedCallOptions): string {
  const available = new Set((options.tools ?? []).map((tool) => tool.name))
  if (available.has(requested)) return requested
  const sanitized = requested.replace(/\./g, '__')
  return available.has(sanitized) ? sanitized : requested
}

function countAssistantTurns(options: ScriptedCallOptions): number {
  return options.prompt.filter((message) => message.role === 'assistant').length
}

function buildUsage(fixture: ScriptedFixture): ScriptedGenerateResult['usage'] {
  const inputTokens = fixture.usage?.inputTokens ?? 0
  const outputTokens = fixture.usage?.outputTokens ?? 0
  return {
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
  }
}

/**
 * One scripted model turn. Steps play in order, one per assistant turn already in the
 * prompt, and only when the call offers tools at all — a single-shot structured call
 * goes straight to the final answer, so one fixture serves both execution paths.
 */
export function buildScriptedGenerateResult(
  fixture: ScriptedFixture,
  options: ScriptedCallOptions,
  modelId: string,
): ScriptedGenerateResult {
  const turn = countAssistantTurns(options)
  const steps = fixture.steps ?? []
  const toolsOffered = (options.tools ?? []).length > 0
  const response = { id: `scripted-${turn}`, modelId, timestamp: new Date(0) }
  if (toolsOffered && turn < steps.length) {
    const content: ScriptedContent[] = steps[turn].toolCalls.map((call, index) => ({
      type: 'tool-call',
      toolCallId: `scripted-${turn}-${index}`,
      toolName: resolveToolName(call.toolName, options),
      input: JSON.stringify(call.input ?? {}),
    }))
    return {
      content,
      finishReason: { unified: 'tool-calls', raw: 'tool_calls' },
      usage: buildUsage(fixture),
      response,
      warnings: [],
    }
  }
  const text = fixture.text ?? JSON.stringify(fixture.object)
  return {
    content: [{ type: 'text', text }],
    finishReason: { unified: 'stop', raw: 'stop' },
    usage: buildUsage(fixture),
    response,
    warnings: [],
  }
}

function toStreamParts(result: ScriptedGenerateResult): ScriptedStreamPart[] {
  const parts: ScriptedStreamPart[] = [{ type: 'stream-start', warnings: [] }]
  result.content.forEach((part, index) => {
    if (part.type === 'text') {
      const id = `text-${index}`
      parts.push({ type: 'text-start', id }, { type: 'text-delta', id, delta: part.text }, { type: 'text-end', id })
    } else if (part.type === 'tool-call') {
      parts.push(part)
    }
  })
  parts.push({ type: 'finish', finishReason: result.finishReason, usage: result.usage })
  return parts
}

export function createScriptedLanguageModel(options: { modelId?: string; env?: EnvLookup } = {}): MockLanguageModelV4 {
  const modelId = options.modelId?.trim() || DEFAULT_MODEL
  const generate = async (callOptions: ScriptedCallOptions): Promise<ScriptedGenerateResult> => {
    const context = resolveScriptedLlmContext(callOptions)
    const fixture = resolveScriptedFixture(context, callOptions, options.env ?? process.env)
    return buildScriptedGenerateResult(fixture, callOptions, modelId)
  }
  return new MockLanguageModelV4({
    provider: SCRIPTED_PROVIDER_ID,
    modelId,
    doGenerate: generate,
    doStream: async (callOptions) => {
      const result = await generate(callOptions)
      return { stream: simulateReadableStream({ chunks: toStreamParts(result) }) }
    },
  })
}

export function createScriptedAdapter(): LlmProvider {
  const envKeys = ['OM_AI_PROVIDER'] as const
  return {
    id: SCRIPTED_PROVIDER_ID,
    name: 'Scripted (fixtures)',
    envKeys,
    defaultModel: DEFAULT_MODEL,
    defaultModels: DEFAULT_MODELS,

    isConfigured(env?: EnvLookup): boolean {
      return isScriptedLlmProviderEnabled(env ?? process.env)
    },

    resolveApiKey(env?: EnvLookup): string | null {
      return isScriptedLlmProviderEnabled(env ?? process.env) ? SCRIPTED_PROVIDER_ID : null
    },

    getConfiguredEnvKey(): string {
      return envKeys[0]
    },

    createModel(createOptions: LlmCreateModelOptions): unknown {
      if (!isScriptedLlmProviderEnabled(process.env)) {
        throw new Error('[internal] the scripted LLM provider is disabled in this environment')
      }
      return createScriptedLanguageModel({ modelId: createOptions.modelId })
    },
  }
}
