import type { EntityManager } from '@mikro-orm/postgresql'
import { findOneWithDecryption, findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { KnowledgeArticle, KnowledgeArticleVersion, KnowledgeCategory } from '../data/entities'
import type { KnowledgeArticleSnapshot } from '../data/validators'
import { buildTaxonomyTree, type BuildTaxonomyOptions, type TaxonomyNode } from './taxonomy'

export type KnowledgeScope = {
  tenantId: string
  organizationId: string
}

export async function loadCategory(em: EntityManager, scope: KnowledgeScope, id: string): Promise<KnowledgeCategory | null> {
  return findOneWithDecryption(
    em,
    KnowledgeCategory,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    scope,
  )
}

export async function loadCategoryByKey(em: EntityManager, scope: KnowledgeScope, key: string): Promise<KnowledgeCategory | null> {
  return findOneWithDecryption(
    em,
    KnowledgeCategory,
    { key, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    scope,
  )
}

export async function loadArticle(em: EntityManager, scope: KnowledgeScope, id: string): Promise<KnowledgeArticle | null> {
  return findOneWithDecryption(
    em,
    KnowledgeArticle,
    { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    scope,
  )
}

export async function loadArticleByKey(em: EntityManager, scope: KnowledgeScope, key: string): Promise<KnowledgeArticle | null> {
  return findOneWithDecryption(
    em,
    KnowledgeArticle,
    { key, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
    {},
    scope,
  )
}

export async function loadArticlePath(
  em: EntityManager,
  scope: KnowledgeScope,
  categoryId: string,
): Promise<{ category: KnowledgeCategory | null; subcategory: KnowledgeCategory | null }> {
  const subcategory = await loadCategory(em, scope, categoryId)
  if (!subcategory) return { category: null, subcategory: null }
  const category = subcategory.parentId ? await loadCategory(em, scope, subcategory.parentId) : null
  return { category, subcategory }
}

export function buildArticleSnapshot(input: {
  article: KnowledgeArticle
  version: number
  category: KnowledgeCategory | null
  subcategory: KnowledgeCategory | null
  publishedAt: Date
}): KnowledgeArticleSnapshot {
  const { article } = input
  return {
    id: article.id,
    key: article.key,
    version: input.version,
    title: article.title,
    summary: article.summary ?? null,
    keywords: [...(article.keywords ?? [])],
    body: article.body ?? null,
    applicability: article.applicability ?? null,
    category: input.category ? { key: input.category.key, name: input.category.name } : null,
    subcategory: input.subcategory ? { key: input.subcategory.key, name: input.subcategory.name } : null,
    procedureSteps: (article.procedureSteps ?? []).map((step) => ({ ...step })),
    requiredChecks: (article.requiredChecks ?? []).map((check) => ({ ...check })),
    recommendedActions: (article.recommendedActions ?? []).map((action) => ({ ...action })),
    automationLevel: article.automationLevel,
    manualReason: article.manualReason ?? null,
    targetQueueKey: article.targetQueueKey ?? null,
    priorityFloor: article.priorityFloor ?? null,
    replyTemplate: article.replyTemplate ?? null,
    publishedAt: input.publishedAt.toISOString(),
  }
}

export async function resolveArticleVersion(
  em: EntityManager,
  scope: KnowledgeScope,
  key: string,
  version?: number | null,
): Promise<KnowledgeArticleVersion | null> {
  if (typeof version === 'number') {
    const rows = await findWithDecryption(
      em,
      KnowledgeArticleVersion,
      { articleKey: key, version, tenantId: scope.tenantId, organizationId: scope.organizationId },
      { orderBy: { createdAt: 'desc' }, limit: 1 },
      scope,
    )
    return rows[0] ?? null
  }
  const current = await loadArticleByKey(em, scope, key)
  if (!current) return null
  const rows = await findWithDecryption(
    em,
    KnowledgeArticleVersion,
    { articleId: current.id, tenantId: scope.tenantId, organizationId: scope.organizationId },
    { orderBy: { version: 'desc' }, limit: 1 },
    scope,
  )
  return rows[0] ?? null
}

export async function loadTaxonomy(
  em: EntityManager,
  scope: KnowledgeScope,
  options: BuildTaxonomyOptions & { includeDrafts?: boolean } = {},
): Promise<TaxonomyNode[]> {
  const categories = await findWithDecryption(
    em,
    KnowledgeCategory,
    { tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null, isActive: true },
    { orderBy: { position: 'asc', name: 'asc' } },
    scope,
  )
  const articles = await findWithDecryption(
    em,
    KnowledgeArticle,
    {
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
      deletedAt: null,
      ...(options.includeDrafts ? {} : { status: 'published' as const }),
    },
    { orderBy: { title: 'asc' } },
    scope,
  )
  return buildTaxonomyTree(
    categories.map((category) => ({
      id: category.id,
      parentId: category.parentId ?? null,
      level: category.level,
      key: category.key,
      name: category.name,
      position: category.position,
    })),
    articles.map((article) => ({
      categoryId: article.categoryId,
      key: article.key,
      title: article.title,
      automationLevel: article.automationLevel,
      applicability: article.applicability ?? null,
      status: article.status,
      version: article.version,
    })),
    options,
  )
}
