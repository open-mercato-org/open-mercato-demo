/** @jest-environment node */
import { KB_VERSION_READER_KEY, loadArticlePolicy, resolveKbVersionReader, type KbArticleVersionReader } from '../lib/kbArticles'

jest.mock('@open-mercato/telemetry', () => ({ reportError: jest.fn() }))

const scope = { tenantId: '00000000-0000-4000-8000-0000000000aa', organizationId: '00000000-0000-4000-8000-0000000000bb' }

const snapshot = {
  title: 'Overpayment refund',
  category: { key: 'payments', name: 'Payments' },
  subcategory: { key: 'payments.refunds', name: 'Refunds' },
  automationLevel: 'assisted',
  procedureSteps: [{ id: 'S1', text: 'Verify the owner.', checkKey: 'owner_verified' }],
  requiredChecks: [{ key: 'owner_verified', label: 'Owner verified' }],
  recommendedActions: [{ actionKey: 'reservations.refund.request', label: 'Request refund' }],
}

function readerReturning(record: Awaited<ReturnType<KbArticleVersionReader['readVersion']>>) {
  return { readVersion: jest.fn(async () => record) }
}

describe('knowledge base reader (soft-optional DI)', () => {
  it('resolves the knowledge_articles reader when the module is enabled', () => {
    const reader = readerReturning(null)
    const container = { resolve: <T,>(name: string): T => (name === KB_VERSION_READER_KEY ? (reader as unknown as T) : (undefined as T)) }
    expect(resolveKbVersionReader(container)).toBe(reader)
  })

  it('yields null when the knowledge_articles module is absent', () => {
    const container = {
      resolve: <T,>(name: string): T => {
        throw new Error(`[internal] ${name} not registered`)
      },
    }
    expect(resolveKbVersionReader(container)).toBeNull()
    expect(resolveKbVersionReader(null)).toBeNull()
  })

  it('ignores a registration that does not honour the reader contract', () => {
    const container = { resolve: <T,>(): T => ({ readVersion: 'nope' }) as unknown as T }
    expect(resolveKbVersionReader(container)).toBeNull()
  })

  it('maps the published snapshot into the article policy', async () => {
    const reader = readerReturning({ key: 'payments.refunds.overpayment_refund', version: 3, snapshot })
    const policy = await loadArticlePolicy(reader, scope, 'payments.refunds.overpayment_refund', 3)
    expect(reader.readVersion).toHaveBeenCalledWith(scope, 'payments.refunds.overpayment_refund', 3)
    expect(policy).toMatchObject({
      key: 'payments.refunds.overpayment_refund',
      version: 3,
      categoryPath: 'Payments › Refunds › Overpayment refund',
      automationLevel: 'assisted',
      requiredChecks: [{ key: 'owner_verified', label: 'Owner verified' }],
    })
  })

  it('asks for the latest version when none (or an invalid one) is given', async () => {
    const reader = readerReturning(null)
    await loadArticlePolicy(reader, scope, 'payments.refunds.overpayment_refund', 0)
    expect(reader.readVersion).toHaveBeenCalledWith(scope, 'payments.refunds.overpayment_refund', null)
  })

  it('returns null without a reader, without a key, or when the read fails', async () => {
    expect(await loadArticlePolicy(null, scope, 'payments.refunds.overpayment_refund')).toBeNull()
    expect(await loadArticlePolicy(readerReturning(null), scope, '  ')).toBeNull()
    const failing = { readVersion: jest.fn(async () => Promise.reject(new Error('db down'))) }
    expect(await loadArticlePolicy(failing, scope, 'payments.refunds.overpayment_refund')).toBeNull()
  })
})
