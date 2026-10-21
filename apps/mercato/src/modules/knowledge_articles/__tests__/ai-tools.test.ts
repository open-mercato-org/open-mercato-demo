/** @jest-environment node */
import type { McpToolContext } from '@open-mercato/ai-assistant/modules/ai_assistant/lib/types'

const findWithDecryption = jest.fn()
const findOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

import aclFeatures from '../acl'
import aiTools, { requireToolScope } from '../ai-tools'
import { KnowledgeArticleVersion } from '../data/entities'

const declaredFeatureIds = new Set(aclFeatures.map((feature) => feature.id))

function toolByName(name: string) {
  const tool = aiTools.find((candidate) => candidate.name === name)
  if (!tool) throw new Error(`[internal] tool ${name} is not declared`)
  return tool
}

function fakeContext(resolve: (token: string) => unknown): McpToolContext {
  return {
    tenantId: 'tenant-1',
    organizationId: 'org-1',
    userId: 'user-1',
    userFeatures: [],
    isSuperAdmin: false,
    container: { resolve },
  } as unknown as McpToolContext
}

function versionRow(version: number, articleId = 'article-1') {
  return {
    id: `version-${version}`,
    articleId,
    articleKey: 'payments.refunds.overpayment_refund',
    version,
    createdAt: new Date('2026-10-12T10:00:00.000Z'),
    publishedByUserId: null,
    snapshot: { key: 'payments.refunds.overpayment_refund', version, procedureSteps: [{ id: 'S1', text: 'Verify owner' }] },
  }
}

describe('knowledge_articles ai-tools', () => {
  beforeEach(() => {
    findWithDecryption.mockReset()
    findOneWithDecryption.mockReset()
  })

  it('declares three read-only tools gated on a declared feature', () => {
    expect(aiTools.map((tool) => tool.name).sort()).toEqual([
      'knowledge_articles.browse_taxonomy',
      'knowledge_articles.get_article',
      'knowledge_articles.search',
    ])
    for (const tool of aiTools) {
      expect(tool.isMutation).toBe(false)
      expect(tool.requiredFeatures).toEqual(['knowledge_articles.view'])
      for (const feature of tool.requiredFeatures ?? []) expect(declaredFeatureIds.has(feature)).toBe(true)
    }
  })

  it('fails closed without tenant and organization scope', () => {
    expect(() => requireToolScope({ tenantId: 'tenant-1', organizationId: null })).toThrow('[internal]')
    expect(requireToolScope({ tenantId: ' t ', organizationId: 'o' })).toEqual({ tenantId: 't', organizationId: 'o' })
  })

  it('get_article resolves an explicit version by key and version', async () => {
    findWithDecryption.mockResolvedValueOnce([versionRow(2)])
    const result = await toolByName('knowledge_articles.get_article').handler(
      { key: 'payments.refunds.overpayment_refund', version: 2 },
      fakeContext(() => ({})),
    )
    expect(findWithDecryption).toHaveBeenCalledTimes(1)
    const [, entity, where] = findWithDecryption.mock.calls[0]
    expect(entity).toBe(KnowledgeArticleVersion)
    expect(where).toEqual({
      articleKey: 'payments.refunds.overpayment_refund',
      version: 2,
      tenantId: 'tenant-1',
      organizationId: 'org-1',
    })
    expect(result).toMatchObject({ found: true, version: 2, citation: 'payments.refunds.overpayment_refund@2' })
  })

  it('get_article without a version returns the latest published version of the current article', async () => {
    findOneWithDecryption.mockResolvedValueOnce({ id: 'article-1', key: 'payments.refunds.overpayment_refund' })
    findWithDecryption.mockResolvedValueOnce([versionRow(4)])
    const result = await toolByName('knowledge_articles.get_article').handler(
      { key: 'payments.refunds.overpayment_refund' },
      fakeContext(() => ({})),
    )
    const [, , where, options] = findWithDecryption.mock.calls[0]
    expect(where).toEqual({ articleId: 'article-1', tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(options).toMatchObject({ orderBy: { version: 'desc' }, limit: 1 })
    expect(result).toMatchObject({ found: true, version: 4, citation: 'payments.refunds.overpayment_refund@4' })
  })

  it('get_article reports not found for unknown keys and never-published articles', async () => {
    findOneWithDecryption.mockResolvedValueOnce(null)
    const missing = await toolByName('knowledge_articles.get_article').handler(
      { key: 'payments.refunds.unknown' },
      fakeContext(() => ({})),
    )
    expect(missing).toEqual({ found: false, key: 'payments.refunds.unknown', version: null })

    findOneWithDecryption.mockResolvedValueOnce({ id: 'article-2', key: 'booking.changes.draft_topic' })
    findWithDecryption.mockResolvedValueOnce([])
    const draft = await toolByName('knowledge_articles.get_article').handler(
      { key: 'booking.changes.draft_topic' },
      fakeContext(() => ({})),
    )
    expect(draft).toEqual({ found: false, key: 'booking.changes.draft_topic', version: null })
  })

  it('search rejects limits above five', () => {
    const tool = toolByName('knowledge_articles.search')
    expect(tool.inputSchema.safeParse({ query: 'refund', limit: 6 }).success).toBe(false)
    expect(tool.inputSchema.safeParse({ query: 'refund', limit: 5 }).success).toBe(true)
  })
})
