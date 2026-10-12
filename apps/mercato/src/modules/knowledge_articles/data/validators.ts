import { z } from 'zod'

export const KNOWLEDGE_CATEGORY_LEVELS = ['category', 'subcategory'] as const
export const KNOWLEDGE_AUTOMATION_LEVELS = ['assisted', 'manual_only'] as const
export const KNOWLEDGE_PRIORITY_FLOORS = ['low', 'normal', 'high', 'urgent'] as const
export const KNOWLEDGE_ARTICLE_STATUSES = ['draft', 'published'] as const

export const knowledgeCategoryLevelSchema = z.enum(KNOWLEDGE_CATEGORY_LEVELS)
export const knowledgeAutomationLevelSchema = z.enum(KNOWLEDGE_AUTOMATION_LEVELS)
export const knowledgePriorityFloorSchema = z.enum(KNOWLEDGE_PRIORITY_FLOORS)
export const knowledgeArticleStatusSchema = z.enum(KNOWLEDGE_ARTICLE_STATUSES)

export type KnowledgeCategoryLevel = z.infer<typeof knowledgeCategoryLevelSchema>
export type KnowledgeAutomationLevel = z.infer<typeof knowledgeAutomationLevelSchema>
export type KnowledgePriorityFloor = z.infer<typeof knowledgePriorityFloorSchema>
export type KnowledgeArticleStatus = z.infer<typeof knowledgeArticleStatusSchema>

export const KNOWLEDGE_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/
export const KNOWLEDGE_STEP_ID_PATTERN = /^S[1-9][0-9]*$/
export const KNOWLEDGE_CHECK_KEY_PATTERN = /^[a-z][a-z0-9_]*$/
export const KNOWLEDGE_ACTION_KEY_PATTERN = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/

const optionalText = (max: number) =>
  z.preprocess((value) => {
    if (typeof value !== 'string') return value
    const trimmed = value.trim()
    return trimmed.length ? trimmed : null
  }, z.string().max(max).nullable().optional())

export const categoryKeySchema = z.string().trim().min(1).max(120).regex(KNOWLEDGE_KEY_PATTERN, 'knowledge_articles.errors.invalidKey')
export const articleKeySchema = z.string().trim().min(1).max(160).regex(KNOWLEDGE_KEY_PATTERN, 'knowledge_articles.errors.invalidKey')

export const procedureStepSchema = z.object({
  id: z.string().trim().regex(KNOWLEDGE_STEP_ID_PATTERN, 'knowledge_articles.errors.invalidStepId'),
  text: z.string().trim().min(1).max(2000),
  checkKey: optionalText(80),
  actionKey: optionalText(160),
})

export const requiredCheckSchema = z.object({
  key: z.string().trim().min(1).max(80).regex(KNOWLEDGE_CHECK_KEY_PATTERN, 'knowledge_articles.errors.invalidCheckKey'),
  label: z.string().trim().min(1).max(200),
  description: optionalText(1000),
})

export const recommendedActionSchema = z.object({
  actionKey: z.string().trim().min(1).max(160).regex(KNOWLEDGE_ACTION_KEY_PATTERN, 'knowledge_articles.errors.invalidActionKey'),
  label: z.string().trim().min(1).max(200),
  requiresApproval: z.boolean().default(true),
  preconditions: z.array(z.string().trim().min(1).max(80)).max(20).optional(),
})

export type KnowledgeProcedureStep = z.infer<typeof procedureStepSchema>
export type KnowledgeRequiredCheck = z.infer<typeof requiredCheckSchema>
export type KnowledgeRecommendedAction = z.infer<typeof recommendedActionSchema>

const keywordsSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)
  }
  return value
}, z.array(z.string().trim().min(1).max(80)).max(50))

export const categoryCreateSchema = z.object({
  id: z.string().uuid().optional(),
  parentId: z.string().uuid().nullable().optional(),
  level: knowledgeCategoryLevelSchema,
  key: categoryKeySchema,
  name: z.string().trim().min(1).max(200),
  description: optionalText(2000),
  position: z.coerce.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
})

export const categoryUpdateSchema = z.object({
  id: z.string().uuid(),
  parentId: z.string().uuid().nullable().optional(),
  level: knowledgeCategoryLevelSchema.optional(),
  key: categoryKeySchema.optional(),
  name: z.string().trim().min(1).max(200).optional(),
  description: optionalText(2000),
  position: z.coerce.number().int().min(0).max(100000).optional(),
  isActive: z.boolean().optional(),
})

export type CategoryCreateInput = z.infer<typeof categoryCreateSchema>
export type CategoryUpdateInput = z.infer<typeof categoryUpdateSchema>

const articleContentShape = {
  categoryId: z.string().uuid(),
  key: articleKeySchema,
  title: z.string().trim().min(1).max(300),
  summary: optionalText(4000),
  keywords: keywordsSchema.optional(),
  body: optionalText(50000),
  procedureSteps: z.array(procedureStepSchema).max(50).optional(),
  applicability: optionalText(4000),
  requiredChecks: z.array(requiredCheckSchema).max(50).optional(),
  recommendedActions: z.array(recommendedActionSchema).max(50).optional(),
  automationLevel: knowledgeAutomationLevelSchema.optional(),
  manualReason: optionalText(2000),
  targetQueueKey: optionalText(120),
  priorityFloor: knowledgePriorityFloorSchema.nullable().optional(),
  replyTemplate: optionalText(20000),
}

export const articleCreateSchema = z.object({
  id: z.string().uuid().optional(),
  ...articleContentShape,
})

export const articleUpdateSchema = z.object({
  id: z.string().uuid(),
  categoryId: articleContentShape.categoryId.optional(),
  key: articleContentShape.key.optional(),
  title: articleContentShape.title.optional(),
  summary: articleContentShape.summary,
  keywords: articleContentShape.keywords,
  body: articleContentShape.body,
  procedureSteps: articleContentShape.procedureSteps,
  applicability: articleContentShape.applicability,
  requiredChecks: articleContentShape.requiredChecks,
  recommendedActions: articleContentShape.recommendedActions,
  automationLevel: articleContentShape.automationLevel,
  manualReason: articleContentShape.manualReason,
  targetQueueKey: articleContentShape.targetQueueKey,
  priorityFloor: articleContentShape.priorityFloor,
  replyTemplate: articleContentShape.replyTemplate,
})

export const articlePublishSchema = z.object({
  id: z.string().uuid(),
})

export type ArticleCreateInput = z.infer<typeof articleCreateSchema>
export type ArticleUpdateInput = z.infer<typeof articleUpdateSchema>
export type ArticlePublishInput = z.infer<typeof articlePublishSchema>

export const articleSnapshotSchema = z.object({
  id: z.string(),
  key: z.string(),
  version: z.number().int(),
  title: z.string(),
  summary: z.string().nullable(),
  keywords: z.array(z.string()),
  body: z.string().nullable(),
  applicability: z.string().nullable(),
  category: z.object({ key: z.string(), name: z.string() }).nullable(),
  subcategory: z.object({ key: z.string(), name: z.string() }).nullable(),
  procedureSteps: z.array(procedureStepSchema),
  requiredChecks: z.array(requiredCheckSchema),
  recommendedActions: z.array(recommendedActionSchema),
  automationLevel: knowledgeAutomationLevelSchema,
  manualReason: z.string().nullable(),
  targetQueueKey: z.string().nullable(),
  priorityFloor: knowledgePriorityFloorSchema.nullable(),
  replyTemplate: z.string().nullable(),
  publishedAt: z.string(),
})

export type KnowledgeArticleSnapshot = z.infer<typeof articleSnapshotSchema>
