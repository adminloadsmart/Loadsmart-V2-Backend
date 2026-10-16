import { MigrationInterface, QueryRunner } from 'typeorm';

// Settings redesign: one row per GSTIN lookup (POST /masters/gst/verify). Customers and
// transporters reference a verified row by id to be stored as "GST API verified".
export class AddGstVerifications1791500000000 implements MigrationInterface {
  name = 'AddGstVerifications1791500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "masters"."gst_verifications_status_enum" AS ENUM('verified', 'not_found', 'inactive', 'unavailable')`,
    );
    await queryRunner.query(`
      CREATE TABLE "masters"."gst_verifications" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "gstin" character varying(15) NOT NULL,
        "request_id" character varying(100),
        "status" "masters"."gst_verifications_status_enum" NOT NULL,
        "legal_name" character varying(255),
        "trade_name" character varying(255),
        "constitution" character varying(100),
        "taxpayer_type" character varying(100),
        "gstin_status" character varying(50),
        "registered_since" character varying(30),
        "registered_address" text,
        "address_parts" jsonb,
        "state_code" character varying(2) NOT NULL,
        "raw_response" jsonb,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_gst_verifications_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "gst_verifications_tenant_gstin_idx" ON "masters"."gst_verifications" ("tenant_id", "gstin")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "masters"."gst_verifications_tenant_gstin_idx"`);
    await queryRunner.query(`DROP TABLE "masters"."gst_verifications"`);
    await queryRunner.query(`DROP TYPE "masters"."gst_verifications_status_enum"`);
  }
}
