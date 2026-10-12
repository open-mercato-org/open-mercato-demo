import { z } from 'zod'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { makeCrudRoute, type CrudCtx } from '@open-mercato/shared/lib/crud/factory'
import { escapeLikePattern } from '@open-mercato/shared/lib/db/escapeLikePattern'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { parseCommaSeparatedList } from '@open-mercato/shared/lib/string'
import type { Where, WhereValue } from '@open-mercato/shared/lib/query/types'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import { Reservation, ReservationPayment, ReservationRefund } from '../../data/entities'
import {
  RESERVATION_ENTITY_ID,
  RESERVATION_STATUSES,
} from '../../data/constants'
import { reservationCreateSchema, reservationDeleteSchema, reservationUpdateSchema } from '../../data/validators'
import { reservationCrudEvents, reservationCrudIndexer } from '../../commands/reservations'
import { computeBalanceCents, formatAmount, fromCents } from '../../lib/balance'
import { normalizeBookingNumber } from '../../lib/bookingNumber'
import { computeDaysToDeparture, toDateOnlyString } from '../../lib/dates'
import {
  createReservationsCrudOpenApi,
  createReservationsPagedListResponseSchema,
  reservationListItemSchema,
  reservationsCreatedSchema,
  reservationsOkSchema,
} from '../openapi'

const querySchema = z
  .object({
    id: z.string().uuid().optional(),
    ids: z.string().optional(),
    page: z.coerce.number().min(1).default(1),
    pageSize: z.coerce.number().min(1).max(100).default(50),
    sortField: z.string().optional().default('departureDate'),
    sortDir: z.enum(['asc', 'desc']).optional().default('asc'),
    search: z.string().optional(),
    bookingNumber: z.string().optional(),
    customerPersonId: z.string().uuid().optional(),
    status: z.enum(RESERVATION_STATUSES).optional(),
    departureFrom: z.string().optional(),
    departureTo: z.string().optional(),
  })
  .passthrough()

type Query = z.infer<typeof querySchema>

const rawBodySchema = z.object({}).passthrough()

const baseListFields = [
  'id',
  'booking_number',
  'customer_person_id',
  'customer_name_snapshot',
  'status',
  'destination',
  'hotel_name',
  'room_type',
  'board_type',
  'departure_date',
  'return_date',
  'travelers_count',
  'total_price_amount',
  'currency_code',
  'tenant_id',
  'organization_id',
  'created_at',
  'updated_at',
]

const detailOnlyFields = ['customer_email_snapshot', 'notes']

const sortFieldMap: Record<string, string> = {
  bookingNumber: 'booking_number',
  booking_number: 'booking_number',
  departureDate: 'departure_date',
  departure_date: 'departure_date',
  returnDate: 'return_date',
  status: 'status',
  destination: 'destination',
  hotelName: 'hotel_name',
  totalPriceAmount: 'total_price_amount',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
}

type ReservationRow = {
  id: string
  booking_number: string
  customer_person_id: string
  customer_name_snapshot?: string | null
  customer_email_snapshot?: string | null
  status: string
  destination: string
  hotel_name: string
  room_type?: string | null
  board_type?: string | null
  departure_date: unknown
  return_date: unknown
  travelers_count: number | string
  total_price_amount: string | number
  currency_code: string
  notes?: string | null
  updated_at?: Date | string | null
}

type ReservationListItem = {
  id: string
  bookingNumber: string
  customerPersonId: string
  customerName: string | null
  customerEmail: string | null
  status: string
  destination: string
  hotelName: string
  roomType: string | null
  boardType: string | null
  departureDate: string | null
  returnDate: string | null
  travelersCount: number
  totalPriceAmount: string
  currencyCode: string
  notes: string | null
  daysToDeparture: number | null
  balance?: { paidTotal: number; refundedTotal: number; outstanding: number; overpayment: number } | null
  updatedAt: string | null
}

function isSingleRecordRequest(query: Pick<Query, 'id' | 'ids'>): boolean {
  if (typeof query.id === 'string' && query.id.length > 0) return true
  return typeof query.ids === 'string' && query.ids.trim().length > 0
}

function toIsoTimestamp(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value)
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString()
  }
  return null
}

function readOptionalString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function readDateFilter(value: string | undefined): string | null {
  return toDateOnlyString(value ?? null)
}

async function attachBalances(items: ReservationListItem[], ctx: CrudCtx): Promise<void> {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId || items.length === 0) return
  const reservationIds = items.map((item) => item.id)
  const em = (ctx.container.resolve('em') as EntityManager).fork()
  const scope = { tenantId, organizationId: ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null }
  const [payments, refunds] = await Promise.all([
    findWithDecryption(
      em,
      ReservationPayment,
      { reservationId: { $in: reservationIds }, tenantId, deletedAt: null } as FilterQuery<ReservationPayment>,
      { fields: ['id', 'reservationId', 'amount', 'status'] },
      scope,
    ),
    findWithDecryption(
      em,
      ReservationRefund,
      { reservationId: { $in: reservationIds }, tenantId, deletedAt: null } as FilterQuery<ReservationRefund>,
      { fields: ['id', 'reservationId', 'amount', 'status'] },
      scope,
    ),
  ])
  for (const item of items) {
    const cents = computeBalanceCents(
      { totalPriceAmount: item.totalPriceAmount },
      payments.filter((payment) => payment.reservationId === item.id),
      refunds.filter((refund) => refund.reservationId === item.id),
    )
    item.balance = {
      paidTotal: fromCents(cents.paid),
      refundedTotal: fromCents(cents.refunded),
      outstanding: fromCents(cents.outstanding),
      overpayment: fromCents(cents.overpayment),
    }
  }
}

