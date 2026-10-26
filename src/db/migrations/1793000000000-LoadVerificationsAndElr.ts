import { MigrationInterface, QueryRunner } from 'typeorm';

// Phase 3: load-time govt-portal checks of the truck (VAHAN) and driver (Sarathi), the licence the
// transporter names, and the generated e-LR with the invoice details it can be made from.
export class LoadVerificationsAndElr1793000000000 implements MigrationInterface {
  name = 'LoadVerificationsAndElr1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "loads"."load_verifications_subject_enum" AS ENUM('truck', 'driver')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."load_verifications_status_enum" AS ENUM('passed', 'failed', 'unavailable')`,
    );
    await queryRunner.query(
      `CREATE TABLE "loads"."load_verifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "load_id" uuid NOT NULL,
        "bid_id" uuid,
        "subject" "loads"."load_verifications_subject_enum" NOT NULL,
        "subject_ref" character varying(30) NOT NULL,
        "status" "loads"."load_verifications_status_enum" NOT NULL,
        "failures" jsonb NOT NULL DEFAULT '[]',
        "notes" jsonb NOT NULL DEFAULT '[]',
        "gross_vehicle_weight_kg" integer,
        "details" jsonb,
        "checked_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_load_verifications_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_load_verifications_load" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE CASCADE
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "load_verifications_tenant_load_idx" ON "loads"."load_verifications" ("tenant_id", "load_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "load_verifications_tenant_subject_idx" ON "loads"."load_verifications" ("tenant_id", "subject", "subject_ref")`,
    );

    await queryRunner.query(
      `ALTER TABLE "loads"."loads"
        ADD "driver_licence_number" character varying(30),
        ADD "invoice_date" date,
        ADD "invoice_value" numeric(14,2),
        ADD "elr_document_file_key" text,
        ADD "elr_generated_at" TIMESTAMP WITH TIME ZONE,
        ADD "elr_packages" integer,
        ADD "elr_seal_number" character varying(50),
        ADD "elr_show_freight" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."loads"
        DROP COLUMN "elr_show_freight",
        DROP COLUMN "elr_seal_number",
        DROP COLUMN "elr_packages",
        DROP COLUMN "elr_generated_at",
        DROP COLUMN "elr_document_file_key",
        DROP COLUMN "invoice_value",
        DROP COLUMN "invoice_date",
        DROP COLUMN "driver_licence_number"`,
    );
    await queryRunner.query(`DROP TABLE "loads"."load_verifications"`);
    await queryRunner.query(`DROP TYPE "loads"."load_verifications_status_enum"`);
    await queryRunner.query(`DROP TYPE "loads"."load_verifications_subject_enum"`);
  }
}
