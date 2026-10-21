const IBAN_LENGTHS: Readonly<Record<string, number>> = {
  AD: 24, AE: 23, AL: 28, AT: 20, AZ: 28, BA: 20, BE: 16, BG: 22, BH: 22, BR: 29,
  BY: 28, CH: 21, CR: 22, CY: 28, CZ: 24, DE: 22, DK: 18, DO: 28, EE: 20, EG: 29,
  ES: 24, FI: 18, FO: 18, FR: 27, GB: 22, GE: 22, GI: 23, GL: 18, GR: 27, GT: 28,
  HR: 21, HU: 28, IE: 22, IL: 23, IQ: 23, IS: 26, IT: 27, JO: 30, KW: 30, KZ: 20,
  LB: 28, LC: 32, LI: 21, LT: 20, LU: 20, LV: 21, MC: 27, MD: 24, ME: 22, MK: 19,
  MR: 27, MT: 31, MU: 30, NL: 18, NO: 15, PK: 24, PL: 28, PS: 29, PT: 25, QA: 29,
  RO: 24, RS: 22, SA: 24, SC: 31, SE: 24, SI: 19, SK: 24, SM: 27, ST: 25, SV: 28,
  TL: 23, TN: 24, TR: 26, UA: 29, VA: 22, VG: 24, XK: 20,
}

export function normalizeIban(raw: string | null | undefined): string {
  if (typeof raw !== 'string') return ''
  return raw.replace(/[\s-]/g, '').toUpperCase()
}

function mod97(numeric: string): number {
  let remainder = 0
  for (let index = 0; index < numeric.length; index += 7) {
    remainder = Number(`${remainder}${numeric.slice(index, index + 7)}`) % 97
  }
  return remainder
}

export function isValidIban(raw: string | null | undefined): boolean {
  const iban = normalizeIban(raw)
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(iban)) return false
  const expectedLength = IBAN_LENGTHS[iban.slice(0, 2)]
  if (expectedLength !== undefined && iban.length !== expectedLength) return false
  const rearranged = `${iban.slice(4)}${iban.slice(0, 4)}`
  const numeric = rearranged.replace(/[A-Z]/g, (letter) => String(letter.charCodeAt(0) - 55))
  return mod97(numeric) === 1
}

export function ibanLast4(raw: string | null | undefined): string {
  return normalizeIban(raw).slice(-4)
}

export function maskIban(raw: string | null | undefined): string {
  const iban = normalizeIban(raw)
  if (iban.length <= 6) return iban
  return `${iban.slice(0, 2)}${'*'.repeat(Math.max(iban.length - 6, 0))}${iban.slice(-4)}`
}
