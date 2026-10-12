import type { CommandHandler, CommandRuntimeContext } from '@open-mercato/shared/lib/commands'
import { registerCommand } from '@open-mercato/shared/lib/commands'
import { buildChanges, emitCrudSideEffects, emitCrudUndoSideEffects, requireId } from '@open-mercato/shared/lib/commands/helpers'
import { CrudHttpError, notFound } from '@open-mercato/shared/lib/crud/errors'
import { extractUndoPayload, type UndoPayload } from '@open-mercato/shared/lib/commands/undo'
import type { DataEngine } from '@open-mercato/shared/lib/data/engine'
import { findWithDecryption } from '@open-mercato/shared/lib/encryption/find'
import { resolveTranslations } from '@open-mercato/shared/lib/i18n/server'
import type { EntityManager, FilterQuery } from '@mikro-orm/postgresql'
import { KnowledgeArticle, KnowledgeCategory } from '../data/entities'
import {
  categoryCreateSchema,
  categoryUpdateSchema,
  type KnowledgeCategoryLevel,
} from '../data/validators'
import { loadCategory, loadCategoryByKey, type KnowledgeScope } from '../lib/repository'
import { categoryPlacementError } from '../lib/taxonomy'
import {
  KNOWLEDGE_CATEGORY_RESOURCE_KIND,
  categoryCrudEvents,
  categoryCrudIndexer,
  enforceKnowledgeOptimisticLock,
  ensureScope,
  resolveUndoScope,
  validationError,
} from './shared'

export type SerializedCategory = {
  id: string
  parentId: string | null
  level: KnowledgeCategoryLevel
  key: string
  name: string
  description: string | null
  position: number
  isActive: boolean
  tenantId: string
  organizationId: string
}

export function serializeCategory(category: KnowledgeCategory): SerializedCategory {
  return {
    id: category.id,
    parentId: category.parentId ?? null,
    level: category.level,
    key: category.key,
    name: category.name,
    description: category.description ?? null,
    position: category.position,
    isActive: category.isActive,
    tenantId: category.tenantId,
    organizationId: category.organizationId,
  }
}

function applyCategorySnapshot(entity: KnowledgeCategory, snapshot: SerializedCategory): void {
  entity.parentId = snapshot.parentId
  entity.level = snapshot.level
  entity.key = snapshot.key
  entity.name = snapshot.name
  entity.description = snapshot.description
  entity.position = snapshot.position
  entity.isActive = snapshot.isActive
}

function resolveEm(ctx: CommandRuntimeContext): EntityManager {
  return ctx.container.resolve('em') as EntityManager
}

function resolveDataEngine(ctx: CommandRuntimeContext): DataEngine {
  return ctx.container.resolve('dataEngine') as DataEngine
}

async function assertPlacement(
  em: EntityManager,
  scope: KnowledgeScope,
  level: KnowledgeCategoryLevel,
  parentId: string | null,
  selfId?: string,
): Promise<void> {
  if (selfId && parentId === selfId) throw validationError('knowledge_articles.errors.subcategoryParentMustBeCategory', { parentId: 'knowledge_articles.errors.subcategoryParentMustBeCategory' })
  const parent = parentId ? await loadCategory(em, scope, parentId) : null
  if (parentId && !parent) throw validationError('knowledge_articles.errors.parentNotFound', { parentId: 'knowledge_articles.errors.parentNotFound' })
  const error = categoryPlacementError({ level, parent: parent ? { id: parent.id, level: parent.level } : null })
  if (error) throw validationError(error, { parentId: error })
}

async function assertUniqueKey(em: EntityManager, scope: KnowledgeScope, key: string, selfId?: string): Promise<void> {
  const existing = await loadCategoryByKey(em, scope, key)
  if (existing && existing.id !== selfId) {
    throw new CrudHttpError(409, { error: 'knowledge_articles.errors.duplicateKey', fieldErrors: { key: 'knowledge_articles.errors.duplicateKey' } })
  }
}

async function assertCategoryEmpty(em: EntityManager, scope: KnowledgeScope, category: KnowledgeCategory): Promise<void> {
  if (category.level === 'category') {
    const children = await findWithDecryption(
      em,
      KnowledgeCategory,
      { parentId: category.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      { limit: 1 },
      scope,
    )
    if (children.length) throw validationError('knowledge_articles.errors.categoryHasChildren')
  } else {
    const articles = await findWithDecryption(
      em,
      KnowledgeArticle,
      { categoryId: category.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null },
      { limit: 1 },
      scope,
    )
    if (articles.length) throw validationError('knowledge_articles.errors.categoryHasArticles')
  }
}

async function assertLevelChangeAllowed(em: EntityManager, scope: KnowledgeScope, category: KnowledgeCategory, nextLevel: KnowledgeCategoryLevel): Promise<void> {
  if (category.level === nextLevel) return
  await assertCategoryEmpty(em, scope, category)
}

async function emitCategory(
  ctx: CommandRuntimeContext,
  action: 'created' | 'updated' | 'deleted',
  entity: KnowledgeCategory | null,
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
    events: categoryCrudEvents,
    indexer: categoryCrudIndexer,
  })
}

