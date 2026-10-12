import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { TicketArticle } from '../../../../data/entities'
import { TICKET_RESOURCE_KIND } from '../../../../data/constants'
import { addNoteSchema, type AddNoteInput } from '../../../../data/validators'
import { loadTicket } from '../../../../commands/shared'
import { serializeArticle, ticketArticleDtoSchema } from '../../../../lib/serializers'
import {
  executeGuardedCommand,
  handleRouteError,
  jsonWithOperation,
  parseRouteId,
  readBody,
  resolveRouteContext,
  routeEm,
} from '../../../../lib/routeHelpers'
import { ticketsErrorSchema, ticketsTag } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tickets.view'] },
  POST: { requireAuth: true, requireFeatures: ['tickets.manage'] },
}

const MAX_ARTICLES = 200

export async function GET(req: Request, routeCtx: { params?: { id?: string } }) {
  try {
    const context = await resolveRouteContext(req)
    const id = parseRouteId(routeCtx.params, context.translate)
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const em = routeEm(context)
    const ticket = await loadTicket(em, id, scope)
    if (!ticket) throw new CrudHttpError(404, { error: context.translate('tickets.errors.notFound', 'Ticket not found') })
    const articles = await findWithDecryption(
      em,
      TicketArticle,
      { ticketId: ticket.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      { orderBy: { createdAt: 'asc' }, limit: MAX_ARTICLES },
      scope,
    )
    return NextResponse.json({ items: articles.map(serializeArticle) })
  } catch (err) {
    return handleRouteError(err, 'tickets.articles.list')
  }
}

export async function POST(req: Request, routeCtx: { params?: { id?: string } }) {
  try {
    const context = await resolveRouteContext(req)
    const id = parseRouteId(routeCtx.params, context.translate)
    const body = await readBody(req)
    const parse = (payload: Record<string, unknown>): AddNoteInput => addNoteSchema.parse({
      body: payload.body,
      ticketId: id,
      tenantId: context.tenantId,
      organizationId: context.organizationId,
    })
    const input = parse(body)
    const outcome = await executeGuardedCommand<AddNoteInput, { ticketId: string; articleId: string }>({
      req,
      context,
      commandId: 'tickets.article.add_note',
      resourceKind: TICKET_RESOURCE_KIND,
      resourceId: id,
      operation: 'custom',
      input,
      parse,
    })
    if (outcome instanceof Response) return outcome
    return jsonWithOperation({ ok: true, ...outcome.result }, outcome.logEntry, 201)
  } catch (err) {
    return handleRouteError(err, 'tickets.articles.addNote')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: ticketsTag,
  summary: 'Ticket articles',
  methods: {
    GET: {
      summary: 'List the ticket article thread (oldest first)',
      responses: [{ status: 200, description: 'Articles', schema: z.object({ items: z.array(ticketArticleDtoSchema) }) }],
      errors: [{ status: 404, description: 'Ticket not found', schema: ticketsErrorSchema }],
    },
    POST: {
      summary: 'Add an internal note',
      requestBody: { contentType: 'application/json', schema: z.object({ body: z.string() }) },
      responses: [
        {
          status: 201,
          description: 'Note added',
          schema: z.object({ ok: z.boolean(), ticketId: z.string().uuid(), articleId: z.string().uuid() }),
        },
      ],
      errors: [
        { status: 400, description: 'Invalid input', schema: ticketsErrorSchema },
        { status: 404, description: 'Ticket not found', schema: ticketsErrorSchema },
      ],
    },
  },
}
