import { OptionalProps } from '@mikro-orm/core'
import { Entity, Index, PrimaryKey, Property, Unique } from '@mikro-orm/decorators/legacy'
import type {
  ArticleDeliveryStatus,
  ArticleDirection,
  ClassificationSource,
  DraftStatus,
  TicketChannel,
  TicketPriority,
  TicketStatus,
} from './constants'

@Entity({ tableName: 'tickets' })
@Unique({ name: 'tickets_number_unique', properties: ['tenantId', 'organizationId', 'number'] })
@Index({ name: 'tickets_status_priority_idx', properties: ['organizationId', 'status', 'priority'] })
@Index({ name: 'tickets_queue_idx', properties: ['organizationId', 'queueKey'] })
@Index({ name: 'tickets_customer_idx', properties: ['organizationId', 'customerPersonId'] })
@Index({ name: 'tickets_manual_review_idx', properties: ['organizationId', 'needsManualReview'] })
@Index({ name: 'tickets_reservation_idx', properties: ['organizationId', 'reservationId'] })
@Index({ name: 'tickets_requester_hash_idx', properties: ['organizationId', 'requesterEmailHash'] })
export class Ticket {
  [OptionalProps]?:
    | 'status'
    | 'priority'
    | 'priorityRank'
    | 'needsManualReview'
    | 'queueKey'
    | 'createdAt'
    | 'updatedAt'
    | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'number', type: 'varchar', length: 20 })
  number!: string

  @Property({ name: 'subject', type: 'text' })
  subject!: string

  @Property({ name: 'channel', type: 'text' })
  channel!: TicketChannel

  @Property({ name: 'queue_key', type: 'varchar', length: 100, default: 'general' })
  queueKey: string = 'general'

  @Property({ name: 'status', type: 'text', default: 'new' })
  status: TicketStatus = 'new'

  @Property({ name: 'priority', type: 'text', default: 'normal' })
  priority: TicketPriority = 'normal'

  @Property({ name: 'priority_rank', type: 'smallint', default: 2 })
  priorityRank: number = 2

  @Property({ name: 'priority_reason', type: 'varchar', length: 200, nullable: true })
  priorityReason?: string | null

  @Property({ name: 'requester_email', type: 'text' })
  requesterEmail!: string

  @Property({ name: 'requester_email_hash', type: 'text', nullable: true })
  requesterEmailHash?: string | null

  @Property({ name: 'requester_name', type: 'text', nullable: true })
  requesterName?: string | null

  @Property({ name: 'customer_person_id', type: 'uuid', nullable: true })
  customerPersonId?: string | null

  @Property({ name: 'reservation_id', type: 'uuid', nullable: true })
  reservationId?: string | null

  @Property({ name: 'reservation_number_snapshot', type: 'varchar', length: 100, nullable: true })
  reservationNumberSnapshot?: string | null

  @Property({ name: 'category_key', type: 'varchar', length: 200, nullable: true })
  categoryKey?: string | null

  @Property({ name: 'subcategory_key', type: 'varchar', length: 200, nullable: true })
  subcategoryKey?: string | null

  @Property({ name: 'topic_key', type: 'varchar', length: 200, nullable: true })
  topicKey?: string | null

  @Property({ name: 'category_path_snapshot', type: 'varchar', length: 500, nullable: true })
  categoryPathSnapshot?: string | null

  @Property({ name: 'summary', type: 'text', nullable: true })
  summary?: string | null

  @Property({ name: 'needs_manual_review', type: 'boolean', default: false })
  needsManualReview: boolean = false

  @Property({ name: 'manual_review_reason_code', type: 'varchar', length: 100, nullable: true })
  manualReviewReasonCode?: string | null

  @Property({ name: 'manual_review_reason', type: 'text', nullable: true })
  manualReviewReason?: string | null

  @Property({ name: 'classified_at', type: Date, nullable: true })
  classifiedAt?: Date | null

  @Property({ name: 'classification_source', type: 'text', nullable: true })
  classificationSource?: ClassificationSource | null

  @Property({ name: 'assignee_user_id', type: 'uuid', nullable: true })
  assigneeUserId?: string | null

  @Property({ name: 'last_inbound_at', type: Date, nullable: true })
  lastInboundAt?: Date | null

  @Property({ name: 'last_outbound_at', type: Date, nullable: true })
  lastOutboundAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'ticket_articles' })
