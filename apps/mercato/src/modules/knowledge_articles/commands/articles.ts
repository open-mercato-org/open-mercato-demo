import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findOneWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import { LockMode } from '@mikro-orm/core'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { KnowledgeArticle, KnowledgeArticleVersion } from '../data/entities'
import {
  articleCreateSchema,
  articlePublishSchema,
  articleUpdateSchema,
  type KnowledgeArticleStatus,
  type KnowledgeAutomationLevel,
  type KnowledgePriorityFloor,
  type KnowledgeProcedureStep,
  type KnowledgeRecommendedAction,
  type KnowledgeRequiredCheck,
} from '../data/validators'
import { validateArticleStructure } from '../lib/articleStructure'
import {
  buildArticleSnapshot,
  loadArticle,
  loadArticleByKey,
  loadArticlePath,
  loadCategory,
  type KnowledgeScope,
} from '../lib/repository'
import { articleCategoryError } from '../lib/taxonomy'
import { emitKnowledgeArticlesEvent } from '../events'
import {
  KNOWLEDGE_ARTICLE_RESOURCE_KIND,
  articleCrudEvents,
  articleCrudIndexer,
  enforceKnowledgeOptimisticLock,
  ensureScope,
  resolveUndoScope,
  validationError,
} from './shared'

export type SerializedArticle = {
  id: string
  categoryId: string
  key: string
  title: string
  summary: string | null
  keywords: string[]
  body: string | null
  procedureSteps: KnowledgeProcedureStep[]
  applicability: string | null
  requiredChecks: KnowledgeRequiredCheck[]
  recommendedActions: KnowledgeRecommendedAction[]
  automationLevel: KnowledgeAutomationLevel
  manualReason: string | null
  targetQueueKey: string | null
  priorityFloor: KnowledgePriorityFloor | null
  replyTemplate: string | null
  status: KnowledgeArticleStatus
  version: number
  tenantId: string
  organizationId: string
}

export type PublishArticleResult = {
  articleId: string
  key: string
  version: number
  versionId: string
}

const CHANGE_KEYS = [
  'categoryId',
  'key',
  'title',
  'summary',
  'keywords',
  'body',
  'procedureSteps',
  'applicability',
  'requiredChecks',
  'recommendedActions',
  'automationLevel',
  'manualReason',
  'targetQueueKey',
  'priorityFloor',
  'replyTemplate',
]

export function serializeArticle(article: KnowledgeArticle): SerializedArticle {
  return {
    id: article.id,
    categoryId: article.categoryId,
    key: article.key,
    title: article.title,
    summary: article.summary ?? null,
    keywords: [...(article.keywords ?? [])],
    body: article.body ?? null,
    procedureSteps: (article.procedureSteps ?? []).map((step) => ({ ...step })),
    applicability: article.applicability ?? null,
    requiredChecks: (article.requiredChecks ?? []).map((check) => ({ ...check })),
    recommendedActions: (article.recommendedActions ?? []).map((action) => ({ ...action })),
    automationLevel: article.automationLevel,
    manualReason: article.manualReason ?? null,
    targetQueueKey: article.targetQueueKey ?? null,
    priorityFloor: article.priorityFloor ?? null,
    replyTemplate: article.replyTemplate ?? null,
    status: article.status,
    version: article.version,
    tenantId: article.tenantId,
    organizationId: article.organizationId,
  }
}

function applyArticleSnapshot(entity: KnowledgeArticle, snapshot: SerializedArticle): void {
  entity.categoryId = snapshot.categoryId
  entity.key = snapshot.key
  entity.title = snapshot.title
  entity.summary = snapshot.summary
  entity.keywords = [...snapshot.keywords]
  entity.body = snapshot.body
  entity.procedureSteps = snapshot.procedureSteps
  entity.applicability = snapshot.applicability
  entity.requiredChecks = snapshot.requiredChecks
  entity.recommendedActions = snapshot.recommendedActions
  entity.automationLevel = snapshot.automationLevel
  entity.manualReason = snapshot.manualReason
  entity.targetQueueKey = snapshot.targetQueueKey
  entity.priorityFloor = snapshot.priorityFloor
  entity.replyTemplate = snapshot.replyTemplate
}

function resolveEm(ctx: CommandRuntimeContext): EntityManager {
  return ctx.container.resolve('em') as EntityManager
}

function resolveDataEngine(ctx: CommandRuntimeContext): DataEngine {
  return ctx.container.resolve('dataEngine') as DataEngine
}

