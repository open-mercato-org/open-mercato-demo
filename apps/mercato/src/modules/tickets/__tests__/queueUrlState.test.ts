import {
  buildTicketQueueHref,
  parseQueueUrlState,
  serializeQueueUrlState,
} from '../components/queueUrlState'
import { buildQueueQueryParams } from '../components/TicketsQueueTable'

jest.mock('@open-mercato/ui/backend/DataTable', () => ({ DataTable: () => null }))
jest.mock('@open-mercato/ui/backend/RowActions', () => ({ RowActions: () => null }))
jest.mock('@open-mercato/ui/backend/detail', () => ({ ErrorMessage: () => null }))

describe('tickets queue URL state', () => {
  it('reads the preset and filter values from the URL', () => {
    const state = parseQueueUrlState(
      new URLSearchParams('preset=urgent&filter.queueKey=billing&filter.status[]=new&filter.status[]=open&filter.needsManualReview=true&other=x'),
    )
    expect(state).toEqual({
      preset: 'urgent',
      filters: { queueKey: 'billing', status: ['new', 'open'], needsManualReview: true },
    })
  })

  it('falls back to the "all" preset and ignores unknown presets and empty values', () => {
    expect(parseQueueUrlState(new URLSearchParams('preset=bogus&filter.queueKey=&filter.=x'))).toEqual({ preset: 'all', filters: {} })
    expect(parseQueueUrlState(null)).toEqual({ preset: 'all', filters: {} })
  })

  it('round-trips through serialize and keeps params it does not own', () => {
    const state = { preset: 'mine' as const, filters: { status: ['new', 'open'], triageDecision: 'awaiting', needsManualReview: false } }
    const query = serializeQueueUrlState(state, new URLSearchParams('tab=x&preset=urgent&filter.queueKey=old'))
    const parsed = new URLSearchParams(query)
    expect(parsed.get('tab')).toBe('x')
    expect(parsed.get('filter.queueKey')).toBeNull()
    expect(parseQueueUrlState(parsed)).toEqual({ preset: 'mine', filters: { status: ['new', 'open'], triageDecision: 'awaiting' } })
  })

  it('serializes deterministically so equal states compare equal', () => {
    const left = serializeQueueUrlState({ preset: 'all', filters: { b: 'x', a: 'y' } })
    const right = serializeQueueUrlState({ preset: 'all', filters: { a: 'y', b: 'x' } })
    expect(left).toBe(right)
    expect(serializeQueueUrlState({ preset: 'all', filters: {} })).toBe('')
  })

  it('builds deep links into the queue', () => {
    expect(buildTicketQueueHref({})).toBe('/backend/tickets')
    expect(buildTicketQueueHref({ filters: { triageDecision: 'awaiting' } })).toBe('/backend/tickets?filter.triageDecision=awaiting')
  })
})

describe('buildQueueQueryParams', () => {
  const base = { page: 1, search: '', preset: 'all' as const, sorting: [] }

  it('forwards filter values contributed by injected filters as query params', () => {
    const params = buildQueueQueryParams({ ...base, filters: { triageDecision: 'awaiting', multi: ['a', 'b'], flag: true } })
    expect(params.triageDecision).toBe('awaiting')
    expect(params.multi).toBe('a,b')
    expect(params.flag).toBe('true')
  })

  it('never lets a forwarded filter override the host-owned query params', () => {
    const params = buildQueueQueryParams({ ...base, preset: 'urgent', filters: { page: '9', ids: 'x', mine: 'true', priority: ['low'] } })
    expect(params.page).toBe('1')
    expect(params.ids).toBeUndefined()
    expect(params.mine).toBeUndefined()
    expect(params.priority).toBe('urgent')
  })
})