const createCategoryCommand: CommandHandler<Record<string, unknown>, KnowledgeCategory> = {
  id: 'knowledge_articles.category.create',
  isUndoable: true,
  async execute(rawInput, ctx) {
    const parsed = categoryCreateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = resolveEm(ctx)
    await assertPlacement(em, scope, parsed.level, parsed.parentId ?? null)
    await assertUniqueKey(em, scope, parsed.key)
    const category = await resolveDataEngine(ctx).createOrmEntity({
      entity: KnowledgeCategory,
      data: {
        ...(parsed.id ? { id: parsed.id } : {}),
        parentId: parsed.level === 'category' ? null : parsed.parentId ?? null,
        level: parsed.level,
        key: parsed.key,
        name: parsed.name,
        description: parsed.description ?? null,
        position: parsed.position ?? 0,
        isActive: parsed.isActive ?? true,
        tenantId: scope.tenantId,
        organizationId: scope.organizationId,
      },
    })
    await emitCategory(ctx, 'created', category, category.id, scope)
    return category
  },
  captureAfter: (_input, result) => serializeCategory(result),
  buildLog: async ({ result }) => {
    const { translate } = await resolveTranslations()
    return {
      actionLabel: translate('knowledge_articles.audit.category.create', 'Create knowledge category'),
      resourceKind: 'knowledge_articles.category',
      resourceId: result.id,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      snapshotAfter: serializeCategory(result),
      payload: { undo: { after: serializeCategory(result) } },
    }
  },
  async undo({ logEntry, ctx }) {
    const snapshot = extractUndoPayload<UndoPayload<SerializedCategory>>(logEntry)?.after ?? undefined
    const id = snapshot?.id ?? logEntry.resourceId
    if (!id) throw new Error('[internal] Missing knowledge category id for undo')
    const scope = resolveUndoScope(ctx, snapshot)
    const removed = await resolveDataEngine(ctx).deleteOrmEntity({
      entity: KnowledgeCategory,
      where: { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<KnowledgeCategory>,
      soft: true,
      softDeleteField: 'deletedAt',
    })
    await emitCategory(ctx, 'deleted', removed, id, scope, true)
  },
}

const updateCategoryCommand: CommandHandler<Record<string, unknown>, KnowledgeCategory> = {
  id: 'knowledge_articles.category.update',
  isUndoable: true,
  async prepare(rawInput, ctx) {
    const parsed = categoryUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const existing = await loadCategory(resolveEm(ctx), scope, parsed.id)
    if (!existing) throw notFound('knowledge_articles.errors.categoryNotFound')
    await enforceKnowledgeOptimisticLock(ctx, existing, KNOWLEDGE_CATEGORY_RESOURCE_KIND)
    return { before: serializeCategory(existing) }
  },
  async execute(rawInput, ctx) {
    const parsed = categoryUpdateSchema.parse(rawInput)
    const scope = ensureScope(ctx)
    const em = resolveEm(ctx)
    const existing = await loadCategory(em, scope, parsed.id)
    if (!existing) throw notFound('knowledge_articles.errors.categoryNotFound')
    const nextLevel = parsed.level ?? existing.level
    const nextParentId = nextLevel === 'category'
      ? null
      : parsed.parentId !== undefined ? parsed.parentId : existing.parentId ?? null
    await assertPlacement(em, scope, nextLevel, nextParentId, existing.id)
    await assertLevelChangeAllowed(em, scope, existing, nextLevel)
    if (parsed.key && parsed.key !== existing.key) await assertUniqueKey(em, scope, parsed.key, existing.id)
    const updated = await resolveDataEngine(ctx).updateOrmEntity({
      entity: KnowledgeCategory,
      where: { id: parsed.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<KnowledgeCategory>,
      apply: (entity) => {
        entity.level = nextLevel
        entity.parentId = nextParentId
        if (parsed.key !== undefined) entity.key = parsed.key
        if (parsed.name !== undefined) entity.name = parsed.name
        if (parsed.description !== undefined) entity.description = parsed.description ?? null
        if (parsed.position !== undefined) entity.position = parsed.position
        if (parsed.isActive !== undefined) entity.isActive = parsed.isActive
      },
    })
    if (!updated) throw notFound('knowledge_articles.errors.categoryNotFound')
    await emitCategory(ctx, 'updated', updated, updated.id, scope)
    return updated
  },
  captureAfter: (_input, result) => serializeCategory(result),
  buildLog: async ({ result, snapshots }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedCategory | undefined
    const after = serializeCategory(result)
    return {
      actionLabel: translate('knowledge_articles.audit.category.update', 'Update knowledge category'),
      resourceKind: 'knowledge_articles.category',
      resourceId: result.id,
      tenantId: result.tenantId,
      organizationId: result.organizationId,
      changes: buildChanges(before ?? null, after as unknown as Record<string, unknown>, ['parentId', 'level', 'key', 'name', 'description', 'position', 'isActive']),
      snapshotBefore: before ?? null,
      snapshotAfter: after,
      payload: { undo: { before: before ?? null, after } },
    }
  },
  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<SerializedCategory>>(logEntry)?.before ?? undefined
    if (!before?.id) throw new Error('[internal] Missing knowledge category snapshot for undo')
    const scope = resolveUndoScope(ctx, before)
    const restored = await resolveDataEngine(ctx).updateOrmEntity({
      entity: KnowledgeCategory,
      where: { id: before.id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<KnowledgeCategory>,
      apply: (entity) => applyCategorySnapshot(entity, before),
    })
    await emitCategory(ctx, 'updated', restored, before.id, scope, true)
  },
}

const deleteCategoryCommand: CommandHandler<{ body?: Record<string, unknown>; query?: Record<string, unknown> }, KnowledgeCategory> = {
  id: 'knowledge_articles.category.delete',
  isUndoable: true,
  async prepare(input, ctx) {
    const id = requireId(input, 'knowledge_articles.errors.idRequired')
    const scope = ensureScope(ctx)
    const existing = await loadCategory(resolveEm(ctx), scope, id)
    if (!existing) return {}
    await enforceKnowledgeOptimisticLock(ctx, existing, KNOWLEDGE_CATEGORY_RESOURCE_KIND)
    return { before: serializeCategory(existing) }
  },
  async execute(input, ctx) {
    const id = requireId(input, 'knowledge_articles.errors.idRequired')
    const scope = ensureScope(ctx)
    const em = resolveEm(ctx)
    const existing = await loadCategory(em, scope, id)
    if (!existing) throw notFound('knowledge_articles.errors.categoryNotFound')
    await assertCategoryEmpty(em, scope, existing)
    const removed = await resolveDataEngine(ctx).deleteOrmEntity({
      entity: KnowledgeCategory,
      where: { id, tenantId: scope.tenantId, organizationId: scope.organizationId, deletedAt: null } as FilterQuery<KnowledgeCategory>,
      soft: true,
      softDeleteField: 'deletedAt',
    })
    if (!removed) throw notFound('knowledge_articles.errors.categoryNotFound')
    await emitCategory(ctx, 'deleted', removed, id, scope)
    return removed
  },
  buildLog: async ({ snapshots, input }) => {
    const { translate } = await resolveTranslations()
    const before = snapshots.before as SerializedCategory | undefined
    return {
      actionLabel: translate('knowledge_articles.audit.category.delete', 'Delete knowledge category'),
      resourceKind: 'knowledge_articles.category',
      resourceId: requireId(input, 'knowledge_articles.errors.idRequired'),
      tenantId: before?.tenantId ?? null,
      organizationId: before?.organizationId ?? null,
      snapshotBefore: before ?? null,
      payload: { undo: { before: before ?? null } },
    }
  },
  async undo({ logEntry, ctx }) {
    const before = extractUndoPayload<UndoPayload<SerializedCategory>>(logEntry)?.before ?? undefined
    if (!before?.id) throw new Error('[internal] Missing knowledge category snapshot for undo')
    const scope = resolveUndoScope(ctx, before)
    const em = resolveEm(ctx)
    const conflicting = await loadCategoryByKey(em, scope, before.key)
    if (conflicting && conflicting.id !== before.id) {
      throw new CrudHttpError(409, { error: 'knowledge_articles.errors.duplicateKey' })
    }
    const restored = await em.findOne(KnowledgeCategory, {
      id: before.id,
      tenantId: scope.tenantId,
      organizationId: scope.organizationId,
    })
    if (!restored) throw notFound('knowledge_articles.errors.categoryNotFound')
    restored.deletedAt = null
    applyCategorySnapshot(restored, before)
    await em.persist(restored).flush()
    await emitCategory(ctx, 'updated', restored, before.id, scope, true)
  },
}

registerCommand(createCategoryCommand)
registerCommand(updateCategoryCommand)
registerCommand(deleteCategoryCommand)
