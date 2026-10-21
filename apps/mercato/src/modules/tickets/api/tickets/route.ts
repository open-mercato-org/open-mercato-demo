import { z } from 'zod'
import type { EntityManager } from '@mikro-orm/postgresql'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { parseBooleanFromUnknown } from '@open-mercato/shared/lib/boolean'
import { parseScopedCommandInput, withScopedPayload } from '@open-mercato/shared/lib/api/scoped'
import { buildIlikeTerm } from '@open-mercato/shared/lib/db/buildIlikeTerm'
import { lookupHashCandidates } from '@open-mercato/shared/lib/encryption/aes'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { Ticket } from '../../data/entities'
import { TICKET_ENTITY_ID } from '../../data/constants'
import {
  ticketCreateSchema,
  ticketDeleteSchema,
  ticketPrioritySchema,
  ticketStatusSchema,
  ticketUpdateSchema,
} from '../../data/validators'
import { ticketListItemSchema, transformTicketListItem } from '../../lib/serializers'
import { toRecord } from '../../lib/routeHelpers'
import {
  createPagedListResponseSchema,
  createTicketsCrudOpenApi,
  defaultOkResponseSchema,
} from '../openapi'

const uuid = z.string().uuid()

function csvList<T extends z.ZodTypeAny>(item: T) {
  return z.preprocess((value) => {
    if (typeof value === 'string') return value.split(',').map((part) => part.trim()).filter(Boolean)
    return value
  }, z.array(item).min(1).max(20).optional())
}

const booleanQuerySchema = z.preprocess((value) => parseBooleanFromUnknown(value) ?? undefined, z.boolean().optional())

const listSchema = z
  .object({
    id: uuid.optional(),
    ids: z.string().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    status: csvList(ticketStatusSchema),
    priority: csvList(ticketPrioritySchema),
    queueKey: z.string().trim().min(1).max(100).optional(),
    needsManualReview: booleanQuerySchema,
    customerPersonId: uuid.optional(),
    reservationId: uuid.optional(),
    topicKey: z.string().trim().min(1).max(200).optional(),
    assigneeUserId: uuid.optional(),
    mine: booleanQuerySchema,
    requesterEmail: z.string().trim().email().optional(),
    q: z.string().trim().max(200).optional(),
    sortField: z.enum(['priority', 'lastInboundAt', 'createdAt', 'updatedAt', 'number']).optional(),
    sortDir: z.enum(['asc', 'desc']).optional(),
  })
  .passthrough()

type TicketListQuery = z.infer<typeof listSchema>

const httpCreateSchema = ticketCreateSchema.omit({ id: true, initialArticle: true })

const routeMetadata = {
  GET: { requireAuth: true, requireFeatures: ['tickets.view'] },
  POST: { requireAuth: true, requireFeatures: ['tickets.manage'] },
  PUT: { requireAuth: true, requireFeatures: ['tickets.manage'] },
  DELETE: { requireAuth: true, requireFeatures: ['tickets.manage'] },
}

export const metadata = routeMetadata

const listFields = [
  'id',
  'number',
  'subject',
  'channel',
  'queue_key',
  'status',
  'priority',
  'priority_rank',
  'priority_reason',
  'requester_email',
  'requester_name',
  'customer_person_id',
  'reservation_id',
  'reservation_number_snapshot',
  'category_key',
  'subcategory_key',
  'topic_key',
  'category_path_snapshot',
  'summary',
  'needs_manual_review',
  'manual_review_reason_code',
  'manual_review_reason',
  'classified_at',
  'classification_source',
  'assignee_user_id',
  'last_inbound_at',
  'last_outbound_at',
  'organization_id',
  'tenant_id',
  'created_at',
  'updated_at',
]

type TicketSearchDb = {
  tickets: {
    id: string
    tenant_id: string
    organization_id: string
    number: string
    category_path_snapshot: string | null
    reservation_number_snapshot: string | null
    requester_email_hash: string | null
    deleted_at: Date | null
  }
}

const SEARCH_MATCH_LIMIT = 500

function resolveListScope(ctx: CrudCtx): { tenantId: string; organizationIds: string[] | null } | null {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) return null
  const selected = ctx.selectedOrganizationId ?? null
  if (selected) return { tenantId, organizationIds: [selected] }
  const visible = Array.isArray(ctx.organizationIds) && ctx.organizationIds.length ? ctx.organizationIds : null
  return { tenantId, organizationIds: visible }
}

async function findTicketIdsMatching(
  ctx: CrudCtx,
  options: { term?: string; requesterEmail?: string },
): Promise<string[]> {
  const scope = resolveListScope(ctx)
  if (!scope) return []
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const db = em.getKysely<TicketSearchDb>()
  let query = db
    .selectFrom('tickets')
    .select('id')
    .where('tenant_id', '=', scope.tenantId)
    .where('deleted_at', 'is', null)
  if (scope.organizationIds) query = query.where('organization_id', 'in', scope.organizationIds)
  const term = options.term?.trim()
  const emailCandidates = options.requesterEmail
    ? lookupHashCandidates(options.requesterEmail)
    : term && term.includes('@')
      ? lookupHashCandidates(term)
      : []
  if (options.requesterEmail) {
    query = query.where('requester_email_hash', 'in', emailCandidates)
  } else if (term) {
    const pattern = buildIlikeTerm(term)
    query = query.where((eb) => eb.or([
      eb('number', 'ilike', pattern),
      eb('category_path_snapshot', 'ilike', pattern),
      eb('reservation_number_snapshot', 'ilike', pattern),
      ...(emailCandidates.length ? [eb('requester_email_hash', 'in', emailCandidates)] : []),
    ]))
  }
  const rows = await query.limit(SEARCH_MATCH_LIMIT).execute()
  return rows.map((row) => row.id)
}

