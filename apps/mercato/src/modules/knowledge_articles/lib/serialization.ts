export function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

export function readString(record: Record<string, unknown>, snakeKey: string, camelKey: string = snakeKey): string | null {
  const value = record[snakeKey] ?? record[camelKey]
  return typeof value === 'string' ? value : null
}

export function readNumber(record: Record<string, unknown>, snakeKey: string, camelKey: string = snakeKey): number {
  const value = record[snakeKey] ?? record[camelKey]
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim().length) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

export function readBoolean(record: Record<string, unknown>, snakeKey: string, camelKey: string = snakeKey): boolean {
  const value = record[snakeKey] ?? record[camelKey]
  return value === true || value === 'true' || value === 't'
}

export function readJsonArray(record: Record<string, unknown>, snakeKey: string, camelKey: string = snakeKey): unknown[] {
  const value = record[snakeKey] ?? record[camelKey]
  if (Array.isArray(value)) return value
  if (typeof value === 'string' && value.trim().startsWith('[')) {
    try {
      const parsed: unknown = JSON.parse(value)
      return Array.isArray(parsed) ? parsed : []
    } catch {
      return []
    }
  }
  return []
}

export function readStringArray(record: Record<string, unknown>, snakeKey: string, camelKey: string = snakeKey): string[] {
  const value = record[snakeKey] ?? record[camelKey]
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string')
  if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
    const inner = value.slice(1, -1)
    if (!inner.length) return []
    return inner.split(',').map((entry) => entry.replace(/^"|"$/g, ''))
  }
  return []
}

export function toIso(value: unknown): string | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'string' || typeof value === 'number') {
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
  }
  return null
}
