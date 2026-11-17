import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phases 6–7 of the Load module rebuild — Loadsmart placement and execution.
 *
 * Placement: brokers' lanes and truck types, the round-robin roster, the load's Placement owner
 * and "lost" record, memo withdrawal, and Approval posting for a shipper (who asked, on which
 * channel, the proof). The Verification team's approval is gone (memo goes out once checks pass).
 *
 * Execution: one e-LR series across Loadsmart (loads.elr_series, LSLR-nnnnnn) with its revision
 * history; charges a shipper can query, and pre-approved charge heads in the commercial terms;
 * the carrier advance chain — raised by Tracking, decided by Super Admin, paid by Payables (rows
 * paid before this keep status `paid`).
 */
export class LoadsmartPlacementAndExecution1794900000000 implements MigrationInterface {
  name = 'LoadsmartPlacementAndExecution1794900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- Brokers: lanes, truck types, profile ---
    await queryRunner.query(
      `CREATE TABLE "loads"."ls_partner_lanes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "partner_id" uuid NOT NULL, "from_city" character varying(100) NOT NULL, "to_city" character varying(100) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_2381a80bcc6badc996ef6822187" PRIMARY KEY ("id"), CONSTRAINT "FK_ls_partner_lanes_partner" FOREIGN KEY ("partner_id") REFERENCES "loads"."ls_partners"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ls_partner_lanes_partner_idx" ON "loads"."ls_partner_lanes" ("partner_id")`,
    );
    await queryRunner.query(
      `CREATE TABLE "loads"."ls_partner_truck_types" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "partner_id" uuid NOT NULL, "body_type" character varying(40) NOT NULL, "capacity_tons" numeric(6,2), "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_fd4e4ab9c92c1c65014fcc27b4f" PRIMARY KEY ("id"), CONSTRAINT "FK_ls_partner_truck_types_partner" FOREIGN KEY ("partner_id") REFERENCES "loads"."ls_partners"("id") ON DELETE CASCADE)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ls_partner_truck_types_partner_idx" ON "loads"."ls_partner_truck_types" ("partner_id")`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."ls_partners" ADD "advance_percent" numeric(5,2)`);
    await queryRunner.query(`ALTER TABLE "loads"."ls_partners" ADD "note_for_placement" text`);
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_partners" ADD "trucker_sales_name" character varying(150)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_partners" ADD "trucker_sales_phone" character varying(15)`,
    );

