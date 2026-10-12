/** @jest-environment node */
const findOneWithDecryption = jest.fn()
const findWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

import type { EntityManager } from '@mikro-orm/postgresql'
import type { AwilixContainer } from 'awilix'
import { ingestInboundEmail, isUniqueViolation } from '../lib/emailIntake'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

type Store = {
  articlesByMessageId: Record<string, { id: string; ticketId: string }>
  ticketsByNumber: Record<string, { id: string; number: string; status: string }>
  ticketsById: Record<string, { id: string; number: string; status: string }>
}

function installStore(store: Store) {
  findOneWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
    if (typeof where.messageId === 'string') return store.articlesByMessageId[where.messageId] ?? null
    if (typeof where.number === 'string') return store.ticketsByNumber[where.number] ?? null
    if (typeof where.id === 'string') return store.ticketsById[where.id] ?? null
    return null
  })
  findWithDecryption.mockImplementation(async (_em: unknown, _entity: unknown, where: Record<string, unknown>) => {
    const ids = (where.messageId as { $in?: string[] } | undefined)?.$in ?? []
    return ids.map((id) => store.articlesByMessageId[id]).filter(Boolean)
  })
}

function fakeContainer(execute: jest.Mock) {
  return { resolve: (name: string) => (name === 'commandBus' ? { execute } : undefined) } as unknown as AwilixContainer
}

const em = { fork: () => em } as unknown as EntityManager

describe('ticket email intake', () => {
  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it('creates a new ticket for an unthreaded email', async () => {
    installStore({ articlesByMessageId: {}, ticketsByNumber: {}, ticketsById: {} })
    const execute = jest.fn(async () => ({ result: { ticketId: 't-new', number: 'TCK-000010', articleId: 'a-1' } }))
    const result = await ingestInboundEmail({
      em,
      container: fakeContainer(execute),
      scope,
      email: { fromEmail: 'Jan@Example.com', subject: 'Overpayment', bodyText: 'Please refund', messageId: 'm1@x' },
    })
    expect(result).toEqual({ ticketId: 't-new', number: 'TCK-000010', articleId: 'a-1', created: true, duplicate: false, match: 'new' })
    const [commandId, options] = execute.mock.calls[0] as unknown as [string, { input: Record<string, unknown>; ctx: Record<string, unknown> }]
    expect(commandId).toBe('tickets.ticket.create')
    expect(options.input.requesterEmail).toBe('jan@example.com')
    expect((options.input.initialArticle as Record<string, unknown>).messageId).toBe('<m1@x>')
    expect(options.ctx.selectedOrganizationId).toBe('org-1')
    expect(options.ctx.auth).toBeNull()
  })

  it('is idempotent on message id', async () => {
    installStore({
      articlesByMessageId: { '<m1@x>': { id: 'a-1', ticketId: 't-1' } },
      ticketsByNumber: {},
      ticketsById: { 't-1': { id: 't-1', number: 'TCK-000001', status: 'open' } },
    })
    const execute = jest.fn()
    const result = await ingestInboundEmail({
      em,
      container: fakeContainer(execute),
      scope,
      email: { fromEmail: 'jan@example.com', subject: 'Again', bodyText: 'dup', messageId: '<m1@x>' },
    })
    expect(result).toEqual(expect.objectContaining({ ticketId: 't-1', created: false, duplicate: true }))
    expect(execute).not.toHaveBeenCalled()
  })

  it('appends a follow-up matched by In-Reply-To', async () => {
    installStore({
      articlesByMessageId: { '<m1@x>': { id: 'a-1', ticketId: 't-1' } },
      ticketsByNumber: {},
      ticketsById: { 't-1': { id: 't-1', number: 'TCK-000001', status: 'pending_customer' } },
    })
    const execute = jest.fn(async () => ({ result: { ticketId: 't-1', articleId: 'a-2' } }))
    const result = await ingestInboundEmail({
      em,
      container: fakeContainer(execute),
      scope,
      email: { fromEmail: 'jan@example.com', subject: 'Re: Overpayment', bodyText: 'My IBAN is…', messageId: '<m2@x>', inReplyTo: '<m1@x>' },
    })
    expect(result).toEqual(expect.objectContaining({ ticketId: 't-1', articleId: 'a-2', created: false, match: 'message' }))
    expect((execute.mock.calls[0] as unknown as [string])[0]).toBe('tickets.article.receive')
  })

  it('appends a follow-up matched by the subject token', async () => {
    installStore({
      articlesByMessageId: {},
      ticketsByNumber: { 'TCK-000007': { id: 't-7', number: 'TCK-000007', status: 'resolved' } },
      ticketsById: { 't-7': { id: 't-7', number: 'TCK-000007', status: 'resolved' } },
    })
    const execute = jest.fn(async () => ({ result: { ticketId: 't-7', articleId: 'a-9' } }))
    const result = await ingestInboundEmail({
      em,
      container: fakeContainer(execute),
      scope,
      email: { fromEmail: 'jan@example.com', subject: 'Re: thanks [TCK-000007]', bodyText: 'One more thing', messageId: '<m9@x>' },
    })
    expect(result.match).toBe('token')
    expect(result.ticketId).toBe('t-7')
  })

  it('opens a new ticket when the matched ticket is closed', async () => {
    installStore({
      articlesByMessageId: {},
      ticketsByNumber: { 'TCK-000007': { id: 't-7', number: 'TCK-000007', status: 'closed' } },
      ticketsById: { 't-7': { id: 't-7', number: 'TCK-000007', status: 'closed' } },
    })
    const execute = jest.fn(async () => ({ result: { ticketId: 't-8', number: 'TCK-000008', articleId: 'a-1' } }))
    const result = await ingestInboundEmail({
      em,
      container: fakeContainer(execute),
      scope,
      email: { fromEmail: 'jan@example.com', subject: 'Re: [TCK-000007]', bodyText: 'Reopen?', messageId: '<m10@x>' },
    })
    expect(result.created).toBe(true)
    expect((execute.mock.calls[0] as unknown as [string])[0]).toBe('tickets.ticket.create')
  })

  it('recovers from a concurrent duplicate insert', async () => {
    const store: Store = { articlesByMessageId: {}, ticketsByNumber: {}, ticketsById: {} }
    installStore(store)
    const execute = jest.fn(async () => {
      store.articlesByMessageId['<race@x>'] = { id: 'a-r', ticketId: 't-r' }
      store.ticketsById['t-r'] = { id: 't-r', number: 'TCK-000099', status: 'new' }
      throw Object.assign(new Error('duplicate key'), { code: '23505' })
    })
    const result = await ingestInboundEmail({
      em,
      container: fakeContainer(execute),
      scope,
      email: { fromEmail: 'jan@example.com', subject: 'Race', bodyText: 'x', messageId: '<race@x>' },
    })
    expect(result).toEqual(expect.objectContaining({ ticketId: 't-r', duplicate: true }))
  })

  it('detects nested unique violations', () => {
    expect(isUniqueViolation({ cause: { code: '23505' } })).toBe(true)
    expect(isUniqueViolation(new Error('boom'))).toBe(false)
  })
})
