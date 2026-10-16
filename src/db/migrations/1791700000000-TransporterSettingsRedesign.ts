import { MigrationInterface, QueryRunner } from 'typeorm';

// Settings redesign — Transporters: TRP-nnnn display code (backfilled per tenant by created_at and
// seeded into loads.code_sequences), GST register fields, GST treatment, fleet size, truck type,
// UPI and penny-drop bank verification; POC cards (transporter_contacts) and operating lanes
// (transporter_lanes).
export class TransporterSettingsRedesign1791700000000 implements MigrationInterface {
  name = 'TransporterSettingsRedesign1791700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "masters"."transporters_gst_verification_status_enum" AS ENUM('verified', 'unverified')`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."transporters_gst_treatment_enum" AS ENUM('forward_charge', 'reverse_charge')`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."transporters_truck_body_type_enum" AS ENUM('open', 'closed')`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."transporters_bank_verification_status_enum" AS ENUM('verified', 'rejected', 'pending')`,
    );
    await queryRunner.query(`
      ALTER TABLE "masters"."transporters"
        ADD "code" character varying(20),
        ADD "pan" character varying(10),
        ADD "constitution" character varying(100),
        ADD "gst_state_code" character varying(2),
        ADD "gst_verification_status" "masters"."transporters_gst_verification_status_enum" NOT NULL DEFAULT 'unverified',
        ADD "gst_verification_id" uuid,
        ADD "gst_verified_at" TIMESTAMP WITH TIME ZONE,
        ADD "gst_registry_name" character varying(255),
        ADD "gst_name_matched" boolean,
        ADD "gst_treatment" "masters"."transporters_gst_treatment_enum",
        ADD "trucks_declared" integer,
        ADD "truck_body_type" "masters"."transporters_truck_body_type_enum",
        ADD "truck_wheel_count" smallint,
        ADD "truck_capacity_tons" numeric(6,2),
        ADD "truck_length_ft" numeric(5,1),
        ADD "upi_vpa" character varying(100),
        ADD "bank_name_branch" character varying(150),
        ADD "bank_verification_status" "masters"."transporters_bank_verification_status_enum",
        ADD "bank_verified_at" TIMESTAMP WITH TIME ZONE,
        ADD "bank_name_at_bank" character varying(150),
        ADD "bank_verification_reference" character varying(100),
        ADD "bank_raw_response" jsonb,
        ADD CONSTRAINT "FK_transporters_gst_verification" FOREIGN KEY ("gst_verification_id") REFERENCES "masters"."gst_verifications"("id") ON DELETE SET NULL
    `);

    // TRP-1001, TRP-1002… per tenant in creation order (deleted rows numbered too, so a code is
    // never reused), then seed the sequence so new transporters continue from there.
    await queryRunner.query(`
      WITH numbered AS (
        SELECT "id", ROW_NUMBER() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id") AS n
        FROM "masters"."transporters"
      )
      UPDATE "masters"."transporters" t SET "code" = 'TRP-' || (1000 + numbered.n)
      FROM numbered WHERE t."id" = numbered."id"
    `);
    await queryRunner.query(`
      INSERT INTO "loads"."code_sequences" ("entity", "scope_id", "value")
      SELECT 'transporter', "tenant_id", COUNT(*) FROM "masters"."transporters" GROUP BY "tenant_id"
      ON CONFLICT ("entity", "scope_id") DO UPDATE SET "value" = EXCLUDED."value"
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "transporters_tenant_code_unique" ON "masters"."transporters" ("tenant_id", "code") WHERE "code" IS NOT NULL AND "deleted_at" IS NULL`,
    );
    // PAN and state code are positional in a well-formed GSTIN.
    await queryRunner.query(`
      UPDATE "masters"."transporters"
      SET "pan" = SUBSTRING("gstin" FROM 3 FOR 10), "gst_state_code" = LEFT("gstin", 2)
      WHERE "gstin" ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'
    `);

    await queryRunner.query(`
      CREATE TABLE "masters"."transporter_contacts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "transporter_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "full_name" character varying(150),
        "designation" character varying(100),
        "phone" character varying(15),
        "is_whatsapp" boolean NOT NULL DEFAULT false,
        "email" character varying(255),
        "sort_order" smallint NOT NULL DEFAULT 0,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transporter_contacts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_transporter_contacts_transporter" FOREIGN KEY ("transporter_id") REFERENCES "masters"."transporters"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "transporter_contacts_tenant_transporter_idx" ON "masters"."transporter_contacts" ("tenant_id", "transporter_id")`,
    );
    await queryRunner.query(`
      CREATE TABLE "masters"."transporter_lanes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "transporter_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "origin_city" character varying(100) NOT NULL,
        "origin_state" character varying(100),
        "destination_city" character varying(100) NOT NULL,
        "destination_state" character varying(100),
        "distance_km" integer,
        "sort_order" smallint NOT NULL DEFAULT 0,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transporter_lanes_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_transporter_lanes_transporter" FOREIGN KEY ("transporter_id") REFERENCES "masters"."transporters"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "transporter_lanes_tenant_transporter_idx" ON "masters"."transporter_lanes" ("tenant_id", "transporter_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "masters"."transporter_lanes_tenant_transporter_idx"`);
    await queryRunner.query(`DROP TABLE "masters"."transporter_lanes"`);
    await queryRunner.query(`DROP INDEX "masters"."transporter_contacts_tenant_transporter_idx"`);
    await queryRunner.query(`DROP TABLE "masters"."transporter_contacts"`);
    await queryRunner.query(`DELETE FROM "loads"."code_sequences" WHERE "entity" = 'transporter'`);
    await queryRunner.query(`DROP INDEX "masters"."transporters_tenant_code_unique"`);
    await queryRunner.query(`
      ALTER TABLE "masters"."transporters"
        DROP CONSTRAINT "FK_transporters_gst_verification",
        DROP COLUMN "bank_raw_response", DROP COLUMN "bank_verification_reference",
        DROP COLUMN "bank_name_at_bank", DROP COLUMN "bank_verified_at",
        DROP COLUMN "bank_verification_status", DROP COLUMN "bank_name_branch",
        DROP COLUMN "upi_vpa", DROP COLUMN "truck_length_ft", DROP COLUMN "truck_capacity_tons",
        DROP COLUMN "truck_wheel_count", DROP COLUMN "truck_body_type",
        DROP COLUMN "trucks_declared", DROP COLUMN "gst_treatment",
        DROP COLUMN "gst_name_matched", DROP COLUMN "gst_registry_name",
        DROP COLUMN "gst_verified_at", DROP COLUMN "gst_verification_id",
        DROP COLUMN "gst_verification_status", DROP COLUMN "gst_state_code",
        DROP COLUMN "constitution", DROP COLUMN "pan", DROP COLUMN "code"
    `);
    await queryRunner.query(`DROP TYPE "masters"."transporters_bank_verification_status_enum"`);
    await queryRunner.query(`DROP TYPE "masters"."transporters_truck_body_type_enum"`);
    await queryRunner.query(`DROP TYPE "masters"."transporters_gst_treatment_enum"`);
    await queryRunner.query(`DROP TYPE "masters"."transporters_gst_verification_status_enum"`);
  }
}
