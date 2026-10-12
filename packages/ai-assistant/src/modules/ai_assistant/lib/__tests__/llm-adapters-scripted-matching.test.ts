import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { generateObject, generateText, Output, stepCountIs, tool } from 'ai'
import { z } from 'zod'
import {
  SCRIPTED_FIXTURE_INVALID,
  SCRIPTED_FIXTURE_MISSING,
  clearScriptedLlmFixtureDirsForTests,
  createScriptedLanguageModel,
  registerScriptedLlmFixtureDirs,
} from '../llm-adapters/scripted'
import { withScriptedLlmContext } from '../llm-adapters/scripted-context'
import {
  collectScriptedToolResults,
  evaluateScriptedMatch,
  renderScriptedTemplate,
  resolveScriptedPath,
} from '../llm-adapters/scripted-matching'

let fixturesRoot: string

function writeFixture(agentId: string, fileName: string, body: unknown): void {
  const dir = path.join(fixturesRoot, agentId)
  mkdirSync(dir, { recursive: true })
  writeFileSync(path.join(dir, fileName), typeof body === 'string' ? body : JSON.stringify(body))
}

beforeEach(() => {
  fixturesRoot = mkdtempSync(path.join(tmpdir(), 'scripted-match-'))
  clearScriptedLlmFixtureDirsForTests()
  registerScriptedLlmFixtureDirs([fixturesRoot])
})

afterEach(() => {
  rmSync(fixturesRoot, { recursive: true, force: true })
})

const AGENT_ID = 'triage.match'
const INPUT_KEY = 'c'.repeat(64)
const identifySchema = z.object({
  ticketId: z.string(),
  reservationId: z.string().nullable(),
  days: z.number().nullable(),
  label: z.string(),
})

function ticketTool(subject: string, calls: unknown[]) {
  return tool({
    description: 'ticket',
    inputSchema: z.object({ ticketId: z.string() }),
    execute: async (input) => {
      calls.push(input)
      return JSON.stringify({ found: true, ticket: { id: input.ticketId, subject, requesterEmail: 'anna@example.com' } })
    },
  })
}

function lookupTool(calls: unknown[]) {
  return tool({
    description: 'lookup',
    inputSchema: z.object({ bookingNumber: z.string(), senderEmail: z.string() }),
    execute: async (input) => {
      calls.push(input)
      return { found: true, ownerMatch: 'match', reservation: { id: 'res-1', daysToDeparture: 3 } }
    },
  })
}

async function runIdentify(subject: string) {
  const calls: unknown[] = []
  const result = await withScriptedLlmContext({ agentId: AGENT_ID, inputKey: INPUT_KEY, input: { ticketId: 'T-42' } }, () =>
    generateText({
      model: createScriptedLanguageModel(),
      tools: { tickets__get_ticket: ticketTool(subject, calls), reservations__find_by_booking_number: lookupTool(calls) },
      stopWhen: stepCountIs(6),
      output: Output.object({ schema: identifySchema }),
      prompt: 'identify',
    }),
  )
  return { calls, result }
}

describe('scripted LLM provider — match fixtures and templates', () => {
  beforeEach(() => {
    writeFixture(AGENT_ID, '10-refund.match.json', {
      match: { 'input.ticketId': { exists: true }, 'tools.tickets.get_ticket.ticket.subject': { contains: 'refund' } },
      steps: [
        { toolCalls: [{ toolName: 'tickets.get_ticket', input: { ticketId: '{{input.ticketId}}' } }] },
        {
          toolCalls: [
            {
              toolName: 'reservations.find_by_booking_number',
              input: {
                bookingNumber: '{{tools.tickets.get_ticket.ticket.subject | match:\\b([A-Z]{3}[0-9]{3})\\b}}',
                senderEmail: '{{tools.tickets.get_ticket.ticket.requesterEmail}}',
              },
            },
          ],
        },
      ],
      object: {
        ticketId: '{{input.ticketId}}',
        reservationId: '{{tools.reservations.find_by_booking_number.reservation.id}}',
        days: '{{tools.reservations.find_by_booking_number.reservation.daysToDeparture}}',
        label: 'Ticket {{input.ticketId}} → {{tools.reservations.find_by_booking_number.reservation.id | upper}}',
      },
    })
    writeFixture(AGENT_ID, '90-fallback.match.json', {
      match: { 'tools.tickets.get_ticket.found': true },
      steps: [{ toolCalls: [{ toolName: 'tickets.get_ticket', input: { ticketId: '{{input.ticketId}}' } }] }],
      object: { ticketId: '{{input.ticketId}}', reservationId: null, days: null, label: 'unknown' },
    })
  })

  it('selects a match fixture by tool results and renders typed templates', async () => {
    const { calls, result } = await runIdentify('Please refund booking ABC123')
    expect(calls).toEqual([{ ticketId: 'T-42' }, { bookingNumber: 'ABC123', senderEmail: 'anna@example.com' }])
    expect(result.output).toEqual({ ticketId: 'T-42', reservationId: 'res-1', days: 3, label: 'Ticket T-42 → RES-1' })
  })

  it('falls through to the next fixture once a deferred condition fails', async () => {
    const { calls, result } = await runIdentify('Quiet room please')
    expect(calls).toEqual([{ ticketId: 'T-42' }])
    expect(result.output).toEqual({ ticketId: 'T-42', reservationId: null, days: null, label: 'unknown' })
  })

  it('prefers an exact fixture and still renders its templates', async () => {
    writeFixture(AGENT_ID, `${INPUT_KEY}.json`, { object: { ticketId: '{{input.ticketId}}', reservationId: null, days: 1, label: 'exact' } })
    const { result } = await runIdentify('Please refund booking ABC123')
    expect(result.output).toEqual({ ticketId: 'T-42', reservationId: null, days: 1, label: 'exact' })
  })

  it('reports scripted_fixture_missing when no match fixture accepts the run', async () => {
    const run = withScriptedLlmContext({ agentId: AGENT_ID, inputKey: 'd'.repeat(64), input: {} }, () =>
      generateObject({ model: createScriptedLanguageModel(), schema: identifySchema, prompt: '{}' }),
    )
    await expect(run).rejects.toMatchObject({ code: SCRIPTED_FIXTURE_MISSING })
  })

  it('reports scripted_fixture_invalid for a match fixture without rules', async () => {
    writeFixture('triage.broken', '10-broken.match.json', { object: { ok: true } })
    const run = withScriptedLlmContext({ agentId: 'triage.broken', inputKey: 'f'.repeat(64), input: {} }, () =>
      generateObject({ model: createScriptedLanguageModel(), schema: z.object({ ok: z.boolean() }), prompt: '{}' }),
    )
    await expect(run).rejects.toMatchObject({ code: SCRIPTED_FIXTURE_INVALID })
  })

  it('reads the input from the last user message when the binding carries none', async () => {
    writeFixture('triage.text', '10-any.match.json', {
      match: { 'input.ticketId': 'T-7' },
      object: { ticketId: '{{input.ticketId}}', reservationId: null, days: null, label: '{{input.ticketId | lower}}' },
    })
    const result = await withScriptedLlmContext({ agentId: 'triage.text', inputKey: 'e'.repeat(64) }, () =>
      generateObject({ model: createScriptedLanguageModel(), schema: identifySchema, prompt: JSON.stringify({ ticketId: 'T-7' }) }),
    )
    expect(result.object).toEqual({ ticketId: 'T-7', reservationId: null, days: null, label: 't-7' })
  })
})

