import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import type {
  KnowledgeArticleStatus,
  KnowledgeAutomationLevel,
  KnowledgeCategoryLevel,
  KnowledgePriorityFloor,
  KnowledgeProcedureStep,
  KnowledgeRecommendedAction,
  KnowledgeRequiredCheck,
  KnowledgeArticleSnapshot,
} from './validators'

@Entity({ tableName: 'knowledge_categories' })
@Index({ name: 'knowledge_categories_parent_idx', properties: ['organizationId', 'tenantId', 'parentId'] })
@Index({
  name: 'knowledge_categories_key_unique',
  expression:
    'create unique index "knowledge_categories_key_unique" on "knowledge_categories" ("tenant_id", "organization_id", "key") where "deleted_at" is null',
})
export class KnowledgeCategory {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'position' | 'isActive'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'parent_id', type: 'uuid', nullable: true })
  parentId?: string | null

  @Property({ name: 'level', type: 'text' })
  level!: KnowledgeCategoryLevel

  @Property({ name: 'key', type: 'varchar', length: 120 })
  key!: string

  @Property({ name: 'name', type: 'text' })
  name!: string

  @Property({ name: 'description', type: 'text', nullable: true })
  description?: string | null

  @Property({ name: 'position', type: 'int', default: 0 })
  position: number = 0

  @Property({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean = true

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'knowledge_articles' })
@Index({ name: 'knowledge_articles_category_idx', properties: ['organizationId', 'tenantId', 'categoryId'] })
@Index({ name: 'knowledge_articles_status_idx', properties: ['organizationId', 'tenantId', 'status'] })
@Index({
  name: 'knowledge_articles_key_unique',
  expression:
    'create unique index "knowledge_articles_key_unique" on "knowledge_articles" ("tenant_id", "organization_id", "key") where "deleted_at" is null',
})
export class KnowledgeArticle {
  [OptionalProps]?:
    | 'createdAt'
    | 'updatedAt'
    | 'keywords'
    | 'procedureSteps'
    | 'requiredChecks'
    | 'recommendedActions'
    | 'automationLevel'
    | 'status'
    | 'version'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'category_id', type: 'uuid' })
  categoryId!: string

  @Property({ name: 'key', type: 'varchar', length: 160 })
  key!: string

  @Property({ name: 'title', type: 'text' })
  title!: string

  @Property({ name: 'summary', type: 'text', nullable: true })
  summary?: string | null

  @Property({ name: 'keywords', type: 'text[]' })
  keywords: string[] = []

  @Property({ name: 'body', type: 'text', nullable: true })
  body?: string | null

  @Property({ name: 'procedure_steps', type: 'jsonb' })
  procedureSteps: KnowledgeProcedureStep[] = []

  @Property({ name: 'applicability', type: 'text', nullable: true })
  applicability?: string | null

  @Property({ name: 'required_checks', type: 'jsonb' })
  requiredChecks: KnowledgeRequiredCheck[] = []

  @Property({ name: 'recommended_actions', type: 'jsonb' })
  recommendedActions: KnowledgeRecommendedAction[] = []

  @Property({ name: 'automation_level', type: 'text', default: 'manual_only' })
  automationLevel: KnowledgeAutomationLevel = 'manual_only'

  @Property({ name: 'manual_reason', type: 'text', nullable: true })
  manualReason?: string | null

  @Property({ name: 'target_queue_key', type: 'text', nullable: true })
  targetQueueKey?: string | null

  @Property({ name: 'priority_floor', type: 'text', nullable: true })
  priorityFloor?: KnowledgePriorityFloor | null

  @Property({ name: 'reply_template', type: 'text', nullable: true })
  replyTemplate?: string | null

  @Property({ name: 'status', type: 'text', default: 'draft' })
  status: KnowledgeArticleStatus = 'draft'

  @Property({ name: 'version', type: 'int', default: 0 })
  version: number = 0

  @Property({ name: 'published_at', type: Date, nullable: true })
  publishedAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'knowledge_article_versions' })
@Index({ name: 'knowledge_article_versions_scope_idx', properties: ['organizationId', 'tenantId', 'articleKey'] })
@Unique({ name: 'knowledge_article_versions_article_version_unique', properties: ['articleId', 'version'] })
export class KnowledgeArticleVersion {
  [OptionalProps]?: 'createdAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'article_id', type: 'uuid' })
  articleId!: string

  @Property({ name: 'article_key', type: 'varchar', length: 160 })
  articleKey!: string

  @Property({ name: 'version', type: 'int' })
  version!: number

  @Property({ name: 'snapshot', type: 'jsonb' })
  snapshot!: KnowledgeArticleSnapshot

  @Property({ name: 'published_by_user_id', type: 'uuid', nullable: true })
  publishedByUserId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()
}
