import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { AWAITING_DECISION_FEATURES } from '../../data/constants'
import { findTicketIdsAwaitingDecision } from '../../lib/awaitingDecision'
import { resolveTriageRouteContext, triageRouteErrorResponse } from '../../lib/routeContext'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: [...AWAITING_DECISION_FEATURES] },
}

const responseSchema = z.object({ total: z.number().int().min(0) })

export async function GET(req: Request) {
  try {
    const context = await resolveTriageRouteContext(req)
    const em = context.container.resolve<EntityManager>('em').fork()
    const ticketIds = await findTicketIdsAwaitingDecision(em, context.scope)
    return NextResponse.json({ total: ticketIds.length })
  } catch (err) {
    return triageRouteErrorResponse(err, 'awaiting_decision.count')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: 'Triage Agents',
  summary: 'Tickets awaiting a decision',
  methods: {
    GET: {
      summary: 'Count tickets whose AI proposal awaits a human decision',
      description: 'Counts tickets in the selected organization whose triage projection is awaiting approval and whose agent proposal is still pending (capped at 200). Not narrowed to the review task assignee: anyone allowed to dispose proposals may decide.',
      responses: [{ status: 200, description: 'Pending decision count', schema: responseSchema }],
    },
  },
}
