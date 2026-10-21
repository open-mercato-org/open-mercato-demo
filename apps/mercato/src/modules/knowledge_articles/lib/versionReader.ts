import type { EntityManager } from '@mikro-orm/postgresql'
import type { KnowledgeArticleSnapshot } from '../data/validators'
import { resolveArticleVersion, type KnowledgeScope } from './repository'

export const KNOWLEDGE_ARTICLE_VERSION_READER = 'knowledgeArticleVersionReader' as const

export type KnowledgeArticleVersionRecord = {
  key: string
  version: number
  citation: string
  publishedAt: string
  snapshot: KnowledgeArticleSnapshot
}

/**
 * Read-only DI contract for other modules: the immutable published snapshot of an
 * article version, the same data `knowledge_articles.get_article` returns. Without
 * an explicit version it resolves the latest published version of the live article.
 */
export type KnowledgeArticleVersionReader = {
  readVersion(scope: KnowledgeScope, key: string, version?: number | null): Promise<KnowledgeArticleVersionRecord | null>
}

export function createKnowledgeArticleVersionReader(em: EntityManager): KnowledgeArticleVersionReader {
  return {
    async readVersion(scope, key, version) {
      const articleKey = typeof key === 'string' ? key.trim() : ''
      if (!articleKey || !scope?.tenantId || !scope.organizationId) return null
      const requested = typeof version === 'number' && Number.isInteger(version) && version > 0 ? version : null
      const row = await resolveArticleVersion(em.fork(), scope, articleKey, requested)
      if (!row) return null
      return {
        key: row.articleKey,
        version: row.version,
        citation: `${row.articleKey}@${row.version}`,
        publishedAt: row.createdAt.toISOString(),
        snapshot: row.snapshot,
      }
    },
  }
}
