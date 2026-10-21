import { addDaysToDateOnly, computeDaysToDeparture, toDateOnlyString, todayInTimeZone } from '../lib/dates'
import { computeSeedDates, DEMO_RESERVATIONS } from '../lib/seeds'

describe('reservation dates', () => {
  it('computes days to departure in the given time zone around midnight', () => {
    const justBeforeMidnightUtc = new Date('2026-10-12T23:30:00Z')
    expect(computeDaysToDeparture('2026-10-15', justBeforeMidnightUtc, 'UTC')).toBe(3)
    expect(computeDaysToDeparture('2026-10-15', justBeforeMidnightUtc, 'Europe/Warsaw')).toBe(2)
    expect(computeDaysToDeparture('2026-10-15', new Date('2026-10-13T03:00:00Z'), 'America/New_York')).toBe(3)
  })

  it('returns negative values after departure and null for missing dates', () => {
    expect(computeDaysToDeparture('2026-10-01', new Date('2026-10-12T12:00:00Z'), 'UTC')).toBe(-11)
    expect(computeDaysToDeparture(null, new Date(), 'UTC')).toBeNull()
  })

  it('normalizes date-only values from strings and Date objects', () => {
    expect(toDateOnlyString('2026-10-15')).toBe('2026-10-15')
    expect(toDateOnlyString('2026-10-15T00:00:00.000Z')).toBe('2026-10-15')
    expect(toDateOnlyString(new Date(Date.UTC(2026, 9, 15)))).toBe('2026-10-15')
    expect(toDateOnlyString(new Date(2026, 9, 15))).toBe('2026-10-15')
    expect(toDateOnlyString('not a date')).toBeNull()
  })

  it('adds days across month boundaries', () => {
    expect(addDaysToDateOnly('2026-10-30', 3)).toBe('2026-11-02')
    expect(addDaysToDateOnly('2026-03-01', -1)).toBe('2026-02-28')
    expect(todayInTimeZone(new Date('2026-10-12T23:30:00Z'), 'Europe/Warsaw')).toBe('2026-10-13')
  })

  it('anchors the ABC123 demo reservation three days from today', () => {
    const abc = DEMO_RESERVATIONS.find((seed) => seed.bookingNumber === 'ABC123')
    expect(abc).toBeDefined()
    const dates = computeSeedDates(abc!, '2026-10-12')
    expect(dates).toEqual({ departureDate: '2026-10-15', returnDate: '2026-10-22' })
    const paid = abc!.payments.filter((payment) => payment.status === 'booked').reduce((sum, payment) => sum + payment.amount, 0)
    expect(abc!.totalPrice).toBe(2400)
    expect(paid - abc!.totalPrice).toBe(350)
  })
})
