/** @jest-environment node */
import type { EntityManager } from '@mikro-orm/postgresql'

const findWithDecryption = jest.fn()
const findOneWithDecryption = jest.fn()

jest.mock('@open-mercato/shared/lib/encryption/find', () => ({
  findWithDecryption: (...args: unknown[]) => findWithDecryption(...args),
  findOneWithDecryption: (...args: unknown[]) => findOneWithDecryption(...args),
}))

import { createKnowledgeArticleVersionReader, KNOWLEDGE_ARTICLE_VERSION_READER } from '../lib/versionReader'
import { register } from '../di'

const scope = { tenantId: 'tenant-1', organizationId: 'org-1' }

function fakeEm(): EntityManager {
  const em = { fork: () => em }
  return em as unknown as EntityManager
}

function versionRow(version: number) {
  return {
    id: `version-${version}`,
    articleId: 'article-1',
    articleKey: 'payments.refunds.overpayment_refund',
    version,
    createdAt: new Date('2026-10-12T10:00:00.000Z'),
    snapshot: { key: 'payments.refunds.overpayment_refund', version, procedureSteps: [{ id: 'S1', text: 'Verify owner' }] },
  }
}

describe('knowledgeArticleVersionReader', () => {
  beforeEach(() => {
    findWithDecryption.mockReset()
    findOneWithDecryption.mockReset()
  })

  it('registers the reader under its DI key', () => {
    const registrations: Record<string, unknown> = {}
    register({ register: (entries: Record<string, unknown>) => Object.assign(registrations, entries) } as unknown as Parameters<typeof register>[0])
    expect(Object.keys(registrations)).toEqual([KNOWLEDGE_ARTICLE_VERSION_READER])
  })

  it('reads an explicit version with tenant and organization scope', async () => {
    findWithDecryption.mockResolvedValueOnce([versionRow(3)])
    const record = await createKnowledgeArticleVersionReader(fakeEm()).readVersion(scope, 'payments.refunds.overpayment_refund', 3)
    const [, , where] = findWithDecryption.mock.calls[0]
    expect(where).toEqual({ articleKey: 'payments.refunds.overpayment_refund', version: 3, tenantId: 'tenant-1', organizationId: 'org-1' })
    expect(record).toEqual({
      key: 'payments.refunds.overpayment_refund',
      version: 3,
      citation: 'payments.refunds.overpayment_refund@3',
      publishedAt: '2026-10-12T10:00:00.000Z',
      snapshot: versionRow(3).snapshot,
    })
  })

  it('resolves the latest published version of the live article without a version', async () => {
    findOneWithDecryption.mockResolvedValueOnce({ id: 'article-1', key: 'payments.refunds.overpayment_refund' })
    findWithDecryption.mockResolvedValueOnce([versionRow(4)])
    const record = await createKnowledgeArticleVersionReader(fakeEm()).readVersion(scope, 'payments.refunds.overpayment_refund', null)
    expect(record?.version).toBe(4)
  })

  it('returns null for unknown articles, blank keys and missing scope', async () => {
    findOneWithDecryption.mockResolvedValueOnce(null)
    const reader = createKnowledgeArticleVersionReader(fakeEm())
    expect(await reader.readVersion(scope, 'payments.refunds.unknown')).toBeNull()
    expect(await reader.readVersion(scope, '   ')).toBeNull()
    expect(await reader.readVersion({ tenantId: '', organizationId: 'org-1' }, 'payments.refunds.overpayment_refund')).toBeNull()
    expect(findWithDecryption).not.toHaveBeenCalled()
  })
})
