import type { EntityManager } from '@mikro-orm/postgresql'
import type { EnricherContext, ResponseEnricher } from '@open-mercato/shared/lib/crud/response-enricher'
import { TicketTriage } from './entities'
import { toTriageView, type TriageView } from '../lib/projection'

type TicketRecord = Record<string, unknown> & { id: string }

type TriageEnrichment = {
  _triage: TriageView | null
}

function resolveEm(context: EnricherContext): EntityManager | null {
  const em = context.em as EntityManager | null | undefined
  return em && typeof em.find === 'function' ? em : null
}

export async function enrichTicketsWithTriage(
  records: TicketRecord[],
  context: EnricherContext,
): Promise<Array<TicketRecord & TriageEnrichment>> {
  const ids = Array.from(new Set(records.map((record) => record.id).filter((id): id is string => typeof id === 'string')))
  const em = resolveEm(context)
  if (!em || ids.length === 0) return records.map((record) => ({ ...record, _triage: null }))
  const rows = await em.fork().find(TicketTriage, {
    ticketId: { $in: ids },
    tenantId: context.tenantId,
    organizationId: context.organizationId,
  })
  const byTicket = new Map(rows.map((row) => [row.ticketId, toTriageView(row)]))
  return records.map((record) => ({ ...record, _triage: byTicket.get(record.id) ?? null }))
}

export const ticketTriageEnricher: ResponseEnricher<TicketRecord, TriageEnrichment> = {
  id: 'triage_agents.ticket-triage',
  targetEntity: 'tickets.ticket',
  features: ['triage_agents.view'],
  priority: 10,
  timeout: 1500,
  fallback: { _triage: null },
  critical: false,
  cacheableOnListHit: false,

  async enrichOne(record, context) {
    const [enriched] = await enrichTicketsWithTriage([record], context)
    return enriched
  },

  async enrichMany(records, context) {
    return enrichTicketsWithTriage(records, context)
  },
}

export const enrichers: ResponseEnricher[] = [ticketTriageEnricher]
