import { NextResponse } from 'next/server'
import { z } from 'zod'
import { runRouteMutationGuards } from '@open-mercato/shared/lib/crud/route-mutation-guard'
import { readJsonSafe } from '@open-mercato/shared/lib/http/readJsonSafe'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { rerunBodySchema } from '../../../../data/validators'
import { startTriageRerun } from '../../../../lib/rerun'
import { resolveTriageRouteContext, triageRouteErrorResponse } from '../../../../lib/routeContext'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['triage_agents.run'] },
}

type RouteContext = { params: Promise<{ ticketId?: string }> }

const paramsSchema = z.object({ ticketId: z.string().uuid() })
const responseSchema = z.object({
  executionId: z.string().uuid(),
  attempt: z.number().int(),
  supersededProposalIds: z.array(z.string().uuid()),
})
const errorSchema = z.object({ error: z.string(), code: z.string().optional() })

export async function POST(req: Request, routeCtx: RouteContext) {
  try {
    const { ticketId } = paramsSchema.parse(await routeCtx.params)
    const body = rerunBodySchema.parse(await readJsonSafe(req, {}))
    const context = await resolveTriageRouteContext(req)
    const guarded = await runRouteMutationGuards({
      container: context.container,
      req,
      auth: { userId: context.userId, tenantId: context.scope.tenantId, organizationId: context.scope.organizationId },
      input: {
        resourceKind: 'triage_agents.ticket_triage',
        resourceId: ticketId,
        operation: 'custom',
        mutationPayload: { ticketId, supersede: body.supersede === true },
      },
    })
    if (!guarded.ok) return guarded.response
    const result = await startTriageRerun(context.container, context.ctx, context.scope, ticketId, context.userId, {
      supersede: body.supersede === true,
    })
    await guarded.runAfterSuccess()
    return NextResponse.json(result, { status: 202 })
  } catch (err) {
    return triageRouteErrorResponse(err, 'ticket.rerun')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Triage Agents',
  summary: 'Re-run AI ticket triage',
  methods: {
    POST: {
      summary: 'Start a new triage execution for a ticket',
      description:
        'Starts the triage_agents.ticket_triage process for the ticket through its manual trigger (a new attempt). Refused with 409 pending_proposal while the current attempt waits for a consultant to dispose its proposal, unless `supersede: true`: the pending proposal is then rejected through the AO dispose command (reason superseded_by_rerun, requires agent_orchestrator.proposals.dispose), the superseded attempt does not flag the ticket, and the new execution records triggeredBy.rerunOfExecutionId.',
      requestBody: { contentType: 'application/json', schema: rerunBodySchema },
      responses: [{ status: 202, description: 'Execution accepted', schema: responseSchema }],
      errors: [
        { status: 403, description: 'supersede without agent_orchestrator.proposals.dispose', schema: errorSchema },
        { status: 404, description: 'Ticket or process definition not found', schema: errorSchema },
        { status: 409, description: 'A proposal is still pending and supersede was not requested', schema: errorSchema },
      ],
    },
  },
}
