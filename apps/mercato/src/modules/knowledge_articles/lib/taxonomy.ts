import type { KnowledgeAutomationLevel, KnowledgeCategoryLevel } from '../data/validators'

export type CategoryPlacementInput = {
  level: KnowledgeCategoryLevel
  parent: { id: string; level: KnowledgeCategoryLevel } | null
}

export function categoryPlacementError(input: CategoryPlacementInput): string | null {
  if (input.level === 'category') {
    return input.parent ? 'knowledge_articles.errors.topLevelCategoryWithParent' : null
  }
  if (!input.parent) return 'knowledge_articles.errors.subcategoryRequiresParent'
  if (input.parent.level !== 'category') return 'knowledge_articles.errors.subcategoryParentMustBeCategory'
  return null
}

export function articleCategoryError(category: { level: KnowledgeCategoryLevel } | null): string | null {
  if (!category) return 'knowledge_articles.errors.categoryNotFound'
  if (category.level !== 'subcategory') return 'knowledge_articles.errors.articleRequiresSubcategory'
  return null
}

export type TaxonomyCategoryRow = {
  id: string
  parentId: string | null
  level: KnowledgeCategoryLevel
  key: string
  name: string
  position: number
}

export type TaxonomyArticleRow = {
  categoryId: string
  key: string
  title: string
  automationLevel: KnowledgeAutomationLevel
  applicability?: string | null
  status: string
  version: number
}

export type TaxonomyTopic = {
  key: string
  title: string
  automationLevel: KnowledgeAutomationLevel
  status: string
  version: number
  applicability?: string | null
}

export type TaxonomySubcategory = {
  id: string
  key: string
  name: string
  topics: TaxonomyTopic[]
}

export type TaxonomyNode = {
  id: string
  key: string
  name: string
  subcategories: TaxonomySubcategory[]
}

export type BuildTaxonomyOptions = {
  includeApplicability?: boolean
  applicabilityMaxLength?: number
}

function byPositionThenName(left: TaxonomyCategoryRow, right: TaxonomyCategoryRow): number {
  if (left.position !== right.position) return left.position - right.position
  return left.name.localeCompare(right.name)
}

export function truncateText(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null
  const trimmed = value.trim()
  if (trimmed.length <= maxLength) return trimmed
  return `${trimmed.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`
}

export function buildTaxonomyTree(
  categories: TaxonomyCategoryRow[],
  articles: TaxonomyArticleRow[],
  options: BuildTaxonomyOptions = {},
): TaxonomyNode[] {
  const sorted = [...categories].sort(byPositionThenName)
  const topicsByCategory = new Map<string, TaxonomyTopic[]>()
  const sortedArticles = [...articles].sort((left, right) => left.title.localeCompare(right.title))
  for (const article of sortedArticles) {
    const topic: TaxonomyTopic = {
      key: article.key,
      title: article.title,
      automationLevel: article.automationLevel,
      status: article.status,
      version: article.version,
    }
    if (options.includeApplicability) {
      topic.applicability = truncateText(article.applicability, options.applicabilityMaxLength ?? 200)
    }
    const list = topicsByCategory.get(article.categoryId) ?? []
    list.push(topic)
    topicsByCategory.set(article.categoryId, list)
  }
  return sorted
    .filter((category) => category.level === 'category')
    .map((root) => ({
      id: root.id,
      key: root.key,
      name: root.name,
      subcategories: sorted
        .filter((child) => child.level === 'subcategory' && child.parentId === root.id)
        .map((child) => ({
          id: child.id,
          key: child.key,
          name: child.name,
          topics: topicsByCategory.get(child.id) ?? [],
        })),
    }))
}
