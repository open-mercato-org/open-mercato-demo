import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { generateObject, generateText, Output, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import { llmProviderRegistry } from '@open-mercato/shared/lib/ai/llm-provider-registry'
import {
  SCRIPTED_DEFAULT_AGENT_ID,
  SCRIPTED_FIXTURE_MISSING,
  ScriptedLlmFixtureError,
  clearScriptedLlmFixtureDirsForTests,
  createScriptedAdapter,
  createScriptedLanguageModel,
  isScriptedLlmProviderEnabled,
  listScriptedLlmFixtureDirs,
  registerScriptedLlmFixtureDirs,
} from '../llm-adapters/scripted'
import { withScriptedLlmContext } from '../llm-adapters/scripted-context'
import { registerBuiltInLlmProviders, resetLlmBootstrapState } from '../llm-bootstrap'

const AGENT_ID = 'triage.identifier'
const INPUT_KEY = 'a'.repeat(64)
const resultSchema = z.object({ verdict: z.string(), reservation: z.string().nullable() })

let fixturesRoot: string

function writeFixture(agentId: string, inputKey: string, body: unknown): void {
  const dir = path.join(fixturesRoot, agentId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, `${inputKey}.json`), JSON.stringify(body))
}

beforeEach(() => {
  fixturesRoot = mkdtempSync(path.join(tmpdir(), 'scripted-llm-'))
  clearScriptedLlmFixtureDirsForTests()
  registerScriptedLlmFixtureDirs([fixturesRoot])
})

afterEach(() => {
  rmSync(fixturesRoot, { recursive: true, force: true })
})

describe('scripted LLM provider — activation guard', () => {
  it('is enabled only when OM_AI_PROVIDER names it', () => {
    expect(isScriptedLlmProviderEnabled({ OM_AI_PROVIDER: 'scripted', NODE_ENV: 'test' })).toBe(true)
    expect(isScriptedLlmProviderEnabled({ OM_AI_PROVIDER: 'openai', NODE_ENV: 'test' })).toBe(false)
    expect(isScriptedLlmProviderEnabled({ NODE_ENV: 'development' })).toBe(false)
  })

  it('refuses production unless OM_AI_SCRIPTED_ALLOW=1', () => {
    expect(isScriptedLlmProviderEnabled({ OM_AI_PROVIDER: 'scripted', NODE_ENV: 'production' })).toBe(false)
    expect(
      isScriptedLlmProviderEnabled({ OM_AI_PROVIDER: 'scripted', NODE_ENV: 'production', OM_AI_SCRIPTED_ALLOW: '1' }),
    ).toBe(true)
    const adapter = createScriptedAdapter()
    expect(adapter.isConfigured({ OM_AI_PROVIDER: 'scripted', NODE_ENV: 'production' })).toBe(false)
    expect(adapter.resolveApiKey({ OM_AI_PROVIDER: 'scripted', NODE_ENV: 'production' })).toBeNull()
  })

  it('createModel refuses to build a model while disabled', () => {
    const previous = process.env.OM_AI_PROVIDER
    delete process.env.OM_AI_PROVIDER
    try {
      expect(() => createScriptedAdapter().createModel({ modelId: 'scripted', apiKey: 'scripted' })).toThrow('disabled')
    } finally {
      if (previous !== undefined) process.env.OM_AI_PROVIDER = previous
    }
  })

  it('is registered by the bootstrap only when selected', () => {
    const previous = process.env.OM_AI_PROVIDER
    try {
      delete process.env.OM_AI_PROVIDER
      llmProviderRegistry.reset()
      resetLlmBootstrapState()
      registerBuiltInLlmProviders()
      expect(llmProviderRegistry.get('scripted')).toBeNull()

      process.env.OM_AI_PROVIDER = 'scripted'
      llmProviderRegistry.reset()
      resetLlmBootstrapState()
      registerBuiltInLlmProviders()
      expect(llmProviderRegistry.get('scripted')).not.toBeNull()
      expect(llmProviderRegistry.resolveFirstConfigured({ order: ['scripted'] })?.id).toBe('scripted')
    } finally {
      if (previous === undefined) delete process.env.OM_AI_PROVIDER
      else process.env.OM_AI_PROVIDER = previous
      llmProviderRegistry.reset()
      resetLlmBootstrapState()
    }
  })

  it('reads fixture roots from OM_AI_SCRIPTED_FIXTURES_DIR and the registration API', () => {
    const fromEnv = path.join(fixturesRoot, 'env-root')
    const dirs = listScriptedLlmFixtureDirs({ OM_AI_SCRIPTED_FIXTURES_DIR: fromEnv })
    expect(dirs).toEqual([path.resolve(fromEnv), path.resolve(fixturesRoot)])
  })
})

