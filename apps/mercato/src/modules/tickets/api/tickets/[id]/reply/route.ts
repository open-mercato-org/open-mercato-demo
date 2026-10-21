import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { replySendSchema, type ReplySendInput } from '../../../../data/validators'
import { TICKET_RESOURCE_KIND } from '../../../../data/constants'
import {
  executeGuardedCommand,
  handleRouteError,
  jsonWithOperation,
  parseRouteId,
  readBody,
  resolveRouteContext,
} from '../../../../lib/routeHelpers'
import type { ReplySendResult } from '../../../../commands/replies'
import { ticketsErrorSchema, ticketsTag } from '../../../openapi'

export const metadata = {
  POST: { requireAuth: true, requireFeatures: ['tickets.reply'] },
}

const requestSchema = z.object({
  draftId: z.string().uuid().optional(),
  body: z.string().optional(),
  subject: z.string().optional(),
  resolveAfterSend: z.boolean().optional(),
})

const responseSchema = z.object({
  ok: z.boolean(),
  ticketId: z.string().uuid(),
  articleId: z.string(),
  draftId: z.string().uuid().nullable(),
  deliveryStatus: z.string(),
  alreadySent: z.boolean(),
  status: z.string(),
})

export async function POST(req: Request, routeCtx: { params?: { id?: string } }) {
  try {
    const context = await resolveRouteContext(req)
    const id = parseRouteId(routeCtx.params, context.translate)
    const body = await readBody(req)
    const parse = (payload: Record<string, unknown>): ReplySendInput => replySendSchema.parse({
      ...payload,
      ticketId: id,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
    const input = parse(body)
    const outcome = await executeGuardedCommand<ReplySendInput, ReplySendResult>({
      req,
      context,
      commandId: 'tickets.reply.send',
      resourceKind: TICKET_RESOURCE_KIND,
      resourceId: id,
      operation: 'custom',
      input,
      parse,
    })
    if (outcome instanceof Response) return outcome
    return jsonWithOperation({ ok: true, ...outcome.result }, outcome.logEntry)
  } catch (err) {
    return handleRouteError(err, 'tickets.reply')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: ticketsTag,
  summary: 'Send ticket reply',
  methods: {
    POST: {
      summary: 'Send a reply from a draft or an ad-hoc body',
      description: 'Creates an outbound article and delivers it through the configured email transport, or records `simulated` delivery when none is configured or `OM_TICKETS_DELIVERY=simulated`. Idempotent per draft. Not undoable.',
      requestBody: { contentType: 'application/json', schema: requestSchema },
      responses: [{ status: 200, description: 'Reply sent', schema: responseSchema }],
      errors: [
        { status: 400, description: 'Invalid input', schema: ticketsErrorSchema },
        { status: 404, description: 'Ticket or draft not found', schema: ticketsErrorSchema },
        { status: 409, description: 'Ticket closed or draft discarded', schema: ticketsErrorSchema },
      ],
    },
  },
}
