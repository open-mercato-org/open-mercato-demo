/** @jest-environment node */
import { evaluateRerunGuard, RERUN_SUPERSEDE_REASON } from '../lib/processes/rerunGuard'
import {
  getCitationResolver,
  listCitationResolverKinds,
  registerCitationResolver,
  resolveCitation,
} from '../components/citationResolvers'
import {
  buildDisposeBody,
  collectLongTextFields,
  countChangedFields,
  highlightTemplateSegments,
  isEditableWidget,
  maskValue,
  resolveFieldOverride,
} from '../components/decisionCardModel'
import { buildFlowTree, compareFlows, nodesVisibleAt, playbackDelays, type FlowNodeView, type FlowView } from '../components/flowTraceModel'
import { deriveActionEdits } from '../components/proposalEdit'

const OK_GUARD = {
  hasProcessDefinition: true,
  manualTriggerDeclared: true,
  manualTriggerFeaturesGranted: true,
  pendingProposalIds: [] as string[],
  supersede: false,
  canDisposeProposals: false,
}

describe('evaluateRerunGuard', () => {
  it('allows a re-run with nothing pending', () => {
    expect(evaluateRerunGuard(OK_GUARD)).toEqual({ allowed: true, supersedeProposalIds: [] })
  })

  it('refuses without a definition, a manual trigger or its features', () => {
    expect(evaluateRerunGuard({ ...OK_GUARD, hasProcessDefinition: false })).toMatchObject({ allowed: false, status: 422 })
    expect(evaluateRerunGuard({ ...OK_GUARD, manualTriggerDeclared: false })).toMatchObject({ status: 403, code: 'no_manual_trigger' })
    expect(evaluateRerunGuard({ ...OK_GUARD, manualTriggerFeaturesGranted: false })).toMatchObject({ status: 403, code: 'missing_trigger_features' })
  })

  it('returns 409 pending_proposal unless supersede, and supersede needs the dispose feature', () => {
    const pending = { ...OK_GUARD, pendingProposalIds: ['p1'] }
    expect(evaluateRerunGuard(pending)).toEqual({ allowed: false, status: 409, code: 'pending_proposal', pendingProposalIds: ['p1'] })
    expect(evaluateRerunGuard({ ...pending, supersede: true })).toMatchObject({ status: 403, code: 'missing_dispose_feature' })
    expect(evaluateRerunGuard({ ...pending, supersede: true, canDisposeProposals: true })).toEqual({
      allowed: true,
      supersedeProposalIds: ['p1'],
    })
    expect(RERUN_SUPERSEDE_REASON).toBe('superseded_by_rerun')
  })
})

describe('citation resolver registry', () => {
  it('falls back to the label and href for an unknown kind', async () => {
    await expect(resolveCitation({ kind: 'nope', ref: 'r@1', label: 'Label', href: '/x' })).resolves.toEqual({ title: 'Label', href: '/x' })
    await expect(resolveCitation({ kind: 'nope', ref: 'r@1' })).resolves.toEqual({ title: 'r@1', href: null })
  })

  it('resolves through the registered resolver, last registration wins, unregister restores the fallback', async () => {
    const first = registerCitationResolver('kb', () => ({ title: 'First' }))
    const unregister = registerCitationResolver('kb', async (citation) => ({
      title: `Article ${citation.ref}`,
      href: '/backend/kb/1',
      steps: [{ id: 'S1', text: 'Confirm the payment' }],
    }))
    expect(listCitationResolverKinds()).toContain('kb')
    await expect(resolveCitation({ kind: 'kb', ref: 'a@3' })).resolves.toEqual({
      title: 'Article a@3',
      href: '/backend/kb/1',
      steps: [{ id: 'S1', text: 'Confirm the payment' }],
    })
    first()
    expect(getCitationResolver('kb')).toBeDefined()
    unregister()
    expect(getCitationResolver('kb')).toBeUndefined()
  })

  it('degrades to the fallback when a resolver throws or returns null', async () => {
    const off = registerCitationResolver('boom', () => {
      throw new Error('[internal] down')
    })
    await expect(resolveCitation({ kind: 'boom', ref: 'x', label: 'X' })).resolves.toEqual({ title: 'X', href: null })
    off()
    const offNull = registerCitationResolver('none', () => null)
    await expect(resolveCitation({ kind: 'none', ref: 'y' })).resolves.toEqual({ title: 'y', href: null })
    offNull()
  })
})

const ENVELOPE = {
  options: [
    {
      id: 'refund',
      label: 'Refund',
      actions: [
        { type: 'reservations.refund.request', payload: { amount: 350, iban: 'PL61109010140000071219812874', note: { a: 1 } } },
        { type: 'tickets.ticket.reply', payload: { body: 'Hello.\nWe refund 350.' }, citations: ['kb@3#S5'] },
      ],
    },
  ],
  evidence: { segments: [{ source: 'template' as const, text: 'We refund 350.' }] },
}

