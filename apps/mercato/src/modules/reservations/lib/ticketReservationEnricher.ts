import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import type { EnricherContext, ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { Reservation } from '../data/entities'
import { toDateOnlyString } from './dates'

export const TICKET_ENTITY_ID = 'tickets.ticket'
export const TICKET_RESERVATION_ENRICHER_ID = 'reservations.ticket-reservation'

export type TicketReservationLabel = {
  id: string
  bookingNumber: string
  destination: string
  hotelName: string
  status: string
  departureDate: string | null
  customerPersonId: string
  customerName: string | null
}

export type TicketReservationEnrichment = {
  _reservations: { reservation: TicketReservationLabel | null }
}

type TicketRecord = Record<string, unknown>

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function readTicketReservationId(record: TicketRecord): string | null {
  const value = record.reservationId ?? record.reservation_id
  return typeof value === 'string' && UUID_PATTERN.test(value) ? value : null
}

export function toTicketReservationLabel(reservation: Reservation): TicketReservationLabel {
  return {
    id: reservation.id,
    bookingNumber: reservation.bookingNumber,
    destination: reservation.destination,
    hotelName: reservation.hotelName,
    status: reservation.status,
    departureDate: toDateOnlyString(reservation.departureDate),
    customerPersonId: reservation.customerPersonId,
    customerName: reservation.customerNameSnapshot ?? null,
  }
}

export type ReservationLoader = (ids: string[], context: EnricherContext) => Promise<Reservation[]>

export const loadReservationsForEnricher: ReservationLoader = async (ids, context) => {
  if (!context.tenantId) return []
  const em = context.em as EntityManager
  const where: Record<string, unknown> = { id: { $in: ids }, tenantId: context.tenantId, deletedAt: null }
  if (context.organizationId) where.organizationId = context.organizationId
  return findWithDecryption(
    em.fork(),
    Reservation,
    where as FilterQuery<Reservation>,
    {},
    { tenantId: context.tenantId, organizationId: context.organizationId || null },
  )
}

export async function enrichTicketsWithReservations<T extends TicketRecord>(
  records: T[],
  context: EnricherContext,
  loader: ReservationLoader = loadReservationsForEnricher,
): Promise<Array<T & TicketReservationEnrichment>> {
  const ids = Array.from(new Set(records.map(readTicketReservationId).filter((id): id is string => Boolean(id))))
  const byId = new Map<string, TicketReservationLabel>()
  if (ids.length) {
    for (const reservation of await loader(ids, context)) {
      byId.set(reservation.id, toTicketReservationLabel(reservation))
    }
  }
  return records.map((record) => {
    const reservationId = readTicketReservationId(record)
    return { ...record, _reservations: { reservation: reservationId ? byId.get(reservationId) ?? null : null } }
  })
}

export const ticketReservationEnricher: ResponseEnricher<TicketRecord, TicketReservationEnrichment> = {
  id: TICKET_RESERVATION_ENRICHER_ID,
  targetEntity: TICKET_ENTITY_ID,
  features: ['reservations.view'],
  priority: 10,
  timeout: 2000,
  critical: false,
  fallback: { _reservations: { reservation: null } },
  async enrichOne(record, context) {
    const [enriched] = await enrichTicketsWithReservations([record], context)
    return enriched
  },
  async enrichMany(records, context) {
    return enrichTicketsWithReservations(records, context)
  },
}
