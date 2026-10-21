import { z } from 'zod'
import { makeCrudRoute } from '@open-mercato/shared/lib/crud/factory'
import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'
import type { Where, WhereValue } from '@open-mercato/shared/lib/query/types'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { ReservationPayment } from '../../data/entities'
import { PAYMENT_STATUSES, RESERVATION_PAYMENT_ENTITY_ID } from '../../data/constants'
import { paymentRecordSchema } from '../../data/validators'
import { formatAmount } from '../../lib/balance'
import {
  createReservationsCrudOpenApi,
  createReservationsPagedListResponseSchema,
  paymentListItemSchema,
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
    status: z.enum(PAYMENT_STATUSES).optional(),
  })
  .passthrough()

type Query = z.infer<typeof querySchema>

type PaymentRow = {
  id: string
  reservation_id: string
  amount: string | number
  currency_code: string
  status: string
  method: string
  paid_at?: Date | string | null
  booked_at?: Date | string | null
  external_reference?: string | null
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
    POST: { requireAuth: true, requireFeatures: ['reservations.payment.record'] },
  },
  orm: {
    entity: ReservationPayment,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: { module: 'reservations', entity: 'payment', persistent: true },
  indexer: { entityType: RESERVATION_PAYMENT_ENTITY_ID },
  list: {
    schema: querySchema,
    entityId: RESERVATION_PAYMENT_ENTITY_ID,
    fields: [
      'id',
      'reservation_id',
      'amount',
      'currency_code',
      'status',
      'method',
      'paid_at',
      'booked_at',
      'external_reference',
      'created_at',
      'updated_at',
    ],
    sortFieldMap: {
      createdAt: 'created_at',
      paidAt: 'paid_at',
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
    transformItem: (item: PaymentRow) => ({
      id: String(item.id),
      reservationId: String(item.reservation_id),
      amount: formatAmount(item.amount),
      currencyCode: String(item.currency_code),
      status: String(item.status),
      method: String(item.method),
      paidAt: toIso(item.paid_at),
      bookedAt: toIso(item.booked_at),
      externalReference: item.external_reference ?? null,
      updatedAt: toIso(item.updated_at),
    }),
  },
  actions: {
    create: {
      commandId: 'reservations.payment.record',
      schema: z.object({}).passthrough(),
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String(result.paymentId) }),
      status: 201,
    },
  },
})

export const openApi: OpenApiRouteDoc = createReservationsCrudOpenApi({
  resourceName: 'Reservation payment',
  pluralName: 'Reservation payments',
  querySchema,
  listResponseSchema: createReservationsPagedListResponseSchema(paymentListItemSchema),
  create: {
    schema: paymentRecordSchema,
    description: 'Records a payment against a reservation. Defaults to a booked bank transfer in the reservation currency.',
    responseSchema: reservationsCreatedSchema,
  },
})