describe('decision card dispose body', () => {
  it('approve names the option and never needs a reason', () => {
    expect(buildDisposeBody('approved', { selectedOptionId: 'refund' })).toEqual({
      ok: true,
      body: { disposition: 'approved', selectedOptionId: 'refund' },
    })
    expect(buildDisposeBody('approved', { selectedOptionId: null })).toEqual({ ok: false, error: 'option' })
  })

  it('reject needs a reason and never names an option', () => {
    expect(buildDisposeBody('rejected', { selectedOptionId: 'refund', reason: '  ' })).toEqual({ ok: false, error: 'reason' })
    expect(buildDisposeBody('rejected', { selectedOptionId: 'refund', reason: ' wrong ' })).toEqual({
      ok: true,
      body: { disposition: 'rejected', reason: 'wrong' },
    })
  })

  it('edit sends the full payload, the option and the reason', () => {
    expect(buildDisposeBody('edited', { selectedOptionId: 'refund', payload: ENVELOPE, reason: '' })).toEqual({ ok: false, error: 'reason' })
    expect(buildDisposeBody('edited', { selectedOptionId: 'refund', payload: null, reason: 'fix' })).toEqual({ ok: false, error: 'payload' })
    expect(buildDisposeBody('edited', { selectedOptionId: 'refund', payload: ENVELOPE, reason: 'fix' })).toEqual({
      ok: true,
      body: { disposition: 'edited', selectedOptionId: 'refund', payload: ENVELOPE, reason: 'fix' },
    })
  })
})

describe('decision card fields', () => {
  const schema = {
    type: 'object',
    properties: {
      options: {
        type: 'array',
        items: {
          properties: {
            actions: {
              type: 'array',
              items: {
                anyOf: [
                  {
                    type: 'object',
                    properties: {
                      type: { type: 'string', enum: ['tickets.ticket.reply'] },
                      payload: { type: 'object', properties: { body: { type: 'string', description: 'format:long_text' } } },
                    },
                  },
                  {
                    type: 'object',
                    properties: {
                      type: { type: 'string' },
                      payload: { type: 'object', properties: { memo: { type: 'string', description: 'Memo. format:long_text' } } },
                    },
                  },
                ],
              },
            },
          },
        },
      },
    },
  }

  it('collects long-text fields marked by .describe("format:long_text")', () => {
    expect(Array.from(collectLongTextFields(schema)).sort()).toEqual(['*.memo', 'tickets.ticket.reply.body'])
    expect(collectLongTextFields(undefined).size).toBe(0)
  })

  it('prefers explicit overrides, then wildcard overrides, then the schema', () => {
    const fromSchema = collectLongTextFields(schema)
    expect(resolveFieldOverride('tickets.ticket.reply', 'body', undefined, fromSchema)).toEqual({ widget: 'long_text' })
    expect(resolveFieldOverride('x', 'iban', { '*.iban': { widget: 'masked', revealable: true } }, fromSchema)).toEqual({
      widget: 'masked',
      revealable: true,
    })
    expect(
      resolveFieldOverride('tickets.ticket.reply', 'body', { 'tickets.ticket.reply.body': { widget: 'readonly' } }, fromSchema),
    ).toEqual({ widget: 'readonly' })
    expect(resolveFieldOverride('x', 'amount', undefined, fromSchema)).toBeNull()
  })

  it('keeps masked and read-only fields out of the editor', () => {
    const field = { key: 'iban', kind: 'string' as const, value: 'PL61' }
    expect(isEditableWidget({ widget: 'masked' }, field)).toBe(false)
    expect(isEditableWidget({ widget: 'readonly' }, field)).toBe(false)
    expect(isEditableWidget({ widget: 'long_text' }, field)).toBe(true)
    expect(isEditableWidget(null, field)).toBe(true)
    expect(maskValue('PL61109010140000071219812874')).toBe('••••••••••••2874')
    expect(maskValue('abc')).toBe('•••')
  })

  it('derives editable fields for the selected option, preserving nested values and citations', () => {
    const edits = deriveActionEdits(ENVELOPE, 'refund')
    expect(edits?.[0].fields.map((field) => field.key)).toEqual(['amount', 'iban'])
    expect(edits?.[0].preserved).toEqual({ note: { a: 1 } })
    expect(edits?.[1].citations).toEqual(['kb@3#S5'])
    const changed = edits!.map((edit, index) =>
      index === 1 ? { ...edit, fields: edit.fields.map((field) => ({ ...field, value: 'Rewritten' })) } : edit,
    )
    expect(countChangedFields(edits!, changed)).toBe(1)
  })

  it('highlights template segments that still appear verbatim', () => {
    expect(highlightTemplateSegments('Hello.\nWe refund 350.', ENVELOPE.evidence.segments)).toEqual([
      { text: 'Hello.\n', source: 'plain' },
      { text: 'We refund 350.', source: 'template' },
    ])
    expect(highlightTemplateSegments('Hello. We refund 300.', ENVELOPE.evidence.segments)).toEqual([
      { text: 'Hello. We refund 300.', source: 'plain' },
    ])
    expect(highlightTemplateSegments('', ENVELOPE.evidence.segments)).toEqual([])
  })
})

