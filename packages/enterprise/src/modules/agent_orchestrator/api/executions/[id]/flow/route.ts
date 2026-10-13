import { NextResponse } from 'next/server'
import type { EntityManager } from '@mikro-orm/postgresql'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { getAuthFromRequest } from '@open-mercato/shared/lib/auth/server'
import { createRequestContainer } from '@open-mercato/shared/lib/di/container'
import { findExecutionForFlow, loadProcessFlow } from '../../../../lib/trace/flowLoader'

/**
 * The Process Flow Trace of one execution: trigger → workflow steps → agent runs
 * (with their tool calls) → dispositions → effector results, as ONE ordered node
 * list assembled on read from records that already exist.
 *
 * Summaries are redacted by construction (tool name + argument keys + result
 * size, never a value); full payloads stay behind `GET /runs/:id`. `:id` accepts
 * the execution id or the workflow instance id. Org-scoped — a cross-org id is a
 * 404, never the row.
 */
export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['agent_orchestrator.trace.view'] },
}

const idSchema = z.string().uuid()
const errorSchema = z.object({ error: z.string() })

const flowNodeSchema = z.object({
  id: z.string(),
  seq: z.number().int(),
  kind: z.enum(['trigger', 'step', 'agent_run', 'tool_call', 'function', 'disposition', 'effector']),
  parentId: z.string().nullable(),
  label: z.string(),
  status: z.enum(['pending', 'running', 'succeeded', 'failed', 'skipped', 'waiting']),
  startedAt: z.string().nullable(),
  endedAt: z.string().nullable(),
  durationMs: z.number().nullable(),
  refs: z.object({
    workflowStepId: z.string().optional(),
    runId: z.string().optional(),
    spanId: z.string().optional(),
    toolCallId: z.string().optional(),
    proposalId: z.string().optional(),
    commandId: z.string().optional(),
  }),
  summary: z.record(z.string(), z.unknown()),
})

const flowResponseSchema = z.object({
  execution: z.object({
    id: z.string().uuid(),
    workflowInstanceId: z.string().uuid().nullable(),
    processDefinitionId: z.string().uuid().nullable(),
    processKey: z.string().nullable(),
    status: z.string(),
    subject: z.object({ type: z.string().nullable(), id: z.string().nullable(), label: z.string().nullable() }),
    startedAt: z.string().nullable(),
    endedAt: z.string().nullable(),
    rerunOfExecutionId: z.string().uuid().nullable(),
  }),
  nodes: z.array(flowNodeSchema),
})

type RouteContext = { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: RouteContext) {
  const auth = await getAuthFromRequest(req)
  if (!auth?.tenantId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await ctx.params
  const parsedId = idSchema.safeParse(id)
  if (!parsedId.success) return NextResponse.json({ error: 'Execution not found' }, { status: 404 })

  const container = await createRequestContainer()
  const em = (container.resolve('em') as EntityManager).fork()
  const execution = await findExecutionForFlow(em, parsedId.data, {
    tenantId: auth.tenantId,
    organizationId: auth.orgId ?? null,
  })
  if (!execution) return NextResponse.json({ error: 'Execution not found' }, { status: 404 })

  const flow = await loadProcessFlow(em, execution)
  return NextResponse.json(flow)
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Agent Orchestrator',
  summary: 'Get the process flow trace of one execution',
  methods: {
    GET: {
      summary: 'Get the end-to-end flow of a process execution',
      description:
        'Returns one ordered list of flow nodes (trigger, workflow steps, agent runs, tool calls, workflow functions, dispositions, effector results) assembled on read from the workflow history, agent runs, spans, tool calls and proposals. Summaries are redacted: a tool call carries its name, argument keys and result size only. Accepts the execution id or the workflow instance id. Org-scoped; gated by agent_orchestrator.trace.view.',
      responses: [{ status: 200, description: 'Process flow', schema: flowResponseSchema }],
      errors: [
        { status: 401, description: 'Unauthorized', schema: errorSchema },
        { status: 403, description: 'Missing agent_orchestrator.trace.view', schema: errorSchema },
        { status: 404, description: 'Unknown execution id (or cross-tenant)', schema: errorSchema },
      ],
    },
  },
}
