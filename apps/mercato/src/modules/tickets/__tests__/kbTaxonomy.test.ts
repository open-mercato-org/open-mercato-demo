/** @jest-environment node */
import {
  buildKbCategoryPath,
  kbCategoryOptions,
  kbSubcategoryOptions,
  kbTopicOptions,
  parseKbTaxonomy,
  resolveCategoryPathSnapshot,
} from '../lib/kbTaxonomy'
import { buildClassifyPayload } from '../lib/classifyPayload'

const response = {
  items: [
    {
      id: 'c1',
      key: 'payments',
      name: 'Payments',
      subcategories: [
        {
          id: 's1',
          key: 'payments.refunds',
          name: 'Refunds',
          topics: [{ key: 'payments.refunds.overpayment', title: 'Overpayment refund', automationLevel: 'assisted' }],
        },
        { id: 's2', key: 'payments.invoices', name: 'Invoices', topics: [] },
      ],
    },
    { id: 'c2', key: 'bookings', name: 'Bookings', subcategories: [] },
    { id: 'bad', name: 'No key' },
  ],
}

describe('KB taxonomy helpers', () => {
  const taxonomy = parseKbTaxonomy(response)!

  it('parses the taxonomy response and skips malformed nodes', () => {
    expect(taxonomy.map((category) => category.key)).toEqual(['payments', 'bookings'])
    expect(taxonomy[0].subcategories[0].topics).toEqual([{ key: 'payments.refunds.overpayment', title: 'Overpayment refund' }])
  })

  it('returns null for responses without an items array', () => {
    expect(parseKbTaxonomy(null)).toBeNull()
    expect(parseKbTaxonomy({ error: 'Not found' })).toBeNull()
    expect(parseKbTaxonomy({ items: [] })).toEqual([])
  })

  it('cascades options from category to subcategory to topic', () => {
    expect(kbCategoryOptions(taxonomy)).toEqual([
      { value: 'payments', label: 'Payments' },
      { value: 'bookings', label: 'Bookings' },
    ])
    expect(kbSubcategoryOptions(taxonomy, 'payments').map((option) => option.value)).toEqual(['payments.refunds', 'payments.invoices'])
    expect(kbSubcategoryOptions(taxonomy, '')).toEqual([])
    expect(kbTopicOptions(taxonomy, 'payments', 'payments.refunds')).toEqual([
      { value: 'payments.refunds.overpayment', label: 'Overpayment refund' },
    ])
    expect(kbTopicOptions(taxonomy, 'bookings', 'payments.refunds')).toEqual([])
  })

  it('keeps an unknown current value selectable so legacy keys are not lost', () => {
    expect(kbCategoryOptions(taxonomy, 'legacy')).toContainEqual({ value: 'legacy', label: 'legacy' })
    expect(kbTopicOptions(taxonomy, 'payments', 'payments.refunds', 'old.topic')).toHaveLength(2)
  })

  it('builds the category path from the selected labels', () => {
    expect(buildKbCategoryPath(taxonomy, {
      categoryKey: 'payments',
      subcategoryKey: 'payments.refunds',
      topicKey: 'payments.refunds.overpayment',
    })).toBe('Payments / Refunds / Overpayment refund')
    expect(buildKbCategoryPath(taxonomy, { categoryKey: 'payments', subcategoryKey: 'payments.invoices' })).toBe('Payments / Invoices')
    expect(buildKbCategoryPath(taxonomy, { categoryKey: 'legacy' })).toBeNull()
  })

  it('keeps the previous snapshot for legacy keys and clears it when nothing is selected', () => {
    expect(resolveCategoryPathSnapshot(taxonomy, { categoryKey: 'legacy' }, 'Old / Path')).toBe('Old / Path')
    expect(resolveCategoryPathSnapshot(taxonomy, { categoryKey: '' }, 'Old / Path')).toBeNull()
    expect(resolveCategoryPathSnapshot(taxonomy, { categoryKey: 'bookings' }, 'Old / Path')).toBe('Bookings')
  })
})

describe('buildClassifyPayload', () => {
  it('fills the category path snapshot from the taxonomy labels', () => {
    const taxonomy = parseKbTaxonomy(response)
    const payload = buildClassifyPayload({
      categoryKey: 'payments',
      subcategoryKey: 'payments.refunds',
      topicKey: 'payments.refunds.overpayment',
      categoryPathSnapshot: 'stale',
      priority: 'high',
    }, taxonomy)
    expect(payload).toMatchObject({
      source: 'manual',
      categoryKey: 'payments',
      subcategoryKey: 'payments.refunds',
      topicKey: 'payments.refunds.overpayment',
      categoryPathSnapshot: 'Payments / Refunds / Overpayment refund',
      priority: 'high',
    })
  })

  it('uses the free-text snapshot without a taxonomy', () => {
    const payload = buildClassifyPayload({ categoryKey: ' custom ', categoryPathSnapshot: ' Custom / Path ', priority: '' })
    expect(payload.categoryKey).toBe('custom')
    expect(payload.categoryPathSnapshot).toBe('Custom / Path')
    expect(payload).not.toHaveProperty('priority')
  })
})
