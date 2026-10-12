import { z } from 'zod'
import type { OpenApiRouteDoc } from '@open-mercato/shared/lib/openapi'
import {
  createCrudOpenApiFactory,
  createPagedListResponseSchema,
  type CrudOpenApiOptions,
} from '@open-mercato/shared/lib/openapi/crud'

export const reservationsTag = 'Reservations'

export const reservationsErrorSchema = z
  .object({
    error: z.string(),
    code: z.string().optional(),
    fieldErrors: z.record(z.string(), z.string()).optional(),
  })
  .passthrough()

export const reservationsOkSchema = z.object({ ok: z.literal(true) })

export const reservationsCreatedSchema = z.object({ id: z.string().uuid() })

export const balanceSchema = z.object({
  totalPrice: z.number(),
  paidTotal: z.number(),
  pendingPaymentsTotal: z.number(),
  refundedTotal: z.number(),
  outstanding: z.number(),
  overpayment: z.number(),
  currencyCode: z.string(),
  daysToDeparture: z.number().nullable(),
})

export const reservationListItemSchema = z
  .object({
    id: z.string().uuid(),
    bookingNumber: z.string(),
    customerPersonId: z.string().uuid(),
    customerName: z.string().nullable(),
    customerEmail: z.string().nullable().optional(),
    status: z.string(),
    destination: z.string(),
    hotelName: z.string(),
    roomType: z.string().nullable().optional(),
    boardType: z.string().nullable().optional(),
    departureDate: z.string().nullable(),
    returnDate: z.string().nullable(),
    travelersCount: z.number(),
    totalPriceAmount: z.string(),
    currencyCode: z.string(),
    notes: z.string().nullable().optional(),
    daysToDeparture: z.number().nullable(),
    balance: balanceSchema.partial().nullable().optional(),
    updatedAt: z.string().nullable(),
  })
  .passthrough()

export const paymentListItemSchema = z
  .object({
    id: z.string().uuid(),
    reservationId: z.string().uuid(),
    amount: z.string(),
    currencyCode: z.string(),
    status: z.string(),
    method: z.string(),
    paidAt: z.string().nullable(),
    bookedAt: z.string().nullable(),
    externalReference: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .passthrough()

export const refundListItemSchema = z
  .object({
    id: z.string().uuid(),
    reservationId: z.string().uuid(),
    amount: z.string(),
    currencyCode: z.string(),
    bankAccountLast4: z.string(),
    reason: z.string().nullable().optional(),
    status: z.string(),
    sourceType: z.string().nullable(),
    sourceRef: z.string().nullable(),
    relatedTicketId: z.string().nullable(),
    createdAt: z.string().nullable(),
    updatedAt: z.string().nullable(),
  })
  .passthrough()

export function createReservationsPagedListResponseSchema(itemSchema: z.ZodTypeAny) {
  return createPagedListResponseSchema(itemSchema, { paginationMetaOptional: true })
}

const buildReservationsCrudOpenApi = createCrudOpenApiFactory({
  defaultTag: reservationsTag,
  defaultCreateResponseSchema: reservationsCreatedSchema,
  defaultOkResponseSchema: reservationsOkSchema,
  makeListDescription: ({ pluralLower }) =>
    `Returns a paginated collection of ${pluralLower} in the current tenant and organization scope.`,
})

export function createReservationsCrudOpenApi(options: CrudOpenApiOptions): OpenApiRouteDoc {
  return buildReservationsCrudOpenApi(options)
}
