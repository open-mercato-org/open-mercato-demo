import { isValidBookingNumber, normalizeBookingNumber } from '../lib/bookingNumber'

describe('normalizeBookingNumber', () => {
  it.each([
    ['ABC123', 'ABC123'],
    ['abc123', 'ABC123'],
    ['ABC-123', 'ABC123'],
    [' abc 123 ', 'ABC123'],
    ['#abc/123.', 'ABC123'],
  ])('normalizes %p to %p', (raw, expected) => {
    expect(normalizeBookingNumber(raw)).toBe(expected)
  })

  it('returns an empty string for blank or non-alphanumeric input', () => {
    expect(normalizeBookingNumber('')).toBe('')
    expect(normalizeBookingNumber('---')).toBe('')
    expect(normalizeBookingNumber(null)).toBe('')
    expect(normalizeBookingNumber(undefined)).toBe('')
  })

  it('caps the normalized value at 32 characters', () => {
    expect(normalizeBookingNumber('a'.repeat(40))).toHaveLength(32)
  })

  it('reports validity based on the normalized value', () => {
    expect(isValidBookingNumber('abc-123')).toBe(true)
    expect(isValidBookingNumber(' - ')).toBe(false)
  })
})
