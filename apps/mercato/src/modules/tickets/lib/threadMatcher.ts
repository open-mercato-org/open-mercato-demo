const TICKET_TOKEN_PATTERN = /\[(TCK-\d{1,9})\]/i
const MESSAGE_ID_PATTERN = /<[^<>\s]+>/g
const MAX_REFERENCE_IDS = 50

export type ThreadMatchInput = {
  subject?: string | null
  inReplyTo?: string | null
  references?: readonly string[] | string | null
}

export type ThreadLookups = {
  findTicketIdByMessageIds: (messageIds: string[]) => Promise<string | null>
  findTicketIdByNumber: (number: string) => Promise<string | null>
}

export type ThreadMatch =
  | { kind: 'message'; ticketId: string }
  | { kind: 'token'; ticketId: string }
  | { kind: 'new'; ticketId: null }

export function extractTicketNumberToken(subject: string | null | undefined): string | null {
  if (!subject) return null
  const match = TICKET_TOKEN_PATTERN.exec(subject)
  return match ? match[1].toUpperCase() : null
}

export function appendTicketNumberToken(subject: string, number: string): string {
  const token = `[${number}]`
  if (subject.toUpperCase().includes(token.toUpperCase())) return subject.trim()
  return `${subject.trim()} ${token}`.trim()
}

export function buildReplySubject(subject: string, number: string): string {
  const trimmed = subject.trim()
  const prefixed = /^re:/i.test(trimmed) ? trimmed : `Re: ${trimmed}`
  return appendTicketNumberToken(prefixed, number)
}

export function normalizeMessageId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) return trimmed
  const bare = trimmed.replace(/^<|>$/g, '')
  return bare ? `<${bare}>` : null
}

function splitReferenceValue(value: string): string[] {
  const bracketed = value.match(MESSAGE_ID_PATTERN)
  if (bracketed && bracketed.length) return bracketed
  return value.split(/[\s,]+/).filter(Boolean)
}

export function collectReferenceMessageIds(input: Pick<ThreadMatchInput, 'inReplyTo' | 'references'>): string[] {
  const raw: string[] = []
  if (input.inReplyTo) raw.push(...splitReferenceValue(input.inReplyTo))
  const references = input.references
  if (typeof references === 'string') {
    raw.push(...splitReferenceValue(references))
  } else if (Array.isArray(references)) {
    for (const entry of references) {
      if (typeof entry === 'string') raw.push(...splitReferenceValue(entry))
    }
  }
  const unique = new Set<string>()
  for (const entry of raw) {
    const normalized = normalizeMessageId(entry)
    if (normalized) unique.add(normalized)
    if (unique.size >= MAX_REFERENCE_IDS) break
  }
  return Array.from(unique)
}

export async function matchThread(input: ThreadMatchInput, lookups: ThreadLookups): Promise<ThreadMatch> {
  const messageIds = collectReferenceMessageIds(input)
  if (messageIds.length) {
    const ticketId = await lookups.findTicketIdByMessageIds(messageIds)
    if (ticketId) return { kind: 'message', ticketId }
  }
  const token = extractTicketNumberToken(input.subject)
  if (token) {
    const ticketId = await lookups.findTicketIdByNumber(token)
    if (ticketId) return { kind: 'token', ticketId }
  }
  return { kind: 'new', ticketId: null }
}
