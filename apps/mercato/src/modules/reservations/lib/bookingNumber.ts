export const BOOKING_NUMBER_MAX_LENGTH = 32

export function normalizeBookingNumber(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[^0-9a-z]/gi, '').toUpperCase().slice(0, BOOKING_NUMBER_MAX_LENGTH)
}

export function isValidBookingNumber(raw: string | null | undefined): boolean {
  return normalizeBookingNumber(raw).length > 0
}
