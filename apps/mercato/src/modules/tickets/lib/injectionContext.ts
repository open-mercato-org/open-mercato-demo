function readTrimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function resolveResourceId(context: unknown, resourceKind: string, explicitKey: string): string | null {
  if (!context || typeof context !== 'object') return null
  const candidate = context as Record<string, unknown>
  if (candidate.resourceKind !== resourceKind) return null
  return readTrimmed(candidate[explicitKey]) ?? readTrimmed(candidate.resourceId)
}

export function resolvePersonId(context: unknown): string | null {
  return resolveResourceId(context, 'customers.person', 'personId')
}

export function resolveReservationId(context: unknown): string | null {
  return resolveResourceId(context, 'reservations.reservation', 'reservationId')
}
