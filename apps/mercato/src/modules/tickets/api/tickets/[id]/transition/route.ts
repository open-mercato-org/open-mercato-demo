import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ticketStatusSchema, ticketTransitionSchema, type TicketTransitionInput } from '../../../../data/validators'
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
  POST: { requireAuth: true, requireFeatures: ['tickets.manage'] },
}

const requestSchema = z.object({ to: ticketStatusSchema, note: z.string().optional() })
const responseSchema = z.object({
  ok: z.boolean(),
  ticketId: z.string().uuid(),
  fromStatus: ticketStatusSchema,
  toStatus: ticketStatusSchema,
})

type TransitionResult = { ticketId: string; fromStatus: string; toStatus: string }

export async function POST(req: Request, routeCtx: { params?: { id?: string } }) {
  try {
    const context = await resolveRouteContext(req)
    const id = parseRouteId(routeCtx.params, context.translate)
    const body = await readBody(req)
    const parse = (payload: Record<string, unknown>): TicketTransitionInput => ticketTransitionSchema.parse({
      ...payload,
      id,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
    const input = parse(body)
    const outcome = await executeGuardedCommand<TicketTransitionInput, TransitionResult>({
      req,
      context,
      commandId: 'tickets.ticket.transition',
      resourceKind: TICKET_RESOURCE_KIND,
      resourceId: id,
      operation: 'custom',
      input,
      parse,
    })
    if (outcome instanceof Response) return outcome
    return jsonWithOperation({ ok: true, ...outcome.result }, outcome.logEntry)
  } catch (err) {
    return handleRouteError(err, 'tickets.transition')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: ticketsTag,
  summary: 'Transition ticket status',
  methods: {
    POST: {
      summary: 'Move a ticket through the status machine',
      requestBody: { contentType: 'application/json', schema: requestSchema },
      responses: [{ status: 200, description: 'Ticket transitioned', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid transition or input', schema: ticketsErrorSchema },
        { status: 404, description: 'Ticket not found', schema: ticketsErrorSchema },
        { status: 409, description: 'Stale version', schema: ticketsErrorSchema },
      ],
    },
  },
}
