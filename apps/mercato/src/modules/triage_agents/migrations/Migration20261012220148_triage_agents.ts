import { Migration } from '@mikro-orm/migrations';

export class Migration20261012220148_triage_agents extends Migration {

  override name = 'Migration20261012220148';

  override up(): void | Promise<void> {
    this.addSql(`create table "ticket_triages" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "ticket_id" uuid not null, "ticket_number" varchar(64) null, "process_execution_id" uuid null, "workflow_instance_id" uuid null, "stage" text not null default 'queued', "ai_mode" text null, "reason_code" varchar(100) null, "reason" text null, "route" varchar(20) null, "priority" varchar(20) null, "priority_reason" text null, "identification" jsonb null, "classification" jsonb null, "uncertainty" jsonb null, "confidence" numeric(5,4) null, "recommended_action_label" varchar(200) null, "proposal_id" uuid null, "disposition" varchar(40) null, "draft_state" text not null default 'none', "grounding_state" text not null default 'not_checked', "grounding_issues" jsonb null, "run_ids" jsonb null, "attempt" int not null default 1, "attempts" jsonb null, "created_at" timestamptz not null, "updated_at" timestamptz not null, primary key ("id"));`);
    this.addSql(`create index "ticket_triages_proposal_idx" on "ticket_triages" ("organization_id", "proposal_id");`);
    this.addSql(`create index "ticket_triages_workflow_idx" on "ticket_triages" ("organization_id", "workflow_instance_id");`);
    this.addSql(`create index "ticket_triages_scope_idx" on "ticket_triages" ("tenant_id", "organization_id", "ai_mode");`);
    this.addSql(`alter table "ticket_triages" add constraint "ticket_triages_ticket_unique" unique ("organization_id", "ticket_id");`);
  }

}