function readDeleteId(raw: unknown): { id: unknown } {
  const record = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const body = record.body && typeof record.body === 'object' ? (record.body as Record<string, unknown>) : {}
  const query = record.query && typeof record.query === 'object' ? (record.query as Record<string, unknown>) : {}
  return { id: body.id ?? query.id }
}

export const { metadata, GET, POST, PUT, DELETE } = makeCrudRoute({
  metadata: {
    GET: { requireAuth: true, requireFeatures: ['reservations.view'] },
    POST: { requireAuth: true, requireFeatures: ['reservations.manage'] },
    PUT: { requireAuth: true, requireFeatures: ['reservations.manage'] },
    DELETE: { requireAuth: true, requireFeatures: ['reservations.manage'] },
  },
  orm: {
    entity: Reservation,
    idField: 'id',
    orgField: 'organizationId',
    tenantField: 'tenantId',
    softDeleteField: 'deletedAt',
  },
  events: reservationCrudEvents,
  indexer: reservationCrudIndexer,
  list: {
    schema: querySchema,
    entityId: RESERVATION_ENTITY_ID,
    fields: (query: Query) => [...baseListFields, ...(isSingleRecordRequest(query) ? detailOnlyFields : [])],
    sortFieldMap,
    buildFilters: async (query: Query): Promise<Where<Record<string, unknown>>> => {
      const filters: Where<Record<string, unknown>> = {}
      const target = filters as Record<string, WhereValue>
      const ids = parseCommaSeparatedList(query.ids)
      if (ids.length > 0) target.id = { $in: ids }
      if (query.id) target.id = query.id
      if (query.bookingNumber) {
        const normalized = normalizeBookingNumber(query.bookingNumber)
        target.booking_number = normalized || '__none__'
      }
      if (query.customerPersonId) target.customer_person_id = query.customerPersonId
      if (query.status) target.status = query.status
      const departureFrom = readDateFilter(query.departureFrom)
      const departureTo = readDateFilter(query.departureTo)
      if (departureFrom || departureTo) {
        const range: { $gte?: string; $lte?: string } = {}
        if (departureFrom) range.$gte = departureFrom
        if (departureTo) range.$lte = departureTo
        target.departure_date = range
      }
      if (query.search && query.search.trim()) {
        const term = query.search.trim()
        const pattern = `%${escapeLikePattern(term)}%`
        const normalized = normalizeBookingNumber(term)
        target.$or = [
          ...(normalized ? [{ booking_number: { $ilike: `%${escapeLikePattern(normalized)}%` } }] : []),
          { destination: { $ilike: pattern } },
          { hotel_name: { $ilike: pattern } },
        ] as unknown as WhereValue
      }
      return filters
    },
    transformItem: (item: ReservationRow): ReservationListItem => ({
      id: String(item.id),
      bookingNumber: String(item.booking_number),
      customerPersonId: String(item.customer_person_id),
      customerName: readOptionalString(item.customer_name_snapshot),
      customerEmail: readOptionalString(item.customer_email_snapshot),
      status: String(item.status),
      destination: String(item.destination),
      hotelName: String(item.hotel_name),
      roomType: readOptionalString(item.room_type),
      boardType: readOptionalString(item.board_type),
      departureDate: toDateOnlyString(item.departure_date),
      returnDate: toDateOnlyString(item.return_date),
      travelersCount: Number(item.travelers_count) || 0,
      totalPriceAmount: formatAmount(item.total_price_amount),
      currencyCode: String(item.currency_code),
      notes: readOptionalString(item.notes),
      daysToDeparture: computeDaysToDeparture(item.departure_date),
      updatedAt: toIsoTimestamp(item.updated_at),
    }),
  },
  hooks: {
    afterList: async (payload: { items?: ReservationListItem[] }, ctx) => {
      if (Array.isArray(payload?.items)) await attachBalances(payload.items, ctx)
    },
  },
  actions: {
    create: {
      commandId: 'reservations.reservation.create',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: ({ result }) => ({ id: String(result.reservationId) }),
      status: 201,
    },
    update: {
      commandId: 'reservations.reservation.update',
      schema: rawBodySchema,
      mapInput: ({ parsed }) => parsed,
      response: () => ({ ok: true }),
    },
    delete: {
      commandId: 'reservations.reservation.delete',
      mapInput: ({ raw }) => readDeleteId(raw),
      response: () => ({ ok: true }),
    },
  },
})

export const openApi: OpenApiRouteDoc = createReservationsCrudOpenApi({
  resourceName: 'Reservation',
  pluralName: 'Reservations',
  querySchema,
  listResponseSchema: createReservationsPagedListResponseSchema(reservationListItemSchema),
  create: {
    schema: reservationCreateSchema,
    description: 'Creates a reservation linked to a customers person. The booking number is normalized (uppercase, alphanumeric only).',
    responseSchema: reservationsCreatedSchema,
  },
  update: {
    schema: reservationUpdateSchema,
    description: 'Updates a reservation. Honors the optimistic-lock header derived from `updatedAt`.',
    responseSchema: reservationsOkSchema,
  },
  del: {
    schema: reservationDeleteSchema,
    description: 'Soft-deletes a reservation by id.',
    responseSchema: reservationsOkSchema,
  },
})
