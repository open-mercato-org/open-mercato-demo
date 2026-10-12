const IBAN_CANDIDATE = /\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]){11,30}\b/gi

export function containsIban(text: string | null | undefined): boolean {
  if (!text) return false
  for (const match of text.matchAll(IBAN_CANDIDATE)) {
    const compact = match[0].replace(/\s+/g, '')
    if (compact.length >= 15 && compact.length <= 34 && /\d{6,}/.test(compact.slice(4))) return true
  }
  return false
}

export function maskBankAccount(value: string | null | undefined): string | null {
  if (!value) return null
  const compact = value.replace(/\s+/g, '')
  if (compact.length <= 4) return '••••'
  return `${compact.slice(0, 2)}•• •••• ${compact.slice(-4)}`
}