@Index({ name: 'ticket_articles_ticket_idx', properties: ['ticketId', 'organizationId', 'tenantId'] })
@Index({
  name: 'ticket_articles_message_id_unique',
  expression:
    'create unique index "ticket_articles_message_id_unique" on "ticket_articles" ("organization_id", "message_id") where "message_id" is not null',
})
@Index({
  name: 'ticket_articles_inbox_email_unique',
  expression:
    'create unique index "ticket_articles_inbox_email_unique" on "ticket_articles" ("organization_id", "source_inbox_email_id") where "source_inbox_email_id" is not null',
})
export class TicketArticle {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'ticket_id', type: 'uuid' })
  ticketId!: string

  @Property({ name: 'direction', type: 'text' })
  direction!: ArticleDirection

  @Property({ name: 'from_email', type: 'text', nullable: true })
  fromEmail?: string | null

  @Property({ name: 'to_email', type: 'text', nullable: true })
  toEmail?: string | null

  @Property({ name: 'subject', type: 'text', nullable: true })
  subject?: string | null

  @Property({ name: 'body_text', type: 'text' })
  bodyText!: string

  @Property({ name: 'body_html', type: 'text', nullable: true })
  bodyHtml?: string | null

  @Property({ name: 'message_id', type: 'varchar', length: 998, nullable: true })
  messageId?: string | null

  @Property({ name: 'in_reply_to', type: 'varchar', length: 998, nullable: true })
  inReplyTo?: string | null

  @Property({ name: 'author_user_id', type: 'uuid', nullable: true })
  authorUserId?: string | null

  @Property({ name: 'source_inbox_email_id', type: 'uuid', nullable: true })
  sourceInboxEmailId?: string | null

  @Property({ name: 'delivery_status', type: 'text' })
  deliveryStatus!: ArticleDeliveryStatus

  @Property({ name: 'sent_at', type: Date, nullable: true })
  sentAt?: Date | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'ticket_reply_drafts' })
@Index({ name: 'ticket_reply_drafts_ticket_idx', properties: ['ticketId', 'organizationId', 'tenantId'] })
export class TicketReplyDraft {
  [OptionalProps]?: 'status' | 'createdAt' | 'updatedAt' | 'deletedAt'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'ticket_id', type: 'uuid' })
  ticketId!: string

  @Property({ name: 'subject', type: 'text', nullable: true })
  subject?: string | null

  @Property({ name: 'body', type: 'text' })
  body!: string

  @Property({ name: 'status', type: 'text', default: 'draft' })
  status: DraftStatus = 'draft'

  @Property({ name: 'source_type', type: 'varchar', length: 50, nullable: true })
  sourceType?: string | null

  @Property({ name: 'source_ref', type: 'varchar', length: 200, nullable: true })
  sourceRef?: string | null

  @Property({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null

  @Property({ name: 'sent_article_id', type: 'uuid', nullable: true })
  sentArticleId?: string | null

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()

  @Property({ name: 'deleted_at', type: Date, nullable: true })
  deletedAt?: Date | null
}

@Entity({ tableName: 'ticket_sequences' })
@Unique({ name: 'ticket_sequences_scope_unique', properties: ['tenantId', 'organizationId'] })
export class TicketSequence {
  [OptionalProps]?: 'createdAt' | 'updatedAt' | 'nextNumber'

  @PrimaryKey({ type: 'uuid', defaultRaw: 'gen_random_uuid()' })
  id!: string

  @Property({ name: 'organization_id', type: 'uuid' })
  organizationId!: string

  @Property({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string

  @Property({ name: 'next_number', type: 'int', default: 1 })
  nextNumber: number = 1

  @Property({ name: 'created_at', type: Date, onCreate: () => new Date() })
  createdAt: Date = new Date()

  @Property({ name: 'updated_at', type: Date, onCreate: () => new Date(), onUpdate: () => new Date() })
  updatedAt: Date = new Date()
}
