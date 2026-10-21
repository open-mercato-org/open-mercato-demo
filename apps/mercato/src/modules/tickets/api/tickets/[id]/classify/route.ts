import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ticketClassifySchema, type TicketClassifyParsed } from '../../../../data/validators'
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

const requestSchema = ticketClassifySchema.omit({ id: true, tenantId: true, organizationId: true })
const responseSchema = z.object({ ok: z.boolean(), ticketId: z.string().uuid() })

export async function POST(req: Request, routeCtx: { params?: { id?: string } }) {
  try {
    const context = await resolveRouteContext(req)
    const id = parseRouteId(routeCtx.params, context.translate)
    const body = await readBody(req)
    const parse = (payload: Record<string, unknown>): TicketClassifyParsed => ticketClassifySchema.parse({
      ...payload,
      id,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
    const input = parse(body)
    const outcome = await executeGuardedCommand<TicketClassifyParsed, { ticketId: string }>({
      req,
      context,
      commandId: 'tickets.ticket.classify',
      resourceKind: TICKET_RESOURCE_KIND,
      resourceId: id,
      operation: 'custom',
      input,
      parse,
    })
    if (outcome instanceof Response) return outcome
    return jsonWithOperation({ ok: true, ticketId: outcome.result.ticketId }, outcome.logEntry)
  } catch (err) {
    return handleRouteError(err, 'tickets.classify')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: ticketsTag,
  summary: 'Classify ticket',
  methods: {
    POST: {
      summary: 'Set ticket classification (customer, reservation, KB keys, priority, summary)',
      description: 'A `workflow` source cannot overwrite a `manual` classification unless `force` is set (409). Honors the optimistic-lock header.',
      requestBody: { contentType: 'application/json', schema: requestSchema },
      responses: [{ status: 200, description: 'Ticket classified', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid input', schema: ticketsErrorSchema },
        { status: 404, description: 'Ticket not found', schema: ticketsErrorSchema },
        { status: 409, description: 'Conflict (stale version or manual classification lock)', schema: ticketsErrorSchema },
      ],
    },
  },
}