    // --- Placement: roster, owner, lost ---
    await queryRunner.query(
      `CREATE TABLE "loads"."ls_placement_roster" ("user_id" uuid NOT NULL, "on_duty" boolean NOT NULL DEFAULT true, "turn_order" integer NOT NULL, "updated_by" uuid, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_f90328f3c78c7dff67d4fb41d65" PRIMARY KEY ("user_id"))`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."ls_sourcings" ADD "placement_owner_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_sourcings" ADD "placement_assigned_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_sourcings" ADD "lost_reason_code" character varying(50)`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."ls_sourcings" ADD "lost_note" text`);
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_sourcings" ADD "lost_shipper_rate" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_sourcings" ADD "lost_broker_rate" numeric(12,2)`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."ls_sourcings" ADD "lost_by" uuid`);
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_sourcings" ADD "lost_at" TIMESTAMP WITH TIME ZONE`,
    );
    // The Verification team's approval is retired.
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_sourcings" DROP COLUMN "verification_approved_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" DROP COLUMN "ls_verification_approved_at"`,
    );

    // --- Approval posts for a shipper ---
    await queryRunner.query(`ALTER TABLE "loads"."load_postings" ADD "posted_on_behalf_by" uuid`);
    await queryRunner.query(
      `ALTER TABLE "loads"."load_postings" ADD "on_behalf_channel" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_postings" ADD "on_behalf_requested_by" character varying(150)`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."load_postings" ADD "on_behalf_proof_key" text`);

    // --- Enum values ---
    await queryRunner.query(
      `ALTER TYPE "storage"."files_purpose_enum" ADD VALUE IF NOT EXISTS 'loads/posting-request'`,
    );
    await queryRunner.query(
      `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS 'MEMO_WITHDRAWN'`,
    );
    await queryRunner.query(
      `ALTER TYPE "loads"."load_memos_status_enum" ADD VALUE IF NOT EXISTS 'withdrawn'`,
    );
    await queryRunner.query(
      `ALTER TYPE "loads"."load_charges_status_enum" ADD VALUE IF NOT EXISTS 'queried'`,
    );

    // --- e-LR: one series across Loadsmart, and its revisions ---
    await queryRunner.query(
      `CREATE TABLE "loads"."elr_series" ("series" character varying(30) NOT NULL, "prefix" character varying(10) NOT NULL, "next_number" integer NOT NULL DEFAULT 1, CONSTRAINT "PK_elr_series" PRIMARY KEY ("series"), CONSTRAINT "CHK_elr_series_next_number" CHECK ("next_number" > 0))`,
    );
    await queryRunner.query(
      `INSERT INTO "loads"."elr_series" ("series", "prefix", "next_number") VALUES ('loadsmart', 'LSLR', 1)`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."load_elr_revisions_action_enum" AS ENUM('issued', 'edited', 'cancelled')`,
    );
    await queryRunner.query(
      `CREATE TABLE "loads"."load_elr_revisions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "load_id" uuid NOT NULL, "elr_number" character varying(50) NOT NULL, "revision" integer NOT NULL, "action" "loads"."load_elr_revisions_action_enum" NOT NULL, "reason" character varying(40), "note" text, "changes" jsonb, "file_key" text, "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_847f07ba813d7d26283735a5d07" PRIMARY KEY ("id"), CONSTRAINT "FK_load_elr_revisions_load" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE RESTRICT)`,
    );
    await queryRunner.query(
      `CREATE INDEX "load_elr_revisions_load_idx" ON "loads"."load_elr_revisions" ("load_id", "revision")`,
    );

    // --- Charges: shipper queries, pre-approved heads ---
    await queryRunner.query(
      `ALTER TABLE "loads"."load_charges" ADD "preapproved" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_charges" ADD "query_reason" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_charges" ADD "queried_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_charges" ADD "query_reply" character varying(1000)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_charges" ADD "replied_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_commercial_terms" ADD "preapproved_charges" jsonb NOT NULL DEFAULT '[]'`,
    );

    // --- Carrier payments: raised → approved / on hold / rejected → paid ---
    await queryRunner.query(
      `CREATE TYPE "loads"."ls_partner_payments_status_enum" AS ENUM('raised', 'approved', 'on_hold', 'rejected', 'paid')`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_partner_payments" ADD "status" "loads"."ls_partner_payments_status_enum" NOT NULL DEFAULT 'paid'`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."ls_partner_payments" ADD "lines" jsonb`);
    await queryRunner.query(`ALTER TABLE "loads"."ls_partner_payments" ADD "raised_by" uuid`);
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_partner_payments" ADD "raised_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."ls_partner_payments" ADD "decided_by" uuid`);
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_partner_payments" ADD "decided_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."ls_partner_payments" ADD "decision_reason" text`);
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_partner_payments" ALTER COLUMN "utr_reference" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_partner_payments" ALTER COLUMN "paid_at" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Unpaid carrier payments cannot exist without a UTR in the old shape.
    await queryRunner.query(`DELETE FROM "loads"."ls_partner_payments" WHERE "status" <> 'paid'`);
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_partner_payments" ALTER COLUMN "paid_at" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_partner_payments" ALTER COLUMN "utr_reference" SET NOT NULL`,
    );
    for (const column of [
      'decision_reason',
      'decided_at',
      'decided_by',
      'raised_at',
      'raised_by',
      'lines',
      'status',
    ]) {
      await queryRunner.query(`ALTER TABLE "loads"."ls_partner_payments" DROP COLUMN "${column}"`);
    }
    await queryRunner.query(`DROP TYPE "loads"."ls_partner_payments_status_enum"`);

    await queryRunner.query(
      `ALTER TABLE "loads"."ls_commercial_terms" DROP COLUMN "preapproved_charges"`,
    );
    // A queried charge goes back to raised; the enum value itself stays (Postgres can't drop it).
    await queryRunner.query(
      `UPDATE "loads"."load_charges" SET "status" = 'raised' WHERE "status" = 'queried'`,
    );
    for (const column of [
      'replied_at',
      'query_reply',
      'queried_at',
      'query_reason',
      'preapproved',
    ]) {
      await queryRunner.query(`ALTER TABLE "loads"."load_charges" DROP COLUMN "${column}"`);
    }

    await queryRunner.query(`DROP TABLE "loads"."load_elr_revisions"`);
    await queryRunner.query(`DROP TYPE "loads"."load_elr_revisions_action_enum"`);
    await queryRunner.query(`DROP TABLE "loads"."elr_series"`);

    // Withdrawn memos read as expired in the old shape; the enum values stay.
    await queryRunner.query(
      `UPDATE "loads"."load_memos" SET "status" = 'expired' WHERE "status" = 'withdrawn'`,
    );

    for (const column of [
      'on_behalf_proof_key',
      'on_behalf_requested_by',
      'on_behalf_channel',
      'posted_on_behalf_by',
    ]) {
      await queryRunner.query(`ALTER TABLE "loads"."load_postings" DROP COLUMN "${column}"`);
    }

    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD "ls_verification_approved_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_sourcings" ADD "verification_approved_by" uuid`,
    );
    for (const column of [
      'lost_at',
      'lost_by',
      'lost_broker_rate',
      'lost_shipper_rate',
      'lost_note',
      'lost_reason_code',
      'placement_assigned_at',
      'placement_owner_id',
    ]) {
      await queryRunner.query(`ALTER TABLE "loads"."ls_sourcings" DROP COLUMN "${column}"`);
    }
    await queryRunner.query(`DROP TABLE "loads"."ls_placement_roster"`);

    for (const column of [
      'trucker_sales_phone',
      'trucker_sales_name',
      'note_for_placement',
      'advance_percent',
    ]) {
      await queryRunner.query(`ALTER TABLE "loads"."ls_partners" DROP COLUMN "${column}"`);
    }
    await queryRunner.query(`DROP TABLE "loads"."ls_partner_truck_types"`);
    await queryRunner.query(`DROP TABLE "loads"."ls_partner_lanes"`);
  }
}
