import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';
import type { ModuleEncryptionMap } from '@open-mercato/shared/modules/encryption';

const TICKETS_ENCRYPTION_MAPS: ModuleEncryptionMap[] = [
  {
    entityId: 'tickets:ticket',
    fields: [
      { field: 'subject' },
      { field: 'requester_email', hashField: 'requester_email_hash' },
      { field: 'requester_name' },
      { field: 'summary' },
    ],
  },
  {
    entityId: 'tickets:ticket_article',
    fields: [{ field: 'from_email' }, { field: 'to_email' }, { field: 'subject' }, { field: 'body_text' }, { field: 'body_html' }],
  },
  {
    entityId: 'tickets:ticket_reply_draft',
    fields: [{ field: 'subject' }, { field: 'body' }],
  },
];

export class Migration20261012170214_tickets extends Migration {

  override name = 'Migration20261012170214';

  override up(): void | Promise<void> {
    this.addSql(`create table "tickets" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "number" varchar(20) not null, "subject" text not null, "channel" text not null, "queue_key" varchar(100) not null default 'general', "status" text not null default 'new', "priority" text not null default 'normal', "priority_rank" smallint not null default 2, "priority_reason" varchar(200) null, "requester_email" text not null, "requester_email_hash" text null, "requester_name" text null, "customer_person_id" uuid null, "reservation_id" uuid null, "reservation_number_snapshot" varchar(100) null, "category_key" varchar(200) null, "subcategory_key" varchar(200) null, "topic_key" varchar(200) null, "category_path_snapshot" varchar(500) null, "summary" text null, "needs_manual_review" boolean not null default false, "manual_review_reason_code" varchar(100) null, "manual_review_reason" text null, "classified_at" timestamptz null, "classification_source" text null, "assignee_user_id" uuid null, "last_inbound_at" timestamptz null, "last_outbound_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "tickets_requester_hash_idx" on "tickets" ("organization_id", "requester_email_hash");`);
    this.addSql(`create index "tickets_reservation_idx" on "tickets" ("organization_id", "reservation_id");`);
    this.addSql(`create index "tickets_manual_review_idx" on "tickets" ("organization_id", "needs_manual_review");`);
    this.addSql(`create index "tickets_customer_idx" on "tickets" ("organization_id", "customer_person_id");`);
    this.addSql(`create index "tickets_queue_idx" on "tickets" ("organization_id", "queue_key");`);
    this.addSql(`create index "tickets_status_priority_idx" on "tickets" ("organization_id", "status", "priority");`);
    this.addSql(`alter table "tickets" add constraint "tickets_number_unique" unique ("tenant_id", "organization_id", "number");`);

    this.addSql(`create table "ticket_articles" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "ticket_id" uuid not null, "direction" text not null, "from_email" text null, "to_email" text null, "subject" text null, "body_text" text not null, "body_html" text null, "message_id" varchar(998) null, "in_reply_to" varchar(998) null, "author_user_id" uuid null, "source_inbox_email_id" uuid null, "delivery_status" text not null, "sent_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "ticket_articles_inbox_email_unique" on "ticket_articles" ("organization_id", "source_inbox_email_id") where "source_inbox_email_id" is not null;`);
    this.addSql(`create unique index "ticket_articles_message_id_unique" on "ticket_articles" ("organization_id", "message_id") where "message_id" is not null;`);
    this.addSql(`create index "ticket_articles_ticket_idx" on "ticket_articles" ("ticket_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "ticket_reply_drafts" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "ticket_id" uuid not null, "subject" text null, "body" text not null, "status" text not null default 'draft', "source_type" varchar(50) null, "source_ref" varchar(200) null, "created_by_user_id" uuid null, "sent_article_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "ticket_reply_drafts_ticket_idx" on "ticket_reply_drafts" ("ticket_id", "organization_id", "tenant_id");`);

    this.addSql(`create table "ticket_sequences" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "next_number" int not null default 1, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`alter table "ticket_sequences" add constraint "ticket_sequences_scope_unique" unique ("tenant_id", "organization_id");`);

    for (const map of TICKETS_ENCRYPTION_MAPS) {
      this.addSql(buildEncryptionMapBackfillSql(map));
    }
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "ticket_sequences" cascade;`);
    this.addSql(`drop table if exists "ticket_reply_drafts" cascade;`);
    this.addSql(`drop table if exists "ticket_articles" cascade;`);
    this.addSql(`drop table if exists "tickets" cascade;`);
  }

}
