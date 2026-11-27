import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The broker page (Masters → Brokers → one broker): the identity onboarding verified, who
 * approved the broker and when, the ASM, and the notes the team logs against the broker.
 * Aadhaar keeps only its last 4 digits — the full number is never stored.
 */
export class BrokerDetail1795570000000 implements MigrationInterface {
  name = 'BrokerDetail1795570000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."brokers"
         ADD COLUMN IF NOT EXISTS "business_type" varchar(40),
         ADD COLUMN IF NOT EXISTS "pan_number" varchar(10),
         ADD COLUMN IF NOT EXISTS "pan_verified" boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS "aadhaar_last4" varchar(4),
         ADD COLUMN IF NOT EXISTS "aadhaar_linked_to_pan" boolean NOT NULL DEFAULT false,
         ADD COLUMN IF NOT EXISTS "asm_name" varchar(150),
         ADD COLUMN IF NOT EXISTS "approved_by" uuid,
         ADD COLUMN IF NOT EXISTS "approved_at" timestamptz`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "loads"."broker_notes" (
         "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
         "broker_id" uuid NOT NULL,
         "body" text NOT NULL,
         "created_by" uuid,
         "created_at" timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT "FK_broker_notes_broker" FOREIGN KEY ("broker_id")
           REFERENCES "loads"."brokers" ("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "broker_notes_broker_idx"
         ON "loads"."broker_notes" ("broker_id", "created_at" DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "loads"."broker_notes"`);
    await queryRunner.query(
      `ALTER TABLE "loads"."brokers"
         DROP COLUMN IF EXISTS "business_type",
         DROP COLUMN IF EXISTS "pan_number",
         DROP COLUMN IF EXISTS "pan_verified",
         DROP COLUMN IF EXISTS "aadhaar_last4",
         DROP COLUMN IF EXISTS "aadhaar_linked_to_pan",
         DROP COLUMN IF EXISTS "asm_name",
         DROP COLUMN IF EXISTS "approved_by",
         DROP COLUMN IF EXISTS "approved_at"`,
    );
  }
}