async function assertArticleCategory(em: EntityManager, scope: KnowledgeScope, categoryId: string): Promise<void> {
  const category = await loadCategory(em, scope, categoryId)
  const error = articleCategoryError(category ? { level: category.level } : null)
  if (error) throw validationError(error, { categoryId: error })
}

async function assertUniqueArticleKey(em: EntityManager, scope: KnowledgeScope, key: string, selfId?: string): Promise<void> {
  const existing = await loadArticleByKey(em, scope, key)
  if (existing && existing.id !== selfId) {
    throw new CrudHttpError(409, { error: 'knowledge_articles.errors.duplicateKey', fieldErrors: { key: 'knowledge_articles.errors.duplicateKey' } })
  }
}

export function assertArticleStructure(input: {
  procedureSteps: KnowledgeProcedureStep[]
  requiredChecks: KnowledgeRequiredCheck[]
  recommendedActions: KnowledgeRecommendedAction[]
}): void {
  const issues = validateArticleStructure(input)
  if (!issues.length) return
  const fieldErrors: Record<string, string> = {}
  for (const issue of issues) {
    if (!fieldErrors[issue.field]) fieldErrors[issue.field] = issue.messageKey
  }
  throw validationError(issues[0].messageKey, fieldErrors)
}

async function emitArticle(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  entity: KnowledgeArticle | null,
  id: string,
  scope: KnowledgeScope,
  undo = false,
): Promise<void> {
  const emit = undo ? emitCrudUndoSideEffects : emitCrudSideEffects
  await emit({
    dataEngine: resolveDataEngine(ctx),
    action,
    entity,
    identifiers: { id, tenantId: scope.tenantId, organizationId: scope.organizationId },
    syncOrigin: ctx.syncOrigin,
    events: articleCrudEvents,
    indexer: articleCrudIndexer,
  })
}

const createArticleCommand: CommandHandler<Record<string, unknown>, KnowledgeArticle> = {
  id: 'knowledge_articles.article.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = articleCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = resolveEm(ctx)
    await assertArticleCategory(em, scope, parsed.categoryId)
    await assertUniqueArticleKey(em, scope, parsed.key)
    const procedureSteps = parsed.procedureSteps ?? []
    const requiredChecks = parsed.requiredChecks ?? []
    const recommendedActions = parsed.recommendedActions ?? []
    assertArticleStructure({ procedureSteps, requiredChecks, recommendedActions })
    const article = await resolveDataEngine(ctx).createOrmEntity({
      entity: KnowledgeArticle,
      data: {
        ...(parsed.id ? { id: parsed.id } : {}),
        categoryId: parsed.categoryId,
        key: parsed.key,
        title: parsed.title,
        summary: parsed.summary ?? null,
        keywords: parsed.keywords ?? [],
        body: parsed.body ?? null,
        procedureSteps,
        applicability: parsed.applicability ?? null,
        requiredChecks,
        recommendedActions,
        automationLevel: parsed.automationLevel ?? 'manual_only',
        manualReason: parsed.manualReason ?? null,
        targetQueueKey: parsed.targetQueueKey ?? null,
        priorityFloor: parsed.priorityFloor ?? null,
        replyTemplate: parsed.replyTemplate ?? null,
        status: 'draft',
        version: 0,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
    })
    await emitArticle(ctx, 'created', article, article.id, scope)
    return article
  },
  captureAfter: (_input, result) => serializeArticle(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('knowledge_articles.audit.article.create', 'Create knowledge article'),
      resourceKind: KNOWLEDGE_ARTICLE_RESOURCE_KIND,
      resourceId: result.id,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      snapshotAfter: serializeArticle(result),
      payload: { undo: { after: serializeArticle(result) } },
    }
  },
  async undo({ logEntry, ctx }) {
    const snapshot = extractUndoPayload<UndoPayload<SerializedArticle>>(logEntry)?.after ?? undefined
    const id = snapshot?.id ?? logEntry.resourceId
    if (!id) throw new Error('[internal] Missing knowledge article id for undo')
    const scope = resolveUndoScope(ctx, snapshot)
    const removed = await resolveDataEngine(ctx).deleteOrmEntity({
      entity: KnowledgeArticle,
      where: { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<KnowledgeArticle>,
      soft: true,
      softDeleteField: 'deletedAt',
    })
    await emitArticle(ctx, 'deleted', removed, id, scope, true)
  },
}

