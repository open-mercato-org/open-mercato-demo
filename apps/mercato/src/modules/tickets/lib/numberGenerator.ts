import type { EntityManager } from '@mikro-orm/postgresql'
import { TICKET_NUMBER_PREFIX } from '../data/constants'

type Scope = {
  organizationId: string
  tenantId: string
}

const MAX_SEQUENCE = 999_999_999
const DEFAULT_SEQUENCE_START = 1
const NUMBER_PAD_LENGTH = 6

export function formatTicketNumber(sequence: number): string {
  return `${TICKET_NUMBER_PREFIX}-${String(sequence).padStart(NUMBER_PAD_LENGTH, '0')}`
}

export function parseTicketNumber(value: string): number | null {
  const match = /^TCK-(\d{1,9})$/i.exec(value.trim())
  if (!match) return null
  const parsed = Number(match[1])
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

export function normalizeSequenceValue(raw: unknown): number {
  const value = Number(raw ?? DEFAULT_SEQUENCE_START)
  if (!Number.isFinite(value) || value < DEFAULT_SEQUENCE_START) return DEFAULT_SEQUENCE_START
  return Math.min(Math.floor(value), MAX_SEQUENCE)
}

export class TicketNumberGenerator {
  constructor(private readonly em: EntityManager) {}

  async ensureSequence(scope: Scope): Promise<void> {
    await this.em.getConnection().execute(
      `
        insert into ticket_sequences (id, organization_id, tenant_id, next_number, created_at, updated_at)
        values (gen_random_uuid(), ?, ?, ?, now(), now())
        on conflict (tenant_id, organization_id) do nothing
      `,
      [scope.organizationId, scope.tenantId, DEFAULT_SEQUENCE_START],
    )
  }

  async generate(scope: Scope): Promise<{ number: string; sequence: number }> {
    const rows = await this.em.getConnection().execute<{ sequence: string }[]>(
      `
        insert into ticket_sequences (id, organization_id, tenant_id, next_number, created_at, updated_at)
        values (gen_random_uuid(), ?, ?, ?, now(), now())
        on conflict (tenant_id, organization_id)
        do update set next_number = ticket_sequences.next_number + 1, updated_at = now()
        returning next_number - 1 as sequence
      `,
      [scope.organizationId, scope.tenantId, DEFAULT_SEQUENCE_START + 1],
    )
    const sequence = normalizeSequenceValue(rows?.[0]?.sequence)
    return { number: formatTicketNumber(sequence), sequence }
  }
}