function narrowToIds(filters: Record<string, unknown>, ids: string[]): void {
  const existing = filters.id as { $in?: string[]; $eq?: string } | undefined
  if (existing?.$eq) {
    filters.id = { $in: ids.includes(existing.$eq) ? [existing.$eq] : [] }
    return
  }
  if (existing?.$in) {
    const allowed = new Set(ids)
    filters.id = { $in: existing.$in.filter((value) => allowed.has(value)) }
    return
  }
  filters.id = { $in: ids }
}

const crud = makeCrudRoute({
  metadata: routeMetadata,
  orm: {
    entity: Ticket,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  indexer: { entityType: TICKET_ENTITY_ID },
  enrichers: { entityId: 'tickets.ticket' },
  list: {
    schema: listSchema,
    entityId: TICKET_ENTITY_ID,
    fields: listFields,
    sortFieldMap: {
      priority: 'priority_rank',
      priorityRank: 'priority_rank',
      lastInboundAt: 'last_inbound_at',
      createdAt: 'created_at',
      updatedAt: 'updated_at',
      number: 'number',
    },
    defaultSort: { field: 'priority', dir: 'desc' },
    tiebreakSortField: 'last_inbound_at',
    buildFilters: async (query: TicketListQuery, ctx) => {
      const filters: Record<string, unknown> = {}
      if (query.id) filters.id = { $eq: query.id }
      if (query.status?.length) filters.status = { $in: query.status }
      if (query.priority?.length) filters.priority = { $in: query.priority }
      if (query.queueKey) filters.queue_key = { $eq: query.queueKey }
      if (query.needsManualReview !== undefined) filters.needs_manual_review = { $eq: query.needsManualReview }
      if (query.customerPersonId) filters.customer_person_id = { $eq: query.customerPersonId }
      if (query.reservationId) filters.reservation_id = { $eq: query.reservationId }
      if (query.topicKey) filters.topic_key = { $eq: query.topicKey }
      if (query.mine === true) {
        filters.assignee_user_id = { $eq: ctx.auth?.sub ?? '00000000-0000-0000-0000-000000000000' }
      } else if (query.assigneeUserId) {
        filters.assignee_user_id = { $eq: query.assigneeUserId }
      }
      if (query.q || query.requesterEmail) {
        const ids = await findTicketIdsMatching(ctx, { term: query.q, requesterEmail: query.requesterEmail })
        narrowToIds(filters, ids)
      }
      return filters
    },
    transformItem: transformTicketListItem,
  },
  actions: {
    create: {
      commandId: 'tickets.ticket.create',
      schema: z.object({}).passthrough(),
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(httpCreateSchema, raw ?? {}, ctx, translate)
      },
      response: ({ result }: { result: Record<string, unknown> | null }) => ({
        id: typeof result?.ticketId === 'string' ? result.ticketId : null,
        number: typeof result?.number === 'string' ? result.number : null,
      }),
      status: 201,
    },
    update: {
      commandId: 'tickets.ticket.update',
      schema: z.object({}).passthrough(),
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        return parseScopedCommandInput(ticketUpdateSchema.strict(), raw ?? {}, ctx, translate)
      },
      response: ({ result }: { result: Record<string, unknown> | null }) => ({
        ok: true,
        id: typeof result?.ticketId === 'string' ? result.ticketId : null,
      }),
    },
    delete: {
      commandId: 'tickets.ticket.delete',
      schema: z.object({}).passthrough(),
      mapInput: async ({ raw, ctx }) => {
        const { translate } = await resolveTranslations()
        const rawRecord = toRecord(raw)
        const id = toRecord(rawRecord.body).id ?? toRecord(rawRecord.query).id
        if (typeof id !== 'string' || !id) {
          throw new CrudHttpError(400, { error: translate('tickets.errors.invalidId', 'Invalid ticket id') })
        }
        return ticketDeleteSchema.parse(withScopedPayload({ id }, ctx, translate))
      },
      response: () => ({ ok: true }),
    },
  },
})

export const GET = crud.GET
export const POST = crud.POST
export const PUT = crud.PUT
export const DELETE = crud.DELETE

export const openApi = createTicketsCrudOpenApi({
  resourceName: 'Ticket',
  pluralName: 'Tickets',
  querySchema: listSchema,
  listResponseSchema: createPagedListResponseSchema(ticketListItemSchema),
  create: {
    schema: httpCreateSchema,
    responseSchema: z.object({ id: z.string().uuid().nullable(), number: z.string().nullable() }),
    description: 'Creates a manual ticket. Status and classification are managed through dedicated action endpoints.',
  },
  update: {
    schema: ticketUpdateSchema,
    responseSchema: z.object({ ok: z.boolean(), id: z.string().uuid().nullable() }),
    description: 'Updates the ticket subject, queue and assignee. Status and classification are not writable here.',
  },
  del: {
    schema: ticketDeleteSchema,
    responseSchema: defaultOkResponseSchema,
    description: 'Soft-deletes a ticket.',
  },
})
