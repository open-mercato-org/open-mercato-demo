export const KB_TAXONOMY_PATH = '/api/knowledge_articles/taxonomy'

export type KbTopic = { key: string; title: string }
export type KbSubcategory = { key: string; name: string; topics: KbTopic[] }
export type KbCategory = { key: string; name: string; subcategories: KbSubcategory[] }

export type KbOption = { value: string; label: string }

function readTrimmed(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed.length ? trimmed : null
}

function readArray(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is Record<string, unknown> => Boolean(entry) && typeof entry === 'object')
}

export function parseKbTaxonomy(payload: unknown): KbCategory[] | null {
  if (!payload || typeof payload !== 'object') return null
  const items = (payload as { items?: unknown }).items
  if (!Array.isArray(items)) return null
  const categories: KbCategory[] = []
  for (const category of readArray(items)) {
    const key = readTrimmed(category.key)
    if (!key) continue
    const subcategories: KbSubcategory[] = []
    for (const subcategory of readArray(category.subcategories)) {
      const subKey = readTrimmed(subcategory.key)
      if (!subKey) continue
      const topics: KbTopic[] = []
      for (const topic of readArray(subcategory.topics)) {
        const topicKey = readTrimmed(topic.key)
        if (topicKey) topics.push({ key: topicKey, title: readTrimmed(topic.title) ?? topicKey })
      }
      subcategories.push({ key: subKey, name: readTrimmed(subcategory.name) ?? subKey, topics })
    }
    categories.push({ key, name: readTrimmed(category.name) ?? key, subcategories })
  }
  return categories
}

function withCurrentValue(options: KbOption[], current: unknown): KbOption[] {
  const value = readTrimmed(current)
  if (!value || options.some((option) => option.value === value)) return options
  return [...options, { value, label: value }]
}

function findCategory(taxonomy: KbCategory[], categoryKey: unknown): KbCategory | null {
  const key = readTrimmed(categoryKey)
  return key ? taxonomy.find((category) => category.key === key) ?? null : null
}

function findSubcategory(taxonomy: KbCategory[], categoryKey: unknown, subcategoryKey: unknown): KbSubcategory | null {
  const key = readTrimmed(subcategoryKey)
  const category = findCategory(taxonomy, categoryKey)
  return key && category ? category.subcategories.find((subcategory) => subcategory.key === key) ?? null : null
}

export function kbCategoryOptions(taxonomy: KbCategory[], current?: unknown): KbOption[] {
  return withCurrentValue(taxonomy.map((category) => ({ value: category.key, label: category.name })), current)
}

export function kbSubcategoryOptions(taxonomy: KbCategory[], categoryKey: unknown, current?: unknown): KbOption[] {
  const category = findCategory(taxonomy, categoryKey)
  const options = category ? category.subcategories.map((subcategory) => ({ value: subcategory.key, label: subcategory.name })) : []
  return withCurrentValue(options, current)
}

export function kbTopicOptions(
  taxonomy: KbCategory[],
  categoryKey: unknown,
  subcategoryKey: unknown,
  current?: unknown,
): KbOption[] {
  const subcategory = findSubcategory(taxonomy, categoryKey, subcategoryKey)
  const options = subcategory ? subcategory.topics.map((topic) => ({ value: topic.key, label: topic.title })) : []
  return withCurrentValue(options, current)
}

export function buildKbCategoryPath(
  taxonomy: KbCategory[],
  keys: { categoryKey?: unknown; subcategoryKey?: unknown; topicKey?: unknown },
): string | null {
  const category = findCategory(taxonomy, keys.categoryKey)
  if (!category) return null
  const parts = [category.name]
  const subcategory = findSubcategory(taxonomy, keys.categoryKey, keys.subcategoryKey)
  if (subcategory) {
    parts.push(subcategory.name)
    const topicKey = readTrimmed(keys.topicKey)
    const topic = topicKey ? subcategory.topics.find((entry) => entry.key === topicKey) : null
    if (topic) parts.push(topic.title)
  }
  return parts.join(' / ')
}

export function resolveCategoryPathSnapshot(
  taxonomy: KbCategory[],
  keys: { categoryKey?: unknown; subcategoryKey?: unknown; topicKey?: unknown },
  previousSnapshot: unknown,
): string | null {
  if (!readTrimmed(keys.categoryKey) && !readTrimmed(keys.subcategoryKey) && !readTrimmed(keys.topicKey)) return null
  return buildKbCategoryPath(taxonomy, keys) ?? readTrimmed(previousSnapshot)
}
