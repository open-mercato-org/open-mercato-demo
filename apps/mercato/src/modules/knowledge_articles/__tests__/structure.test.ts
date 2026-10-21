/** @jest-environment node */
import { nextStepId, renumberSteps, validateArticleStructure } from '../lib/articleStructure'
import { articleCategoryError, buildTaxonomyTree, categoryPlacementError, truncateText } from '../lib/taxonomy'
import { extractTemplatePlaceholders, renderTemplate } from '../lib/templates'
import { articleCreateSchema, procedureStepSchema } from '../data/validators'

describe('knowledge_articles taxonomy validation', () => {
  it('rejects an article placed on a top-level category', () => {
    expect(articleCategoryError({ level: 'category' })).toBe('knowledge_articles.errors.articleRequiresSubcategory')
    expect(articleCategoryError(null)).toBe('knowledge_articles.errors.categoryNotFound')
    expect(articleCategoryError({ level: 'subcategory' })).toBeNull()
  })

  it('enforces the two-level category shape', () => {
    expect(categoryPlacementError({ level: 'category', parent: null })).toBeNull()
    expect(categoryPlacementError({ level: 'category', parent: { id: 'p', level: 'category' } }))
      .toBe('knowledge_articles.errors.topLevelCategoryWithParent')
    expect(categoryPlacementError({ level: 'subcategory', parent: null }))
      .toBe('knowledge_articles.errors.subcategoryRequiresParent')
    expect(categoryPlacementError({ level: 'subcategory', parent: { id: 'p', level: 'subcategory' } }))
      .toBe('knowledge_articles.errors.subcategoryParentMustBeCategory')
    expect(categoryPlacementError({ level: 'subcategory', parent: { id: 'p', level: 'category' } })).toBeNull()
  })

  it('builds the category → subcategory → topic tree with truncated applicability', () => {
    const tree = buildTaxonomyTree(
      [
        { id: 'sub-b', parentId: 'root', level: 'subcategory', key: 'payments.incoming', name: 'Incoming payments', position: 20 },
        { id: 'root', parentId: null, level: 'category', key: 'payments', name: 'Payments', position: 10 },
        { id: 'sub-a', parentId: 'root', level: 'subcategory', key: 'payments.refunds', name: 'Refunds', position: 10 },
      ],
      [
        {
          categoryId: 'sub-a',
          key: 'payments.refunds.overpayment_refund',
          title: 'Overpayment refund',
          automationLevel: 'assisted',
          applicability: 'x'.repeat(300),
          status: 'published',
          version: 3,
        },
      ],
      { includeApplicability: true, applicabilityMaxLength: 200 },
    )
    expect(tree).toHaveLength(1)
    expect(tree[0].subcategories.map((sub) => sub.key)).toEqual(['payments.refunds', 'payments.incoming'])
    const topic = tree[0].subcategories[0].topics[0]
    expect(topic).toMatchObject({ key: 'payments.refunds.overpayment_refund', automationLevel: 'assisted', version: 3 })
    expect(topic.applicability?.length).toBe(200)
    expect(truncateText('  short  ', 10)).toBe('short')
  })
})

describe('knowledge_articles procedure structure', () => {
  const checks = [{ key: 'owner_verified', label: 'Owner verified', description: null }]
  const actions = [{ actionKey: 'reservations.refund.request', label: 'Request refund', requiresApproval: true }]

  it('accepts unique steps that reference declared checks and actions', () => {
    expect(validateArticleStructure({
      procedureSteps: [
        { id: 'S1', text: 'Verify owner', checkKey: 'owner_verified', actionKey: null },
        { id: 'S2', text: 'Request refund', checkKey: null, actionKey: 'reservations.refund.request' },
      ],
      requiredChecks: checks,
      recommendedActions: actions,
    })).toEqual([])
  })

  it('reports duplicate step ids and dangling references', () => {
    const issues = validateArticleStructure({
      procedureSteps: [
        { id: 'S1', text: 'a', checkKey: 'unknown_check', actionKey: null },
        { id: 'S1', text: 'b', checkKey: null, actionKey: 'tickets.reply.send' },
      ],
      requiredChecks: [...checks, ...checks],
      recommendedActions: actions,
    })
    expect(issues.map((issue) => issue.messageKey).sort()).toEqual([
      'knowledge_articles.errors.duplicateCheckKey',
      'knowledge_articles.errors.duplicateStepId',
      'knowledge_articles.errors.unknownStepAction',
      'knowledge_articles.errors.unknownStepCheck',
    ])
  })

  it('keeps ids stable when adding and renumbers only on explicit reorder', () => {
    expect(nextStepId([{ id: 'S1' }, { id: 'S4' }, { id: 'S2' }])).toBe('S5')
    expect(nextStepId([])).toBe('S1')
    expect(renumberSteps([{ id: 'S3', text: 'c' }, { id: 'S1', text: 'a' }]))
      .toEqual([{ id: 'S1', text: 'c' }, { id: 'S2', text: 'a' }])
  })

  it('validates step id format and key format', () => {
    expect(procedureStepSchema.safeParse({ id: 'S0', text: 'x' }).success).toBe(false)
    expect(procedureStepSchema.safeParse({ id: 'step1', text: 'x' }).success).toBe(false)
    expect(procedureStepSchema.safeParse({ id: 'S12', text: 'x' }).success).toBe(true)
    const base = { categoryId: '00000000-0000-4000-8000-000000000001', title: 'T' }
    expect(articleCreateSchema.safeParse({ ...base, key: 'payments.refunds.overpayment_refund' }).success).toBe(true)
    expect(articleCreateSchema.safeParse({ ...base, key: 'Payments Refunds' }).success).toBe(false)
  })
})

describe('knowledge_articles reply templates', () => {
  const template = 'Dear {{customer.firstName}}, we refund {{ refund.amount }} for {{reservation.bookingNumber}}. {{refund.amount}}'

  it('extracts unique placeholders in order of appearance', () => {
    expect(extractTemplatePlaceholders(template)).toEqual(['customer.firstName', 'refund.amount', 'reservation.bookingNumber'])
    expect(extractTemplatePlaceholders(null)).toEqual([])
    expect(extractTemplatePlaceholders('{{ not valid! }} {{}}')).toEqual([])
  })

  it('renders known values and leaves unknown placeholders untouched', () => {
    expect(renderTemplate(template, { customer: { firstName: 'Anna' }, refund: { amount: '350 EUR' } }))
      .toBe('Dear Anna, we refund 350 EUR for {{reservation.bookingNumber}}. 350 EUR')
  })
})
