export type LinkedReservationLabel = {
  id: string | null
  bookingNumber: string | null
  destination: string | null
  href: string | null
}

type TicketLabelSource = {
  reservationId?: string | null
  reservationNumberSnapshot?: string | null
  customerPersonId?: string | null
} & Record<string, unknown>

type EnrichedReservation = {
  id: string | null
  bookingNumber: string | null
  destination: string | null
  customerPersonId: string | null
  customerName: string | null
}

function readTrimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

export function readEnrichedReservation(ticket: TicketLabelSource): EnrichedReservation | null {
  const namespace = ticket._reservations
  if (!namespace || typeof namespace !== 'object') return null
  const reservation = (namespace as { reservation?: unknown }).reservation
  if (!reservation || typeof reservation !== 'object') return null
  const record = reservation as Record<string, unknown>
  return {
    id: readTrimmed(record.id),
    bookingNumber: readTrimmed(record.bookingNumber),
    destination: readTrimmed(record.destination),
    customerPersonId: readTrimmed(record.customerPersonId),
    customerName: readTrimmed(record.customerName),
  }
}

export function reservationDetailPath(id: string): string {
  return `/backend/reservations/${encodeURIComponent(id)}`
}

export function customerDetailPath(id: string): string {
  return `/backend/customers/people-v2/${encodeURIComponent(id)}`
}

export function resolveReservationLabel(ticket: TicketLabelSource): LinkedReservationLabel | null {
  const reservationId = readTrimmed(ticket.reservationId)
  const snapshot = readTrimmed(ticket.reservationNumberSnapshot)
  const enriched = readEnrichedReservation(ticket)
  if (enriched && (!reservationId || enriched.id === reservationId)) {
    const id = enriched.id ?? reservationId
    return {
      id,
      bookingNumber: enriched.bookingNumber ?? snapshot ?? id,
      destination: enriched.destination,
      href: id ? reservationDetailPath(id) : null,
    }
  }
  if (!reservationId && !snapshot) return null
  return { id: reservationId, bookingNumber: snapshot ?? reservationId, destination: null, href: null }
}

export function resolveCustomerLabel(
  ticket: TicketLabelSource,
  personLabels: Record<string, string>,
): { id: string; label: string; href: string } | null {
  const personId = readTrimmed(ticket.customerPersonId)
  if (!personId) return null
  const enriched = readEnrichedReservation(ticket)
  const reservationCustomerName = enriched?.customerPersonId === personId ? enriched.customerName : null
  return {
    id: personId,
    label: personLabels[personId] ?? reservationCustomerName ?? personId,
    href: customerDetailPath(personId),
  }
}
