import { z } from 'zod'
import {
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  REFUND_TRANSITION_TARGETS,
  RESERVATION_STATUSES,
} from './constants'

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
const currencyCode = z
  .string()
  .trim()
  .length(3)
  .transform((value) => value.toUpperCase())
const amount = z.coerce.number().finite().positive().max(999_999_999_999)
const optionalText = (max: number) => z.string().trim().max(max).optional().nullable()

const reservationBaseShape = {
  bookingNumber: z.string().trim().min(1).max(64),
  customerPersonId: z.string().uuid(),
  customerEmail: z.string().trim().email().max(320).optional().nullable(),
  customerName: optionalText(200),
  status: z.enum(RESERVATION_STATUSES).optional(),
  destination: z.string().trim().min(1).max(200),
  hotelName: z.string().trim().min(1).max(200),
  roomType: optionalText(120),
  boardType: optionalText(120),
  departureDate: dateOnly,
  returnDate: dateOnly,
  travelersCount: z.coerce.number().int().min(1).max(99).optional(),
  totalPriceAmount: z.coerce.number().finite().min(0).max(999_999_999_999),
  currencyCode: currencyCode.optional(),
  notes: optionalText(4000),
}

export const reservationCreateSchema = z
  .object({ id: z.string().uuid().optional(), ...reservationBaseShape })
  .refine((value) => value.returnDate >= value.departureDate, {
    message: 'reservations.errors.returnBeforeDeparture',
    path: ['returnDate'],
  })

export const reservationUpdateSchema = z
  .object({ id: z.string().uuid(), ...reservationBaseShape })
  .partial()
  .required({ id: true })
  .refine(
    (value) => !value.departureDate || !value.returnDate || value.returnDate >= value.departureDate,
    { message: 'reservations.errors.returnBeforeDeparture', path: ['returnDate'] },
  )

export const reservationDeleteSchema = z.object({ id: z.string().uuid() })

export const paymentRecordSchema = z.object({
  reservationId: z.string().uuid(),
  amount,
  currencyCode: currencyCode.optional(),
  status: z.enum(PAYMENT_STATUSES).optional(),
  method: z.enum(PAYMENT_METHODS).optional(),
  paidAt: z.coerce.date().optional().nullable(),
  bookedAt: z.coerce.date().optional().nullable(),
  externalReference: optionalText(200),
})

export const refundRequestSchema = z.object({
  reservationId: z.string().uuid(),
  amount,
  currencyCode: currencyCode.optional(),
  bankAccountNumber: z.string().trim().min(8).max(64),
  reason: optionalText(2000),
  sourceType: z.string().trim().max(64).optional().nullable(),
  sourceRef: z.string().trim().max(200).optional().nullable(),
  relatedTicketId: z.string().uuid().optional().nullable(),
})

export const refundTransitionSchema = z.object({
  id: z.string().uuid(),
  to: z.enum(REFUND_TRANSITION_TARGETS),
  reason: optionalText(2000),
})

export type ReservationCreateInput = z.infer<typeof reservationCreateSchema>
export type ReservationUpdateInput = z.infer<typeof reservationUpdateSchema>
export type ReservationDeleteInput = z.infer<typeof reservationDeleteSchema>
export type PaymentRecordInput = z.infer<typeof paymentRecordSchema>
export type RefundRequestInput = z.infer<typeof refundRequestSchema>
export type RefundTransitionInput = z.infer<typeof refundTransitionSchema>
