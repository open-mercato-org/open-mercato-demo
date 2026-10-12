const DAY_MS = 24 * 60 * 60 * 1000

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

export function toDateOnlyString(value: unknown): string | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null
    const isUtcMidnight =
      value.getUTCHours() === 0 &&
      value.getUTCMinutes() === 0 &&
      value.getUTCSeconds() === 0 &&
      value.getUTCMilliseconds() === 0
    if (isUtcMidnight) {
      return `${value.getUTCFullYear()}-${pad(value.getUTCMonth() + 1)}-${pad(value.getUTCDate())}`
    }
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`
  }
  if (typeof value === 'string') {
    const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim())
    return match ? match[1] : null
  }
  return null
}

export function resolveReservationsTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    return 'UTC'
  }
}

export function todayInTimeZone(now: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(now)
    const year = parts.find((part) => part.type === 'year')?.value
    const month = parts.find((part) => part.type === 'month')?.value
    const day = parts.find((part) => part.type === 'day')?.value
    if (year && month && day) return `${year}-${month}-${day}`
  } catch {
    return now.toISOString().slice(0, 10)
  }
  return now.toISOString().slice(0, 10)
}

function dateOnlyToUtcMs(value: string): number {
  const [year, month, day] = value.split('-').map((part) => Number(part))
  return Date.UTC(year, month - 1, day)
}

export function diffDays(fromDate: string, toDate: string): number {
  return Math.round((dateOnlyToUtcMs(toDate) - dateOnlyToUtcMs(fromDate)) / DAY_MS)
}

export function computeDaysToDeparture(
  departureDate: unknown,
  now: Date = new Date(),
  timeZone: string = resolveReservationsTimeZone(),
): number | null {
  const departure = toDateOnlyString(departureDate)
  if (!departure) return null
  return diffDays(todayInTimeZone(now, timeZone), departure)
}

export function addDaysToDateOnly(base: string, days: number): string {
  const shifted = new Date(dateOnlyToUtcMs(base) + days * DAY_MS)
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`
}
