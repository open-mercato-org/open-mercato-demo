/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'
import {
  TicketNumberGenerator,
  formatTicketNumber,
  normalizeSequenceValue,
  parseTicketNumber,
} from '../lib/numberGenerator'

function fakeEm(rows: Array<{ sequence: string }>) {
  const execute = jest.fn(async () => rows)
  const em = { getConnection: () => ({ execute }) } as unknown as EntityManager
  return { em, execute }
}

describe('ticket number generator', () => {
  it('formats and parses TCK numbers', () => {
    expect(formatTicketNumber(1)).toBe('TCK-000001')
    expect(formatTicketNumber(123)).toBe('TCK-000123')
    expect(formatTicketNumber(1234567)).toBe('TCK-1234567')
    expect(parseTicketNumber('TCK-000123')).toBe(123)
    expect(parseTicketNumber('tck-7')).toBe(7)
    expect(parseTicketNumber('INV-1')).toBeNull()
  })

  it('normalizes sequence values', () => {
    expect(normalizeSequenceValue('5')).toBe(5)
    expect(normalizeSequenceValue(null)).toBe(1)
    expect(normalizeSequenceValue('-3')).toBe(1)
    expect(normalizeSequenceValue('abc')).toBe(1)
  })

  it('claims the next value atomically per scope', async () => {
    const { em, execute } = fakeEm([{ sequence: '42' }])
    const generator = new TicketNumberGenerator(em)
    const result = await generator.generate({ tenantId: 't-1', organizationId: 'o-1' })
    expect(result).toEqual({ number: 'TCK-000042', sequence: 42 })
    const [sql, params] = execute.mock.calls[0] as unknown as [string, unknown[]]
    expect(sql).toContain('on conflict (tenant_id, organization_id)')
    expect(params).toEqual(['o-1', 't-1', 2])
  })

  it('seeds the sequence idempotently', async () => {
    const { em, execute } = fakeEm([])
    await new TicketNumberGenerator(em).ensureSequence({ tenantId: 't-1', organizationId: 'o-1' })
    const [sql] = execute.mock.calls[0] as unknown as [string]
    expect(sql).toContain('do nothing')
  })
})
