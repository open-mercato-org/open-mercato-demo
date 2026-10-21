import type { QueryEngine } from '@open-mercato/shared/lib/query/types'
import { createLogger } from '@open-mercato/shared/lib/logger'
import { reportError } from '@open-mercato/telemetry'
import { TICKET_ENTITY_TYPE } from '../data/constants'
import type { TriageScope } from './kbArticles'

const logger = createLogger('triage_agents').child({ component: 'ticketPresence' })

type ResolverLike = { resolve: <T = unknown>(name: string) => T }

/**
 * Returns the subset of the given ticket ids that still exist (not soft-deleted) in the
 * scope, or `null` when that cannot be determined — callers then keep every id.
 */
export type TicketPresenceReader = (scope: TriageScope, ticketIds: string[]) => Promise<Set<string> | null>

const PRESENCE_PAGE_SIZE = 100

/**
 * Soft-optional presence check through the query engine (`tickets:ticket` addressed by
 * entity id, soft-deleted rows excluded by default) — no ORM import from the tickets module.
 */
export function resolveTicketPresenceReader(container: ResolverLike): TicketPresenceReader | null {
  let queryEngine: QueryEngine
  try {
    queryEngine = container.resolve<QueryEngine>('queryEngine')
  } catch {
    return null
  }
  return async (scope, ticketIds) => {
    const unique = Array.from(new Set(ticketIds.filter((id) => typeof id === 'string' && id.length > 0)))
    const present = new Set<string>()
    if (unique.length === 0) return present
    try {
      for (let offset = 0; offset < unique.length; offset += PRESENCE_PAGE_SIZE) {
        const chunk = unique.slice(offset, offset + PRESENCE_PAGE_SIZE)
        const result = await queryEngine.query<Record<string, unknown>>(TICKET_ENTITY_TYPE, {
          tenantId: scope.tenantId,
          organizationId: scope.organizationId,
          fields: ['id'],
          filters: { id: { $in: chunk } },
          page: { page: 1, pageSize: chunk.length },
        })
        for (const item of result.items ?? []) {
          if (typeof item?.id === 'string') present.add(item.id)
        }
      }
      return present
    } catch (err) {
      logger.warn('Ticket presence lookup unavailable', { error: err instanceof Error ? err.message : String(err) })
      reportError(err, { module: 'triage_agents', code: 'triage_agents.ticket_presence_lookup_failed' })
      return null
    }
  }
}