const updateArticleCommand: CommandHandler<Record<string, unknown>, KnowledgeArticle> = {
  id: 'knowledge_articles.article.update',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = articleUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const existing = await loadArticle(resolveEm(ctx), scope, parsed.id)
    if (!existing) throw notFound('knowledge_articles.errors.articleNotFound')
    await enforceKnowledgeOptimisticLock(ctx, existing, KNOWLEDGE_ARTICLE_RESOURCE_KIND)
    return { before: serializeArticle(existing) }
  },
  async execute(rawInput, ctx) {
    const parsed = articleUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = resolveEm(ctx)
    const existing = await loadArticle(em, scope, parsed.id)
    if (!existing) throw notFound('knowledge_articles.errors.articleNotFound')
    if (parsed.categoryId && parsed.categoryId !== existing.categoryId) {
      await assertArticleCategory(em, scope, parsed.categoryId)
    }
    if (parsed.key && parsed.key !== existing.key) await assertUniqueArticleKey(em, scope, parsed.key, existing.id)
    assertArticleStructure({
      procedureSteps: parsed.procedureSteps ?? existing.procedureSteps ?? [],
      requiredChecks: parsed.requiredChecks ?? existing.requiredChecks ?? [],
      recommendedActions: parsed.recommendedActions ?? existing.recommendedActions ?? [],
    })
    const updated = await resolveDataEngine(ctx).updateOrmEntity({
      entity: KnowledgeArticle,
      where: { id: parsed.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<KnowledgeArticle>,
      apply: (entity) => {
        if (parsed.categoryId !== undefined) entity.categoryId = parsed.categoryId
        if (parsed.key !== undefined) entity.key = parsed.key
        if (parsed.title !== undefined) entity.title = parsed.title
        if (parsed.summary !== undefined) entity.summary = parsed.summary ?? null
        if (parsed.keywords !== undefined) entity.keywords = parsed.keywords
        if (parsed.body !== undefined) entity.body = parsed.body ?? null
        if (parsed.procedureSteps !== undefined) entity.procedureSteps = parsed.procedureSteps
        if (parsed.applicability !== undefined) entity.applicability = parsed.applicability ?? null
        if (parsed.requiredChecks !== undefined) entity.requiredChecks = parsed.requiredChecks
        if (parsed.recommendedActions !== undefined) entity.recommendedActions = parsed.recommendedActions
        if (parsed.automationLevel !== undefined) entity.automationLevel = parsed.automationLevel
        if (parsed.manualReason !== undefined) entity.manualReason = parsed.manualReason ?? null
        if (parsed.targetQueueKey !== undefined) entity.targetQueueKey = parsed.targetQueueKey ?? null
        if (parsed.priorityFloor !== undefined) entity.priorityFloor = parsed.priorityFloor ?? null
        if (parsed.replyTemplate !== undefined) entity.replyTemplate = parsed.replyTemplate ?? null
      },
    })
    if (!updated) throw notFound('knowledge_articles.errors.articleNotFound')
    await emitArticle(ctx, 'updated', updated, updated.id, scope)
    return updated
  },
  captureAfter: (_input, result) => serializeArticle(result),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedArticle | undefined
    const after = serializeArticle(result)
    return {
      actionLabel: translate('knowledge_articles.audit.article.update', 'Update knowledge article'),
      resourceKind: KNOWLEDGE_ARTICLE_RESOURCE_KIND,
      resourceId: result.id,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      changes: buildChanges(before ?? null, after as unknown as Record<string, unknown>, CHANGE_KEYS),
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      payload: { undo: { before: before ?? null, after } },
    }
  },
  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<SerializedArticle>>(logEntry)?.before ?? undefined
    if (!before?.id) throw new Error('[internal] Missing knowledge article snapshot for undo')
    const scope = resolveUndoScope(ctx, before)
    const restored = await resolveDataEngine(ctx).updateOrmEntity({
      entity: KnowledgeArticle,
      where: { id: before.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<KnowledgeArticle>,
      apply: (entity) => applyArticleSnapshot(entity, before),
    })
    await emitArticle(ctx, 'updated', restored, before.id, scope, true)
  },
}

const deleteArticleCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, KnowledgeArticle> = {
  id: 'knowledge_articles.article.delete',
  isUndoable: true,
  async prepare(input, ctx) {
    const id = requireId(input, 'knowledge_articles.errors.idRequired')
    const scope = ensureScope(ctx)
    const existing = await loadArticle(resolveEm(ctx), scope, id)
    if (!existing) return {}
    await enforceKnowledgeOptimisticLock(ctx, existing, KNOWLEDGE_ARTICLE_RESOURCE_KIND)
    return { before: serializeArticle(existing) }
  },
  async execute(input, ctx) {
    const id = requireId(input, 'knowledge_articles.errors.idRequired')
    const scope = ensureScope(ctx)
    const removed = await resolveDataEngine(ctx).deleteOrmEntity({
      entity: KnowledgeArticle,
      where: { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<KnowledgeArticle>,
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('knowledge_articles.errors.articleNotFound')
    await emitArticle(ctx, 'deleted', removed, id, scope)
    return removed
  },
  buildLog: async ({ snapshots, input }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedArticle | undefined
    return {
      actionLabel: translate('knowledge_articles.audit.article.delete', 'Delete knowledge article'),
      resourceKind: KNOWLEDGE_ARTICLE_RESOURCE_KIND,
      resourceId: requireId(input, 'knowledge_articles.errors.idRequired'),
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      payload: { undo: { before: before ?? null } },
    }
  },
  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<SerializedArticle>>(logEntry)?.before ?? undefined
    if (!before?.id) throw new Error('[internal] Missing knowledge article snapshot for undo')
    const scope = resolveUndoScope(ctx, before)
    const em = resolveEm(ctx)
    const conflicting = await loadArticleByKey(em, scope, before.key)
    if (conflicting && conflicting.id !== before.id) {
      throw new CrudHttpError(409, { error: 'knowledge_articles.errors.duplicateKey' })
    }
    const restored = await em.findOne(KnowledgeArticle, {
      id: before.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!restored) throw notFound('knowledge_articles.errors.articleNotFound')
    restored.deletedAt = null
    applyArticleSnapshot(restored, before)
    await em.persist(restored).flush()
    await emitArticle(ctx, 'updated', restored, before.id, scope, true)
  },
}

const publishArticleCommand: CommandHandler<Record<string, unknown>, PublishArticleResult> = {
  id: 'knowledge_articles.article.publish',
  isUndoable: false,
  async prepare(rawInput, ctx) {
    const parsed = articlePublishSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const existing = await loadArticle(resolveEm(ctx), scope, parsed.id)
    if (!existing) throw notFound('knowledge_articles.errors.articleNotFound')
    await enforceKnowledgeOptimisticLock(ctx, existing, KNOWLEDGE_ARTICLE_RESOURCE_KIND)
    return { before: serializeArticle(existing) }
  },
  async execute(rawInput, ctx) {
    const parsed = articlePublishSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const userId = ctx.auth?.sub ?? null
    const em = resolveEm(ctx).fork()
    const published = await em.transactional(async (tem) => {
      const article = await findOneWithDecryption(
        tem,
        KnowledgeArticle,
        { id: parsed.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
        scope,
      )
      if (!article) throw notFound('knowledge_articles.errors.articleNotFound')
      const { category, subcategory } = await loadArticlePath(tem, scope, article.categoryId)
      const categoryError = articleCategoryError(subcategory ? { level: subcategory.level } : null)
      if (categoryError) throw validationError(categoryError, { categoryId: categoryError })
      assertArticleStructure({
        procedureSteps: article.procedureSteps ?? [],
        requiredChecks: article.requiredChecks ?? [],
        recommendedActions: article.recommendedActions ?? [],
      })
      const publishedAt = new Date()
      const nextVersion = (article.version ?? 0) + 1
      const versionRow = tem.create(KnowledgeArticleVersion, {
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
        articleId: article.id,
        articleKey: article.key,
        version: nextVersion,
        snapshot: buildArticleSnapshot({ article, version: nextVersion, category, subcategory, publishedAt }),
        publishedByUserId: userId,
        createdAt: publishedAt,
      })
      article.version = nextVersion
      article.status = 'published'
      article.publishedAt = publishedAt
      tem.persist(versionRow)
      await tem.flush()
      return { article, versionRow }
    })
    await emitArticle(ctx, 'updated', published.article, published.article.id, scope)
    await emitKnowledgeArticlesEvent(
      'knowledge_articles.article.published',
      {
        id: published.article.id,
        key: published.article.key,
        version: published.versionRow.version,
        versionId: published.versionRow.id,
        automationLevel: published.article.automationLevel,
        publishedByUserId: userId,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
      { persistent: true, tenantId: scope.tenantId, organizationId: scope.organizationId },
    )
    return {
      articleId: published.article.id,
      key: published.article.key,
      version: published.versionRow.version,
      versionId: published.versionRow.id,
    }
  },
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedArticle | undefined
    return {
      actionLabel: translate('knowledge_articles.audit.article.publish', 'Publish knowledge article'),
      resourceKind: KNOWLEDGE_ARTICLE_RESOURCE_KIND,
      resourceId: result.articleId,
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      changes: { version: { from: before?.version ?? null, to: result.version } },
      snapshotBefore: before ?? null,
    }
  },
}

registerCommand(createArticleCommand)
registerCommand(updateArticleCommand)
registerCommand(deleteArticleCommand)
registerCommand(publishArticleCommand)
