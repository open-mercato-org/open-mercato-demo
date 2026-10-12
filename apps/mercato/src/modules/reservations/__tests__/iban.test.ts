import { ibanLast4, isValidIban, maskIban, normalizeIban } from '../lib/iban'

describe('IBAN helpers', () => {
  it('accepts valid IBANs with or without spaces', () => {
    expect(isValidIban('DE89 3704 0044 0532 0130 00')).toBe(true)
    expect(isValidIban('DE89370400440532013000')).toBe(true)
    expect(isValidIban('GB29 NWBK 6016 1331 9268 19')).toBe(true)
    expect(isValidIban('PL61 1090 1014 0000 0712 1981 2874')).toBe(true)
    expect(isValidIban('de89370400440532013000')).toBe(true)
  })

  it('rejects IBANs with a wrong checksum', () => {
    expect(isValidIban('DE88 3704 0044 0532 0130 00')).toBe(false)
    expect(isValidIban('DE89 3704 0044 0532 0130 01')).toBe(false)
  })

  it('rejects malformed input and wrong country lengths', () => {
    expect(isValidIban('')).toBe(false)
    expect(isValidIban(null)).toBe(false)
    expect(isValidIban('1234567890')).toBe(false)
    expect(isValidIban('DE89 3704 0044 0532 0130')).toBe(false)
  })

  it('normalizes, masks and extracts the last four digits', () => {
    expect(normalizeIban('de89 3704-0044')).toBe('DE8937040044')
    expect(ibanLast4('DE89 3704 0044 0532 0130 00')).toBe('3000')
    const masked = maskIban('DE89 3704 0044 0532 0130 00')
    expect(masked.startsWith('DE')).toBe(true)
    expect(masked.endsWith('3000')).toBe(true)
    expect(masked).not.toContain('3704')
  })
})
