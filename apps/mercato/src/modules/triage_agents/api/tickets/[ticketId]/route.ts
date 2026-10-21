import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { findTriage, toTriageView } from '../../../lib/projection'
import { resolveTriageRouteContext, triageRouteErrorResponse } from '../../../lib/routeContext'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['triage_agents.view'] },
}

type RouteContext = { params: Promise<{ ticketId?: string }> }

const paramsSchema = z.object({ ticketId: z.string().uuid() })

const triageViewSchema = z.object({
  ticketId: z.string().uuid(),
  aiMode: z.string().nullable(),
  stage: z.string(),
  reason: z.string().nullable(),
  reasonCode: z.string().nullable(),
  route: z.string().nullable(),
  priority: z.string().nullable(),
  priorityReason: z.string().nullable(),
  recommendedActionLabel: z.string().nullable(),
  draftState: z.string(),
  confidence: z.number().nullable(),
  proposalId: z.string().nullable(),
  disposition: z.string().nullable(),
  executionId: z.string().nullable(),
  workflowInstanceId: z.string().nullable(),
  attempt: z.number().int(),
  attempts: z.array(
    z.object({
      attempt: z.number().int(),
      executionId: z.string().nullable(),
      stage: z.string(),
      aiMode: z.string().nullable(),
      reasonCode: z.string().nullable(),
      disposition: z.string().nullable(),
      recordedAt: z.string(),
    }),
  ),
  groundingState: z.string(),
  groundingIssues: z.array(z.string()),
  identification: z.record(z.string(), z.unknown()).nullable(),
  classification: z.record(z.string(), z.unknown()).nullable(),
  uncertainty: z.array(z.object({ code: z.string(), message: z.string(), blocking: z.boolean(), source: z.string() })),
  updatedAt: z.string(),
})

const responseSchema = z.object({ triage: triageViewSchema.nullable() })

export async function GET(req: Request, routeCtx: RouteContext) {
  try {
    const { ticketId } = paramsSchema.parse(await routeCtx.params)
    const context = await resolveTriageRouteContext(req)
    const em = context.container.resolve<EntityManager>('em').fork()
    const row = await findTriage(em, context.scope, ticketId)
    return NextResponse.json({ triage: row ? toTriageView(row) : null })
  } catch (err) {
    return triageRouteErrorResponse(err, 'ticket.triage')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Triage Agents',
  summary: 'Ticket triage projection',
  methods: {
    GET: {
      summary: 'The current AI triage result of a ticket',
      description: 'Returns the ticket_triages projection (stage, AI status, reason, identification match levels, classification, uncertainty, proposal and execution ids, previous attempts with their execution ids) or null when the ticket was never triaged.',
      responses: [{ status: 200, description: 'Triage projection', schema: responseSchema }],
    },
  },
}
