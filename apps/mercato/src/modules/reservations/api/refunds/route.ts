import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'
import type { Where, WhereValue } from '@open-mercato/shared/lib/query/types'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ReservationRefund } from '../../data/entities'
import { REFUND_STATUSES, RESERVATION_REFUND_ENTITY_ID } from '../../data/constants'
import { refundRequestSchema } from '../../data/validators'
import { formatAmount } from '../../lib/balance'
import {
  createReservationsCrudOpenApi,
  createReservationsPagedListResponseSchema,
  refundListItemSchema,
  reservationsCreatedSchema,
} from '../openapi'

const querySchema = z
  .object({
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    sortField: z.string().optional().default('createdAt'),
    sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
    reservationId: z.string().uuid().optional(),
    status: z.enum(REFUND_STATUSES).optional(),
  })
  .passthrough()

type Query = z.infer<typeof querySchema>

type RefundRow = {
  id: string
  reservation_id: string
  amount: string | number
  currency_code: string
  bank_account_last4: string
  reason?: string | null
  status: string
  source_type?: string | null
  source_ref?: string | null
  related_ticket_id?: string | null
  created_at?: Date | string | null
  updated_at?: Date | string | null
}

function toIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' && value.length > 0) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

export const { metadata, GET, POST } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['reservations.view'] },
    POST: { requireAuth: true, requireFeatures: ['reservations.refund.request'] },
  },
  orm: {
    entity: ReservationRefund,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: { module: 'reservations', entity: 'refund', persistent: true },
  indexer: { entityType: RESERVATION_REFUND_ENTITY_ID },
  list: {
    schema: querySchema,
    entityId: RESERVATION_REFUND_ENTITY_ID,
    fields: [
      'id',
      'reservation_id',
      'amount',
      'currency_code',
      'bank_account_last4',
      'reason',
      'status',
      'source_type',
      'source_ref',
      'related_ticket_id',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      amount: 'amount',
      status: 'status',
      updatedAt: 'updated_at',
    },
    buildFilters: async (query: Query): Promise<Where<Record<string, unknown>>> => {
      const filters: Where<Record<string, unknown>> = {}
      const target = filters as Record<string, WhereValue>
      const ids = parseCommaSeparatedList(query.ids)
      if (ids.length > 0) target.id = { $in: ids }
      if (query.id) target.id = query.id
      if (query.reservationId) target.reservation_id = query.reservationId
      if (query.status) target.status = query.status
      return filters
    },
    transformItem: (item: RefundRow) => ({
      id: String(item.id),
      reservationId: String(item.reservation_id),
      amount: formatAmount(item.amount),
      currencyCode: String(item.currency_code),
      bankAccountLast4: String(item.bank_account_last4 ?? ''),
      reason: item.reason ?? null,
      status: String(item.status),
      sourceType: item.source_type ?? null,
      sourceRef: item.source_ref ?? null,
      relatedTicketId: item.related_ticket_id ?? null,
      createdAt: toIso(item.created_at),
      updatedAt: toIso(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'reservations.refund.request',
      schema: z.object({}).passthrough(),
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({
        id: String(result.refundId),
        amount: result.amount,
        currencyCode: result.currencyCode,
        status: result.status,
      }),
      status: 201,
    },
  },
})

export const openApi: OpenApiRouteDoc = createReservationsCrudOpenApi({
  resourceName: 'Reservation refund',
  pluralName: 'Reservation refunds',
  querySchema,
  listResponseSchema: createReservationsPagedListResponseSchema(refundListItemSchema),
  create: {
    schema: refundRequestSchema,
    description:
      'Requests a refund for a reservation. The amount must not exceed the current overpayment (422 `refund_exceeds_overpayment`) and the bank account must be a valid IBAN (422 `invalid_iban`).',
    responseSchema: reservationsCreatedSchema.extend({
      amount: z.string(),
      currencyCode: z.string(),
      status: z.string(),
    }),
  },
})
