/** @jest-environment node */
import {
  appendTicketNumberToken,
  buildReplySubject,
  collectReferenceMessageIds,
  extractTicketNumberToken,
  matchThread,
  normalizeMessageId,
  type ThreadLookups,
} from '../lib/threadMatcher'

function lookups(overrides: Partial<{ byMessage: Record<string, string>; byNumber: Record<string, string> }> = {}) {
  const byMessage = overrides.byMessage ?? {}
  const byNumber = overrides.byNumber ?? {}
  const calls = { messageIds: [] as string[][], numbers: [] as string[] }
  const api: ThreadLookups = {
    findTicketIdByMessageIds: async (ids) => {
      calls.messageIds.push(ids)
      for (const id of ids) if (byMessage[id]) return byMessage[id]
      return null
    },
    findTicketIdByNumber: async (number) => {
      calls.numbers.push(number)
      return byNumber[number] ?? null
    },
  }
  return { api, calls }
}

describe('thread matcher', () => {
  it('extracts the [TCK-…] subject token', () => {
    expect(extractTicketNumberToken('Re: Refund please [TCK-000123]')).toBe('TCK-000123')
    expect(extractTicketNumberToken('re: [tck-42] hello')).toBe('TCK-42')
    expect(extractTicketNumberToken('TCK-000123 without brackets')).toBeNull()
    expect(extractTicketNumberToken(null)).toBeNull()
  })

  it('normalizes message ids and collects references', () => {
    expect(normalizeMessageId('abc@example.com')).toBe('<abc@example.com>')
    expect(normalizeMessageId(' <abc@example.com> ')).toBe('<abc@example.com>')
    expect(normalizeMessageId('')).toBeNull()
    expect(collectReferenceMessageIds({
      inReplyTo: '<b@x>',
      references: ['<a@x> <b@x>', 'c@x'],
    })).toEqual(['<b@x>', '<a@x>', '<c@x>'])
    expect(collectReferenceMessageIds({ inReplyTo: null, references: '<a@x>\n <z@x>' })).toEqual(['<a@x>', '<z@x>'])
  })

  it('matches by In-Reply-To / References first', async () => {
    const { api, calls } = lookups({ byMessage: { '<a@x>': 'ticket-1' }, byNumber: { 'TCK-000002': 'ticket-2' } })
    const match = await matchThread({ subject: 'Re: [TCK-000002]', inReplyTo: '<a@x>' }, api)
    expect(match).toEqual({ kind: 'message', ticketId: 'ticket-1' })
    expect(calls.numbers).toEqual([])
  })

  it('falls back to the subject token', async () => {
    const { api } = lookups({ byNumber: { 'TCK-000002': 'ticket-2' } })
    const match = await matchThread({ subject: 'Re: hello [TCK-000002]', inReplyTo: '<unknown@x>' }, api)
    expect(match).toEqual({ kind: 'token', ticketId: 'ticket-2' })
  })

  it('creates a new thread when nothing matches', async () => {
    const { api, calls } = lookups()
    const match = await matchThread({ subject: 'New question', inReplyTo: null, references: null }, api)
    expect(match).toEqual({ kind: 'new', ticketId: null })
    expect(calls.messageIds).toEqual([])
  })

  it('builds reply subjects that keep the token', () => {
    expect(buildReplySubject('Refund', 'TCK-000001')).toBe('Re: Refund [TCK-000001]')
    expect(buildReplySubject('RE: Refund [TCK-000001]', 'TCK-000001')).toBe('RE: Refund [TCK-000001]')
    expect(appendTicketNumberToken('Hello', 'TCK-000009')).toBe('Hello [TCK-000009]')
  })
})
