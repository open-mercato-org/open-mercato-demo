import { NextResponse } from 'next/server'
import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { TicketReplyDraft } from '../../../../data/entities'
import { TICKET_REPLY_DRAFT_RESOURCE_KIND } from '../../../../data/constants'
import { draftStatusSchema, replyDraftSaveSchema, type ReplyDraftSaveInput } from '../../../../data/validators'
import { loadTicket } from '../../../../commands/shared'
import type { DraftSaveResult } from '../../../../commands/drafts'
import { serializeDraft, ticketDraftDtoSchema } from '../../../../lib/serializers'
import {
  executeGuardedCommand,
  handleRouteError,
  jsonWithOperation,
  parseRouteId,
  readBody,
  resolveRouteContext,
  routeEm,
  type TicketsRouteContext,
} from '../../../../lib/routeHelpers'
import { ticketsErrorSchema, ticketsTag } from '../../../openapi'

export const metadata = {
  GET: { requireAuth: true, requireFeatures: ['tickets.view'] },
  POST: { requireAuth: true, requireFeatures: ['tickets.reply'] },
  PUT: { requireAuth: true, requireFeatures: ['tickets.reply'] },
}

const MAX_DRAFTS = 50

const listQuerySchema = z.object({ status: draftStatusSchema.optional() })

const saveRequestSchema = z.object({
  draftId: z.string().uuid().optional(),
  body: z.string(),
  subject: z.string().nullable().optional(),
  sourceType: z.string().nullable().optional(),
  sourceRef: z.string().nullable().optional(),
})

const saveResponseSchema = z.object({
  ok: z.boolean(),
  ticketId: z.string().uuid(),
  draftId: z.string().uuid(),
  created: z.boolean(),
})

export async function GET(req: Request, routeCtx: { params?: { id?: string } }) {
  try {
    const context = await resolveRouteContext(req)
    const id = parseRouteId(routeCtx.params, context.translate)
    const url = new URL(req.url)
    const query = listQuerySchema.parse({ status: url.searchParams.get('status') ?? undefined })
    const scope = { tenantId: context.tenantId, organizationId: context.organizationId }
    const em = routeEm(context)
    const ticket = await loadTicket(em, id, scope)
    if (!ticket) throw new CrudHttpError(404, { error: context.translate('tickets.errors.notFound', 'Ticket not found') })
    const drafts = await findWithDecryption(
      em,
      TicketReplyDraft,
      {
        ticketId: ticket.id,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        deletedAt: null,
        status: query.status ?? 'draft',
      },
      { orderBy: { updatedAt: 'desc' }, limit: MAX_DRAFTS },
      scope,
    )
    return NextResponse.json({ items: drafts.map(serializeDraft) })
  } catch (err) {
    return handleRouteError(err, 'tickets.drafts.list')
  }
}

async function saveDraft(req: Request, routeCtx: { params?: { id?: string } }, requireDraftId: boolean) {
  const context: TicketsRouteContext = await resolveRouteContext(req)
  const id = parseRouteId(routeCtx.params, context.translate)
  const body = await readBody(req)
  const parse = (payload: Record<string, unknown>): ReplyDraftSaveInput => replyDraftSaveSchema.parse({
    ...payload,
    ticketId: id,
    tenantId: context.tenantId,
    organizationId: context.organizationId,
  })
  const input = parse(body)
  if (requireDraftId && !input.draftId) {
    throw new CrudHttpError(400, { error: context.translate('tickets.errors.draftIdRequired', 'Draft id is required') })
  }
  const outcome = await executeGuardedCommand<ReplyDraftSaveInput, DraftSaveResult>({
    req,
    context,
    commandId: 'tickets.reply_draft.save',
    resourceKind: TICKET_REPLY_DRAFT_RESOURCE_KIND,
    resourceId: input.draftId ?? null,
    operation: input.draftId ? 'update' : 'create',
    input,
    parse,
  })
  if (outcome instanceof Response) return outcome
  return jsonWithOperation({ ok: true, ...outcome.result }, outcome.logEntry, outcome.result.created ? 201 : 200)
}

export async function POST(req: Request, routeCtx: { params?: { id?: string } }) {
  try {
    return await saveDraft(req, routeCtx, false)
  } catch (err) {
    return handleRouteError(err, 'tickets.drafts.create')
  }
}

export async function PUT(req: Request, routeCtx: { params?: { id?: string } }) {
  try {
    return await saveDraft(req, routeCtx, true)
  } catch (err) {
    return handleRouteError(err, 'tickets.drafts.update')
  }
}

export const openApi: OpenApiRouteDoc = {
  tag: ticketsTag,
  summary: 'Ticket reply drafts',
  methods: {
    GET: {
      summary: 'List reply drafts (defaults to status=draft)',
      query: listQuerySchema,
      responses: [{ status: 200, description: 'Drafts', schema: z.object({ items: z.array(ticketDraftDtoSchema) }) }],
      errors: [{ status: 404, description: 'Ticket not found', schema: ticketsErrorSchema }],
    },
    POST: {
      summary: 'Create a reply draft',
      requestBody: { contentType: 'application/json', schema: saveRequestSchema },
      responses: [{ status: 201, description: 'Draft created', schema: saveResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid input', schema: ticketsErrorSchema },
        { status: 404, description: 'Ticket not found', schema: ticketsErrorSchema },
      ],
    },
    PUT: {
      summary: 'Update a reply draft (optimistic-lock header supported)',
      requestBody: { contentType: 'application/json', schema: saveRequestSchema },
      responses: [{ status: 200, description: 'Draft updated', schema: saveResponseSchema }],
      errors: [
        { status: 400, description: 'Invalid input', schema: ticketsErrorSchema },
        { status: 404, description: 'Draft not found', schema: ticketsErrorSchema },
        { status: 409, description: 'Draft already sent or stale version', schema: ticketsErrorSchema },
      ],
    },
  },
}
