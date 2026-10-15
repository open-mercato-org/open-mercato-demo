const findWithDecryptionMock = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryptionMock(...args),
}))
jest.mock('@open-mercato/enterprise/modules/agent_orchestrator/data/entities', () => ({
  AgentProposal: class AgentProposal {},
}))
jest.mock('../data/entities', () => ({ TicketTriage: class TicketTriage {} }))

import type { EntityManager } from '@mikro-orm/postgresql'
import type { InterceptorContext } from '@open-mercato/shared/lib/crud/api-interceptor'
import { buildTicketQueueHref } from '../../tickets/components/queueUrlState'
import {
  AWAITING_DECISION_FEATURES,
  AWAITING_DECISION_FILTER_ID,
  AWAITING_DECISION_FILTER_VALUE,
  AWAITING_DECISION_HREF,
} from '../data/constants'
import {
  findTicketIdsAwaitingDecision,
  isAwaitingDecisionRequested,
  narrowQueryToTicketIds,
} from '../lib/awaitingDecision'
import {
  formatAwaitingDecisionCount,
  isAwaitingDecisionActive,
  toggleAwaitingDecisionHref,
} from '../components/awaitingDecisionLink'
import { interceptors } from '../api/interceptors'
import menuWidget from '../widgets/injection/awaiting-decision-menu/widget'

const SCOPE = { tenantId: 'tenant-1', organizationId: 'org-1' }
const T1 = '11111111-1111-4111-8111-111111111111'
const T2 = '22222222-2222-4222-8222-222222222222'
const T3 = '33333333-3333-4333-8333-333333333333'

function mockTriagesAndProposals(triages: Array<{ ticketId: string; proposalId: string | null }>, pendingProposalIds: string[]) {
  findWithDecryptionMock.mockImplementation(async (_em: unknown, entity: { name: string }) => {
    if (entity.name === 'TicketTriage') return triages
    return pendingProposalIds.map((id) => ({ id }))
  })
}

beforeEach(() => {
  findWithDecryptionMock.mockReset()
})

describe('findTicketIdsAwaitingDecision', () => {
  it('returns tickets whose triage awaits approval and whose proposal is still pending', async () => {
    mockTriagesAndProposals(
      [
        { ticketId: T1, proposalId: 'p1' },
        { ticketId: T2, proposalId: 'p2' },
        { ticketId: T3, proposalId: null },
      ],
      ['p1'],
    )
    const ids = await findTicketIdsAwaitingDecision({} as EntityManager, SCOPE)
    expect(ids).toEqual([T1])
    const [, , triageWhere] = findWithDecryptionMock.mock.calls[0]
    expect(triageWhere).toMatchObject({ ...SCOPE, stage: 'awaiting_approval', disposition: null })
    const [, , proposalWhere] = findWithDecryptionMock.mock.calls[1]
    expect(proposalWhere).toMatchObject({ ...SCOPE, disposition: 'pending', deletedAt: null, id: { $in: ['p1', 'p2'] } })
  })

  it('skips the proposal lookup when no triage awaits approval', async () => {
    mockTriagesAndProposals([], [])
    expect(await findTicketIdsAwaitingDecision({} as EntityManager, SCOPE)).toEqual([])
    expect(findWithDecryptionMock).toHaveBeenCalledTimes(1)
  })
})

describe('query narrowing', () => {
  it('recognises the awaiting-decision filter value only', () => {
    expect(isAwaitingDecisionRequested({ [AWAITING_DECISION_FILTER_ID]: AWAITING_DECISION_FILTER_VALUE })).toBe(true)
    expect(isAwaitingDecisionRequested({ [AWAITING_DECISION_FILTER_ID]: 'other' })).toBe(false)
    expect(isAwaitingDecisionRequested(undefined)).toBe(false)
  })

  it('writes the matched ids, intersects existing ids and drops the filter param', () => {
    expect(narrowQueryToTicketIds({ page: '1', [AWAITING_DECISION_FILTER_ID]: 'awaiting' }, [T1, T2])).toEqual({ page: '1', ids: `${T1},${T2}` })
    expect(narrowQueryToTicketIds({ ids: `${T2},${T3}` }, [T1, T2])).toEqual({ ids: T2 })
  })

  it('matches nothing (never everything) when no ticket awaits a decision', () => {
    const query = narrowQueryToTicketIds({ [AWAITING_DECISION_FILTER_ID]: 'awaiting' }, [])
    expect(query).toEqual({ ids: '00000000-0000-4000-8000-000000000000' })
    expect(narrowQueryToTicketIds({ ids: T3 }, [T1])).toEqual({ ids: '00000000-0000-4000-8000-000000000000' })
  })
})

describe('tickets list interceptor', () => {
  const interceptor = interceptors[0]
  const context = { tenantId: SCOPE.tenantId, organizationId: SCOPE.organizationId, em: { fork: () => ({}) } } as unknown as InterceptorContext

  it('targets the tickets list GET behind the triage view feature', () => {
    expect(interceptor.targetRoute).toBe('tickets/tickets')
    expect(interceptor.methods).toEqual(['GET'])
    expect(interceptor.features).toEqual(['triage_agents.view'])
  })

  it('leaves other list requests untouched', async () => {
    const result = await interceptor.before!({ method: 'GET', url: '/api/tickets/tickets', headers: {}, query: { page: '1' } }, context)
    expect(result).toEqual({ ok: true })
    expect(findWithDecryptionMock).not.toHaveBeenCalled()
  })

  it('narrows the list to tickets awaiting a decision', async () => {
    mockTriagesAndProposals([{ ticketId: T1, proposalId: 'p1' }], ['p1'])
    const result = await interceptor.before!(
      { method: 'GET', url: '/api/tickets/tickets', headers: {}, query: { page: '1', [AWAITING_DECISION_FILTER_ID]: 'awaiting' } },
      context,
    )
    expect(result).toEqual({ ok: true, query: { page: '1', ids: T1 } })
  })
})

describe('awaiting-decision links', () => {
  it('deep-links into the tickets queue through its generic URL filter params', () => {
    expect(AWAITING_DECISION_HREF).toBe(buildTicketQueueHref({ filters: { [AWAITING_DECISION_FILTER_ID]: AWAITING_DECISION_FILTER_VALUE } }))
  })

  it('toggles the preset while keeping the other queue params', () => {
    const inactive = new URLSearchParams('preset=urgent')
    expect(isAwaitingDecisionActive(inactive)).toBe(false)
    const on = toggleAwaitingDecisionHref('/backend/tickets', inactive)
    expect(on).toBe('/backend/tickets?preset=urgent&filter.triageDecision=awaiting')
    const active = new URLSearchParams(on.split('?')[1])
    expect(isAwaitingDecisionActive(active)).toBe(true)
    expect(toggleAwaitingDecisionHref('/backend/tickets', active)).toBe('/backend/tickets?preset=urgent')
  })

  it('caps the displayed count', () => {
    expect(formatAwaitingDecisionCount(3)).toBe('3')
    expect(formatAwaitingDecisionCount(140)).toBe('99+')
  })

  it('injects a Helpdesk sidebar entry gated like the decision itself', () => {
    const [item] = menuWidget.menuItems
    expect(item.href).toBe(AWAITING_DECISION_HREF)
    expect(item.groupId).toBe('tickets.nav.group')
    expect(item.features).toEqual([...AWAITING_DECISION_FEATURES])
    expect(menuWidget.metadata.features).toEqual([...AWAITING_DECISION_FEATURES])
  })
})