function node(partial: Partial<FlowNodeView> & Pick<FlowNodeView, 'id' | 'seq' | 'kind'>): FlowNodeView {
  return {
    parentId: null,
    label: partial.id,
    status: 'succeeded',
    startedAt: null,
    endedAt: null,
    durationMs: null,
    refs: {},
    summary: {},
    ...partial,
  }
}

function flowOf(nodes: FlowNodeView[]): FlowView {
  return {
    execution: {
      id: 'e',
      workflowInstanceId: null,
      processDefinitionId: null,
      processKey: null,
      status: 'completed',
      subject: { type: null, id: null, label: null },
      startedAt: null,
      endedAt: null,
      rerunOfExecutionId: null,
    },
    nodes,
  }
}

describe('flow trace model', () => {
  const nodes = [
    node({ id: 'step:1', seq: 2, kind: 'step', label: 'advisor', startedAt: '2026-10-12T10:00:01.000Z' }),
    node({ id: 'trigger', seq: 1, kind: 'trigger', startedAt: '2026-10-12T10:00:00.000Z' }),
    node({ id: 'run:1', seq: 3, kind: 'agent_run', parentId: 'step:1', label: 'advisor_agent', startedAt: '2026-10-12T11:00:00.000Z', refs: { runId: 'r1' }, summary: { outputFacts: { 'proposal.citation': 'kb@3', same: 1 } } }),
    node({ id: 'tool:1', seq: 4, kind: 'tool_call', parentId: 'run:1', startedAt: '2026-10-12T11:00:00.100Z' }),
  ]

  it('nests by parent in seq order and promotes orphans to roots', () => {
    const tree = buildFlowTree(nodes)
    expect(tree.map((entry) => entry.id)).toEqual(['trigger', 'step:1'])
    expect(tree[1].children[0].children[0].id).toBe('tool:1')
    expect(buildFlowTree(nodesVisibleAt(nodes, 1)).map((entry) => entry.id)).toEqual(['trigger'])
  })

  it('compresses recorded gaps into bounded delays and scales by speed', () => {
    const delays = playbackDelays(nodes, { minDelayMs: 200, maxDelayMs: 1000 })
    expect(delays).toHaveLength(4)
    expect(delays[0]).toBe(200)
    expect(delays[2]).toBe(1000)
    expect(Math.max(...delays)).toBeLessThanOrEqual(1000)
    expect(playbackDelays(nodes, { minDelayMs: 200, maxDelayMs: 1000, speed: 2 })[2]).toBe(500)
  })

  it('compares two attempts by route, per-agent output and proposal evidence', () => {
    const left = flowOf([
      ...nodes,
      node({ id: 'disp', seq: 5, kind: 'disposition', summary: { decision: 'approved', proposal: { actionTypes: ['a'], citations: [{ kind: 'kb', ref: 'kb@3', label: null }], checks: [] } } }),
    ])
    const right = flowOf([
      node({ id: 'step:2', seq: 1, kind: 'step', label: 'advisor' }),
      node({ id: 'step:3', seq: 2, kind: 'step', label: 'apply' }),
      node({ id: 'run:2', seq: 3, kind: 'agent_run', label: 'advisor_agent', refs: { runId: 'r2' }, summary: { outputFacts: { 'proposal.citation': 'kb@4', same: 1, extra: true } } }),
      node({ id: 'disp2', seq: 4, kind: 'disposition', summary: { decision: 'pending', proposal: { actionTypes: ['a', 'b'], citations: [{ kind: 'kb', ref: 'kb@4', label: 'v4' }], checks: [{ key: 'new_check', passed: true, step: 'S6' }] } } }),
    ])
    const compare = compareFlows(left, right)
    expect(compare.route).toEqual({ left: ['advisor'], right: ['advisor', 'apply'] })
    expect(compare.agents).toEqual([
      {
        agentId: 'advisor_agent',
        leftRunId: 'r1',
        rightRunId: 'r2',
        diffs: [
          { path: 'extra', left: undefined, right: true },
          { path: 'proposal.citation', left: 'kb@3', right: 'kb@4' },
        ],
      },
    ])
    expect(compare.proposals.right).toEqual({
      actionTypes: ['a', 'b'],
      citations: [{ kind: 'kb', ref: 'kb@4', label: 'v4' }],
      checks: [{ key: 'new_check', passed: true, step: 'S6' }],
      decision: 'pending',
    })
    expect(compare.proposals.left?.citations[0].ref).toBe('kb@3')
  })
})
