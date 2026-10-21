import type { CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import type { CrudEmitContext, CrudEventsConfig, CrudIndexerConfig } from '@open-mercato/shared/lib/crud/types'
import { CrudHttpError } from '@open-mercato/shared/lib/crud/errors'
import { enforceCommandOptimisticLockWithGuards } from '@open-mercato/shared/lib/crud/optimistic-lock-command'
import type { KnowledgeArticle, KnowledgeCategory } from '../data/entities'
import type { KnowledgeScope } from '../lib/repository'

export const KNOWLEDGE_CATEGORY_ENTITY_ID = 'knowledge_articles:knowledge_category' as const
export const KNOWLEDGE_ARTICLE_ENTITY_ID = 'knowledge_articles:knowledge_article' as const
export const KNOWLEDGE_ARTICLE_VERSION_ENTITY_ID = 'knowledge_articles:knowledge_article_version' as const
export const KNOWLEDGE_CATEGORY_RESOURCE_KIND = 'knowledge_articles.category'
export const KNOWLEDGE_ARTICLE_RESOURCE_KIND = 'knowledge_articles.article'

export function ensureScope(ctx: CommandRuntimeContext): KnowledgeScope {
  const tenantId = ctx.auth?.tenantId ?? null
  if (!tenantId) throw new CrudHttpError(400, { error: 'knowledge_articles.errors.tenantRequired' })
  const organizationId = ctx.selectedOrganizationId ?? ctx.auth?.orgId ?? null
  if (!organizationId) throw new CrudHttpError(400, { error: 'knowledge_articles.errors.organizationRequired' })
  return { tenantId, organizationId }
}

export function resolveUndoScope(
  ctx: CommandRuntimeContext,
  snapshot?: { tenantId: string | null; organizationId: string | null } | null,
): KnowledgeScope {
  const scope = ensureScope(ctx)
  const tenantId = snapshot?.tenantId ?? scope.tenantId
  if (tenantId !== scope.tenantId) {
    throw new CrudHttpError(403, { error: 'knowledge_articles.errors.undoScopeMismatch' })
  }
  let organizationId = scope.organizationId
  if (snapshot?.organizationId) {
    const allowed = Array.isArray(ctx.organizationIds) ? ctx.organizationIds : null
    if (allowed && allowed.length > 0 && !allowed.includes(snapshot.organizationId)) {
      throw new CrudHttpError(403, { error: 'knowledge_articles.errors.undoScopeMismatch' })
    }
    organizationId = snapshot.organizationId
  }
  return { tenantId, organizationId }
}

export async function enforceKnowledgeOptimisticLock(
  ctx: CommandRuntimeContext,
  record: { id: string; updatedAt?: Date | string | null } | null | undefined,
  resourceKind: string,
): Promise<void> {
  if (!record) return
  await enforceCommandOptimisticLockWithGuards(ctx.container, {
    resourceKind,
    resourceId: record.id,
    current: record.updatedAt ?? null,
    request: ctx.request ?? null,
  })
}

export function validationError(messageKey: string, fieldErrors?: Record<string, string>): CrudHttpError {
  return new CrudHttpError(422, { error: messageKey, ...(fieldErrors ? { fieldErrors } : {}) })
}

export const categoryCrudEvents: CrudEventsConfig<KnowledgeCategory> = {
  module: 'knowledge_articles',
  entity: 'category',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<KnowledgeCategory>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    key: ctx.entity?.key ?? null,
    level: ctx.entity?.level ?? null,
  }),
}

export const categoryCrudIndexer: CrudIndexerConfig<KnowledgeCategory> = {
  entityType: KNOWLEDGE_CATEGORY_ENTITY_ID,
}

export const articleCrudEvents: CrudEventsConfig<KnowledgeArticle> = {
  module: 'knowledge_articles',
  entity: 'article',
  persistent: true,
  buildPayload: (ctx: CrudEmitContext<KnowledgeArticle>) => ({
    id: ctx.identifiers.id,
    tenantId: ctx.identifiers.tenantId,
    organizationId: ctx.identifiers.organizationId,
    key: ctx.entity?.key ?? null,
    status: ctx.entity?.status ?? null,
    version: typeof ctx.entity?.version === 'number' ? ctx.entity.version : null,
  }),
}

export const articleCrudIndexer: CrudIndexerConfig<KnowledgeArticle> = {
  entityType: KNOWLEDGE_ARTICLE_ENTITY_ID,
}