describe('scripted LLM provider — replay', () => {
  it('answers a structured call from the fixture keyed by agent id and input key', async () => {
    writeFixture(AGENT_ID, INPUT_KEY, { object: { verdict: 'single_reservation', reservation: 'BK-1001' } })

    const result = await withScriptedLlmContext({ agentId: AGENT_ID, inputKey: INPUT_KEY }, () =>
      generateObject({ model: createScriptedLanguageModel(), schema: resultSchema, prompt: 'identify' }),
    )

    expect(result.object).toEqual({ verdict: 'single_reservation', reservation: 'BK-1001' })
  })

  it('scripts tool calls before the final object, executing the real tools', async () => {
    writeFixture(AGENT_ID, INPUT_KEY, {
      steps: [
        { toolCalls: [{ toolName: 'reservations.lookup', input: { number: 'BK-1001' } }] },
        { toolCalls: [{ toolName: 'tickets.get_ticket', input: { id: 'T-1' } }] },
      ],
      object: { verdict: 'single_reservation', reservation: 'BK-1001' },
      usage: { inputTokens: 12, outputTokens: 3 },
    })
    const lookups: unknown[] = []
    const tools = {
      reservations__lookup: tool({
        description: 'lookup',
        inputSchema: z.object({ number: z.string() }),
        execute: async (input) => {
          lookups.push(input)
          return { found: true }
        },
      }),
      tickets__get_ticket: tool({
        description: 'ticket',
        inputSchema: z.object({ id: z.string() }),
        execute: async (input) => {
          lookups.push(input)
          return { subject: 'Refund' }
        },
      }),
    }

    const result = await withScriptedLlmContext({ agentId: AGENT_ID, inputKey: INPUT_KEY }, () =>
      generateText({
        model: createScriptedLanguageModel(),
        tools,
        stopWhen: stepCountIs(5),
        output: Output.object({ schema: resultSchema }),
        prompt: 'identify',
      }),
    )

    expect(lookups).toEqual([{ number: 'BK-1001' }, { id: 'T-1' }])
    expect(result.steps).toHaveLength(3)
    expect(result.steps[0].toolCalls.map((call) => call.toolName)).toEqual(['reservations__lookup'])
    expect(result.steps[1].toolCalls.map((call) => call.toolName)).toEqual(['tickets__get_ticket'])
    expect(result.output).toEqual({ verdict: 'single_reservation', reservation: 'BK-1001' })
  })

  it('streams the same answer', async () => {
    writeFixture(AGENT_ID, INPUT_KEY, { text: 'scripted reply' })
    const model = createScriptedLanguageModel()
    const stream = await withScriptedLlmContext({ agentId: AGENT_ID, inputKey: INPUT_KEY }, () =>
      model.doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
    )
    const parts: Array<{ type: string; delta?: string }> = []
    const reader = stream.stream.getReader()
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      parts.push(next.value as { type: string; delta?: string })
    }
    expect(parts.filter((part) => part.type === 'text-delta').map((part) => part.delta).join('')).toBe('scripted reply')
    expect(parts[parts.length - 1].type).toBe('finish')
  })

  it('a missing fixture is a deterministic scripted_fixture_missing error, never a fallback', async () => {
    const run = () =>
      withScriptedLlmContext({ agentId: AGENT_ID, inputKey: 'b'.repeat(64) }, () =>
        generateObject({ model: createScriptedLanguageModel(), schema: resultSchema, prompt: 'identify' }),
      )

    await expect(run()).rejects.toThrow(SCRIPTED_FIXTURE_MISSING)
    await expect(run()).rejects.toBeInstanceOf(ScriptedLlmFixtureError)
  })

  it('without a caller binding falls back to the _default agent keyed by the prompt hash', async () => {
    const model = createScriptedLanguageModel()
    const call = model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] })
    await expect(call).rejects.toMatchObject({ code: SCRIPTED_FIXTURE_MISSING, agentId: SCRIPTED_DEFAULT_AGENT_ID })
  })

  it('rejects path traversal in the agent id', async () => {
    const model = createScriptedLanguageModel()
    const call = withScriptedLlmContext({ agentId: '../etc', inputKey: INPUT_KEY }, () =>
      model.doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'x' }] }] }),
    )
    await expect(call).rejects.toMatchObject({ code: SCRIPTED_FIXTURE_MISSING })
  })
})
