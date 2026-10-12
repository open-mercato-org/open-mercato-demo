import { Migration } from '@mikro-orm/migrations';

export class Migration20261012170136_knowledge_articles extends Migration {

  override name = 'Migration20261012170136';

  override up(): void | Promise<void> {
    this.addSql(`create table "knowledge_articles" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "category_id" uuid not null, "key" varchar(160) not null, "title" text not null, "summary" text null, "keywords" text[] not null, "body" text null, "procedure_steps" jsonb not null, "applicability" text null, "required_checks" jsonb not null, "recommended_actions" jsonb not null, "automation_level" text not null default 'manual_only', "manual_reason" text null, "target_queue_key" text null, "priority_floor" text null, "reply_template" text null, "status" text not null default 'draft', "version" int not null default 0, "published_at" timestamptz null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "knowledge_articles_key_unique" on "knowledge_articles" ("tenant_id", "organization_id", "key") where "deleted_at" is null;`);
    this.addSql(`create index "knowledge_articles_status_idx" on "knowledge_articles" ("organization_id", "tenant_id", "status");`);
    this.addSql(`create index "knowledge_articles_category_idx" on "knowledge_articles" ("organization_id", "tenant_id", "category_id");`);

    this.addSql(`create table "knowledge_article_versions" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "article_id" uuid not null, "article_key" varchar(160) not null, "version" int not null, "snapshot" jsonb not null, "published_by_user_id" uuid null, "created_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "knowledge_article_versions_scope_idx" on "knowledge_article_versions" ("organization_id", "tenant_id", "article_key");`);
    this.addSql(`alter table "knowledge_article_versions" add constraint "knowledge_article_versions_article_version_unique" unique ("article_id", "version");`);

    this.addSql(`create table "knowledge_categories" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "parent_id" uuid null, "level" text not null, "key" varchar(120) not null, "name" text not null, "description" text null, "position" int not null default 0, "is_active" boolean not null default true, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "knowledge_categories_key_unique" on "knowledge_categories" ("tenant_id", "organization_id", "key") where "deleted_at" is null;`);
    this.addSql(`create index "knowledge_categories_parent_idx" on "knowledge_categories" ("organization_id", "tenant_id", "parent_id");`);
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "knowledge_article_versions" cascade;`);
    this.addSql(`drop table if exists "knowledge_articles" cascade;`);
    this.addSql(`drop table if exists "knowledge_categories" cascade;`);
  }

}
