import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { isScriptedLlmProviderEnabled } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/llm-adapters/scripted'
import { ensureTriageProcess } from '../../lib/processSeed'
import { resolveTriageRouteContext, triageRouteErrorResponse } from '../../lib/routeContext'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['triage_agents.manage'] },
}

const responseSchema = z.object({
  workflowDefinitionId: z.string().uuid().nullable(),
  processDefinitionId: z.string().uuid().nullable(),
  processCreated: z.boolean(),
  enabledCommands: z.array(z.string()).nullable(),
  scriptedProviderActive: z.boolean(),
})

export async function POST(req: Request) {
  try {
    const context = await resolveTriageRouteContext(req)
    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: { userId: context.userId, tenantId: context.scope.tenantId, organizationId: context.scope.organizationId },
      input: {
        resourceKind: 'triage_agents.process',
        resourceId: null,
        operation: 'custom',
        mutationPayload: {},
      },
    })
    if (!guarded.ok) return guarded.response
    const em = context.container.resolve<EntityManager>('em').fork()
    const result = await ensureTriageProcess(context.container, em, context.scope, { actorUserId: context.userId })
    await guarded.runAfterSuccess()
    return NextResponse.json({ ...result, scriptedProviderActive: isScriptedLlmProviderEnabled(process.env) })
  } catch (err) {
    return triageRouteErrorResponse(err, 'setup')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Triage Agents',
  summary: 'Set up the ticket triage process',
  methods: {
    POST: {
      summary: 'Create or refresh the triage workflow and process definition for the current organization',
      description:
        'Idempotent. Writes the owned triage workflow definition (with its execution grant), enables the workflow-safe commands it uses for the tenant and creates the triage_agents.ticket_triage process definition (tickets.ticket.created event trigger + manual trigger) when missing. Also reports whether the scripted LLM provider is active (rehearsal mode).',
      responses: [{ status: 200, description: 'Triage process ready', schema: responseSchema }],
    },
  },
}
