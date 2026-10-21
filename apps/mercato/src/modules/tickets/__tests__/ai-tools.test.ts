/** @jest-environment node */
const findOneWithDecryption = jest.fn()
const findWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
}))

import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'
import aclFeatures from '../acl'
import aiTools, { requireTicketToolScope } from '../ai-tools'
import { AGENT_ARTICLE_BODY_LIMIT, listTicketsInputSchema } from '../lib/agentReads'

const TICKET_ID = '22222222-2222-4222-8222-222222222222'
const declaredFeatureIds = new Set(aclFeatures.map((feature) => feature.id))

function toolByName(name: string) {
  const tool = aiTools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`[internal] tool ${name} is not declared`)
  return tool
}

function fakeContext(overrides: { tenantId?: string | null; organizationId?: string | null } = {}) {
  const em = { fork: () => em, count: jest.fn(async () => 3) }
  return {
    context: {
      tenantId: 'tenantId' in overrides ? overrides.tenantId : 'tenant-1',
      organizationId: 'organizationId' in overrides ? overrides.organizationId : 'org-1',
      userId: 'user-1',
      userFeatures: [],
      isSuperAdmin: false,
      container: { resolve: () => em },
    } as unknown as McpToolContext,
    em,
  }
}

function ticketRecord() {
  return {
    id: TICKET_ID,
    number: 'TCK-000001',
    subject: 'Overpayment',
    status: 'open',
    priority: 'high',
    priorityReason: 'departure in 3 days',
    queueKey: 'payments',
    channel: 'email',
    requesterEmail: 'jan@example.com',
    requesterName: 'Jan',
    needsManualReview: false,
    createdAt: new Date('2026-10-01T10:00:00Z'),
  }
}

describe('tickets ai-tools pack', () => {
  beforeEach(() => {
    findOneWithDecryption.mockReset()
    findWithDecryption.mockReset()
  })

  it('declares the two read-only tools gated on declared features', () => {
    expect(aiTools.map((tool) => tool.name).sort()).toEqual(['tickets.get_ticket', 'tickets.list_tickets'])
    for (const tool of aiTools) {
      expect(tool.isMutation).toBe(false)
      expect(tool.requiredFeatures?.length).toBeGreaterThan(0)
      for (const feature of tool.requiredFeatures ?? []) expect(declaredFeatureIds.has(feature)).toBe(true)
    }
  })

  it('fails closed without tenant and organization scope', () => {
    expect(() => requireTicketToolScope({ tenantId: null, organizationId: 'org-1' })).toThrow()
    expect(() => requireTicketToolScope({ tenantId: 'tenant-1', organizationId: '' })).toThrow()
    expect(requireTicketToolScope({ tenantId: 'tenant-1', organizationId: 'org-1' })).toEqual({ tenantId: 'tenant-1', organizationId: 'org-1' })
  })

  it('returns articles oldest first with trimmed bodies and stripped quotes', async () => {
    findOneWithDecryption.mockResolvedValue(ticketRecord())
    const longBody = 'x'.repeat(AGENT_ARTICLE_BODY_LIMIT + 500)
    findWithDecryption.mockResolvedValue([
      { id: 'a3', direction: 'outbound', bodyText: longBody, deliveryStatus: 'simulated', createdAt: new Date('2026-10-03T10:00:00Z') },
      { id: 'a2', direction: 'inbound', bodyText: 'Please refund.\nOn Mon, Support wrote:\n> old text', deliveryStatus: 'received', createdAt: new Date('2026-10-02T10:00:00Z') },
    ])
    const { context } = fakeContext()
    const result = await toolByName('tickets.get_ticket').handler({ ticketId: TICKET_ID, articleLimit: 2 }, context) as {
      found: boolean
      articles: Array<{ id: string; body: string; bodyTruncated: boolean }>
      articleCount: number
      ticket: { number: string }
    }
    expect(result.found).toBe(true)
    expect(result.ticket.number).toBe('TCK-000001')
    expect(result.articles.map((article) => article.id)).toEqual(['a2', 'a3'])
    expect(result.articles[0].body).toBe('Please refund.')
    expect(result.articles[1].bodyTruncated).toBe(true)
    expect(result.articles[1].body.length).toBe(AGENT_ARTICLE_BODY_LIMIT)
    expect(result.articleCount).toBe(3)
    const [, , where] = findOneWithDecryption.mock.calls[0] as [unknown, unknown, Record<string, unknown>]
    expect(where).toEqual(expect.objectContaining({ tenantId: 'tenant-1', organizationId: 'org-1', deletedAt: null }))
  })

  it('reports a missing ticket without throwing', async () => {
    findOneWithDecryption.mockResolvedValue(null)
    const { context } = fakeContext()
    const result = await toolByName('tickets.get_ticket').handler({ ticketId: TICKET_ID }, context)
    expect(result).toEqual({ found: false, ticketId: TICKET_ID })
  })

  it('rejects an articleLimit above 20', () => {
    const tool = toolByName('tickets.get_ticket')
    expect(() => tool.inputSchema.parse({ ticketId: TICKET_ID, articleLimit: 21 })).toThrow()
  })

  it('lists a requester history scoped by hash and capped at 10', async () => {
    findWithDecryption.mockResolvedValue([ticketRecord()])
    const { context } = fakeContext()
    const result = await toolByName('tickets.list_tickets').handler(
      { requesterEmail: 'jan@example.com', statuses: ['open'] },
      context,
    ) as { items: Array<{ id: string }> }
    expect(result.items).toHaveLength(1)
    const [, , where, options] = findWithDecryption.mock.calls[0] as [unknown, unknown, Record<string, unknown>, { limit: number }]
    expect(where.tenantId).toBe('tenant-1')
    expect(where.organizationId).toBe('org-1')
    expect(where.status).toEqual({ $in: ['open'] })
    expect(Array.isArray(where.$or)).toBe(true)
    expect(options.limit).toBe(10)
    expect(() => listTicketsInputSchema.parse({ limit: 5 })).toThrow()
    expect(() => listTicketsInputSchema.parse({ customerPersonId: TICKET_ID, limit: 11 })).toThrow()
  })
})