describe('scripted matching helpers', () => {
  const scope = {
    input: { ticketId: 'T-1', amount: '350.00', tags: ['a', 'b'] },
    tools: { 'reservations.get_details': [{ balance: { overpayment: 100 } }, { balance: { overpayment: 350 } }] },
  }

  it('resolves tool call indexes and defaults to the latest call', () => {
    expect(resolveScriptedPath('tools.reservations.get_details.balance.overpayment', scope)).toEqual({ status: 'found', value: 350 })
    expect(resolveScriptedPath('tools.reservations.get_details.0.balance.overpayment', scope)).toEqual({ status: 'found', value: 100 })
    expect(resolveScriptedPath('tools.knowledge_articles.get_article.version', scope)).toEqual({ status: 'deferred' })
    expect(resolveScriptedPath('input.tags[1]', scope)).toEqual({ status: 'found', value: 'b' })
    expect(resolveScriptedPath('input.missing', scope)).toEqual({ status: 'missing' })
  })

  it('evaluates matcher operators', () => {
    expect(evaluateScriptedMatch({ 'input.amount': { gte: 300, lt: 400 } }, scope, { final: true })).toBe(true)
    expect(evaluateScriptedMatch({ 'input.amount': { in: ['350.00', '1'] } }, scope, { final: true })).toBe(true)
    expect(evaluateScriptedMatch({ 'input.ticketId': { matches: '^T-\\d+$' } }, scope, { final: true })).toBe(true)
    expect(evaluateScriptedMatch({ 'input.ticketId': { not: 'T-1' } }, scope, { final: true })).toBe(false)
    expect(evaluateScriptedMatch({ 'input.missing': { exists: false } }, scope, { final: true })).toBe(true)
    expect(evaluateScriptedMatch({ 'tools.knowledge_articles.get_article.found': true }, scope, { final: false })).toBe(true)
    expect(evaluateScriptedMatch({ 'tools.knowledge_articles.get_article.found': true }, scope, { final: true })).toBe(false)
  })

  it('keeps whole-placeholder types and applies filters', () => {
    expect(renderScriptedTemplate({ amount: '{{input.amount | number}}', fallback: '{{input.none | default:"n/a"}}' }, scope)).toEqual({
      amount: 350,
      fallback: 'n/a',
    })
    expect(renderScriptedTemplate('{{input.ticketId}}, {{input.tags[0]}}', scope)).toBe('T-1, a')
    expect(renderScriptedTemplate('{{input.ticketId | match:^T-([0-9]{1,3})$}}', scope)).toBe('1')
  })

  it('collects tool results from text, json and content outputs', () => {
    const results = collectScriptedToolResults([
      { role: 'tool', content: [{ type: 'tool-result', toolName: 'a__b', output: { type: 'text', value: '{"x":1}' } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolName: 'a.b', output: { type: 'json', value: { x: 2 } } }] },
      { role: 'tool', content: [{ type: 'tool-result', toolName: 'c', output: { type: 'content', value: [{ type: 'text', text: '[1]' }] } }] },
    ])
    expect(results).toEqual({ 'a.b': [{ x: 1 }, { x: 2 }], c: [[1]] })
  })
})
