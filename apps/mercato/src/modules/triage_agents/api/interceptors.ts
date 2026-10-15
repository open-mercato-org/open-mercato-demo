import type { EntityManager } from '@mikro-orm/postgresql'
import type { ApiInterceptor } from '@open-mercato/shared/lib/crud/api-interceptor'
import { findTicketIdsAwaitingDecision, isAwaitingDecisionRequested, narrowQueryToTicketIds } from '../lib/awaitingDecision'

export const interceptors: ApiInterceptor[] = [
  {
    id: 'triage_agents.tickets-awaiting-decision',
    targetRoute: 'tickets/tickets',
    methods: ['GET'],
    priority: 50,
    features: ['triage_agents.view'],
    async before(request, context) {
      const query = request.query ?? {}
      if (!isAwaitingDecisionRequested(query)) return { ok: true }
      const ticketIds = context.tenantId && context.organizationId
        ? await findTicketIdsAwaitingDecision((context.em as EntityManager).fork(), {
            tenantId: context.tenantId,
            organizationId: context.organizationId,
          })
        : []
      return { ok: true, query: narrowQueryToTicketIds(query, ticketIds) }
    },
  },
]

export default interceptors
