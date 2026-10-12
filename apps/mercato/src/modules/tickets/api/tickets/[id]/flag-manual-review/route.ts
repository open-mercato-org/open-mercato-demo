import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ticketFlagManualReviewSchema, type TicketFlagManualReviewInput } from '../../../../data/validators'
import { TICKET_RESOURCE_KIND } from '../../../../data/constants'
import {
  executeGuardedCommand,
  handleRouteError,
  jsonWithOperation,
  parseRouteId,
  readBody,
  resolveRouteContext,
} from '../../../../lib/routeHelpers'
import { ticketsErrorSchema, ticketsTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['tickets.classify'] },
}

const requestSchema = z.object({
  reason: z.string().optional(),
  reasonCode: z.string().optional(),
  targetQueueKey: z.string().optional(),
  clear: z.boolean().optional(),
})
const responseSchema = z.object({ ok: z.boolean(), ticketId: z.string().uuid() })

export async function POST(req: Request, routeCtx: { params?: { id?: string } }) {
  try {
    const context = await resolveRouteContext(req)
    const id = parseRouteId(routeCtx.params, context.translate)
    const body = await readBody(req)
    const parse = (payload: Record<string, unknown>): TicketFlagManualReviewInput => ticketFlagManualReviewSchema.parse({
      ...payload,
      id,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
    const input = parse(body)
    const outcome = await executeGuardedCommand<TicketFlagManualReviewInput, { ticketId: string }>({
      req,
      context,
      commandId: 'tickets.ticket.flag_manual_review',
      resourceKind: TICKET_RESOURCE_KIND,
      resourceId: id,
      operation: 'custom',
      input,
      parse,
    })
    if (outcome instanceof Response) return outcome
    return jsonWithOperation({ ok: true, ticketId: outcome.result.ticketId }, outcome.logEntry)
  } catch (err) {
    return handleRouteError(err, 'tickets.flagManualReview')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: ticketsTag,
  summary: 'Flag ticket for manual review',
  methods: {
    POST: {
      summary: 'Flag (or clear) the manual-review marker with a reason',
      requestBody: { contentType: 'application/json', schema: requestSchema },
      responses: [{ status: 200, description: 'Ticket flagged', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid input', schema: ticketsErrorSchema },
        { status: 404, description: 'Ticket not found', schema: ticketsErrorSchema },
        { status: 409, description: 'Stale version', schema: ticketsErrorSchema },
      ],
    },
  },
}
