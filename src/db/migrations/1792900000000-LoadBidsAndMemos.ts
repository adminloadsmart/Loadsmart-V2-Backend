import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 2 sourcing: bids on market loads (and the indent's acceptance), the load memo the
// shipper accepts before the trip starts, and loads.memo_accepted_at that the trip start waits
// on. Also the activity actions for both.
const ACTIVITY_ACTIONS = [
  'BID_RECORDED',
  'BID_ACCEPTED',
  'DRIVER_NAMED',
  'MEMO_SENT',
  'MEMO_ACCEPTED',
];

export class LoadBidsAndMemos1792900000000 implements MigrationInterface {
  name = 'LoadBidsAndMemos1792900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "loads"."load_bids_channel_enum" AS ENUM('web', 'whatsapp')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."load_bids_status_enum" AS ENUM('received', 'accepted', 'rejected', 'expired')`,
    );
    await queryRunner.query(
      `CREATE TABLE "loads"."load_bids" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "load_id" uuid NOT NULL,
        "recipient_id" uuid,
        "transporter_id" uuid NOT NULL,
        "rate" numeric(12,2) NOT NULL,
        "vehicle_number" character varying(20),
        "truck_verified" boolean,
        "channel" "loads"."load_bids_channel_enum" NOT NULL DEFAULT 'web',
        "status" "loads"."load_bids_status_enum" NOT NULL DEFAULT 'received',
        "expires_at" TIMESTAMP WITH TIME ZONE,
        "entered_by" uuid,
        "entry_reason" character varying(500),
        "decided_at" TIMESTAMP WITH TIME ZONE,
        "decided_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_load_bids_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_load_bids_load" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_load_bids_recipient" FOREIGN KEY ("recipient_id") REFERENCES "loads"."load_recipients"("id") ON DELETE SET NULL,
        CONSTRAINT "FK_load_bids_transporter" FOREIGN KEY ("transporter_id") REFERENCES "masters"."transporters"("id") ON DELETE RESTRICT
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "load_bids_tenant_load_idx" ON "loads"."load_bids" ("tenant_id", "load_id")`,
    );
    // One live bid per transporter per load — a new quote revises it.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "load_bids_one_live_per_transporter" ON "loads"."load_bids" ("load_id", "transporter_id") WHERE "status" = 'received'`,
    );

    await queryRunner.query(
      `CREATE TYPE "loads"."load_memos_status_enum" AS ENUM('sent', 'accepted', 'expired')`,
    );
    await queryRunner.query(
      `CREATE TABLE "loads"."load_memos" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "load_id" uuid NOT NULL,
        "status" "loads"."load_memos_status_enum" NOT NULL DEFAULT 'sent',
        "transporter_id" uuid,
        "vehicle_number" character varying(20) NOT NULL,
        "driver_name" character varying(150) NOT NULL,
        "driver_mobile" character varying(20) NOT NULL,
        "loading_contact_name" character varying(150),
        "loading_contact_phone" character varying(20),
        "loading_point_note" character varying(300),
        "sent_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "sent_by" uuid,
        "expires_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "accepted_at" TIMESTAMP WITH TIME ZONE,
        "accepted_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_load_memos_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_load_memos_load" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "load_memos_tenant_load_idx" ON "loads"."load_memos" ("tenant_id", "load_id")`,
    );

    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD "memo_accepted_at" TIMESTAMP WITH TIME ZONE`,
    );
    // Loads already past Truck assigned predate the memo — treat them as accepted so a trip that
    // is already running isn't blocked.
    await queryRunner.query(
      `UPDATE "loads"."loads" SET "memo_accepted_at" = COALESCE("in_transit_loading_at", "updated_at")
       WHERE "source_type" <> 'own_fleet' AND "status" NOT IN ('created', 'bids_received', 'truck_assigned')`,
    );

    for (const action of ACTIVITY_ACTIONS) {
      await queryRunner.query(
        `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS '${action}'`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The activity actions stay on their enum — Postgres can't drop a value.
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "memo_accepted_at"`);
    await queryRunner.query(`DROP TABLE "loads"."load_memos"`);
    await queryRunner.query(`DROP TYPE "loads"."load_memos_status_enum"`);
    await queryRunner.query(`DROP TABLE "loads"."load_bids"`);
    await queryRunner.query(`DROP TYPE "loads"."load_bids_status_enum"`);
    await queryRunner.query(`DROP TYPE "loads"."load_bids_channel_enum"`);
  }
}
