import { Migration } from '@mikro-orm/migrations';
import { buildEncryptionMapBackfillSql } from '@open-mercato/shared/lib/encryption/migration-backfill';

export class Migration20261012165911_reservations extends Migration {

  override name = 'Migration20261012165911';

  override up(): void | Promise<void> {
    this.addSql(`create table "reservations" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "booking_number" varchar(32) not null, "customer_person_id" uuid not null, "customer_email_snapshot" text null, "customer_email_hash" text null, "customer_name_snapshot" text null, "status" text not null default 'pending_payment', "destination" varchar(200) not null, "hotel_name" varchar(200) not null, "room_type" varchar(120) null, "board_type" varchar(120) null, "departure_date" date not null, "return_date" date not null, "travelers_count" int not null default 1, "total_price_amount" numeric(14,2) not null, "currency_code" varchar(3) not null, "notes" text null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create unique index "reservations_booking_number_unique" on "reservations" ("organization_id", "booking_number") where "deleted_at" is null;`);
    this.addSql(`create index "reservations_email_hash_idx" on "reservations" ("organization_id", "customer_email_hash");`);
    this.addSql(`create index "reservations_departure_idx" on "reservations" ("organization_id", "departure_date");`);
    this.addSql(`create index "reservations_customer_idx" on "reservations" ("organization_id", "customer_person_id");`);

    this.addSql(`create table "reservation_payments" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "reservation_id" uuid not null, "amount" numeric(14,2) not null, "currency_code" varchar(3) not null, "status" text not null default 'pending', "method" text not null default 'transfer', "paid_at" timestamptz null, "booked_at" timestamptz null, "external_reference" varchar(200) null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "reservation_payments_reservation_idx" on "reservation_payments" ("organization_id", "reservation_id");`);

    this.addSql(`create table "reservation_refunds" ("id" uuid not null default gen_random_uuid(), "organization_id" uuid not null, "tenant_id" uuid not null, "reservation_id" uuid not null, "amount" numeric(14,2) not null, "currency_code" varchar(3) not null, "bank_account_number" text not null, "bank_account_last4" varchar(4) not null, "reason" text null, "status" text not null default 'requested', "requested_by_user_id" uuid null, "source_type" varchar(64) null, "source_ref" varchar(200) null, "related_ticket_id" uuid null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "deleted_at" timestamptz null, primary key ("id"));`);
    this.addSql(`create index "reservation_refunds_reservation_idx" on "reservation_refunds" ("organization_id", "reservation_id");`);

    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'reservations:reservation',
      fields: [
        { field: 'customer_email_snapshot', hashField: 'customer_email_hash' },
        { field: 'customer_name_snapshot' },
        { field: 'notes' },
      ],
    }));
    this.addSql(buildEncryptionMapBackfillSql({
      entityId: 'reservations:reservation_refund',
      fields: [
        { field: 'bank_account_number' },
        { field: 'reason' },
      ],
    }));
  }

  override down(): void | Promise<void> {
    this.addSql(`drop table if exists "reservation_refunds" cascade;`);
    this.addSql(`drop table if exists "reservation_payments" cascade;`);
    this.addSql(`drop table if exists "reservations" cascade;`);
  }

}
