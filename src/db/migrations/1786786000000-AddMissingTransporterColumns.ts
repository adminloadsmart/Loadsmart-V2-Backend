import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The initial transporter migration used CREATE TABLE IF NOT EXISTS. On databases
 * where the table was created earlier by synchronize, that statement did not add
 * columns introduced by the current TransporterEntity. Bring those databases up
 * to the entity contract without rewriting or deleting existing transporter rows.
 */
export class AddMissingTransporterColumns1786786000000 implements MigrationInterface {
  name = 'AddMissingTransporterColumns1786786000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "masters"."transporters_company_type_enum" AS ENUM('proprietorship', 'partnership', 'private_limited', 'public_limited', 'llp', 'huf', 'others');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    );
    await queryRunner.query(
      `DO $$ BEGIN
        CREATE TYPE "masters"."transporters_status_enum" AS ENUM('active', 'inactive');
      EXCEPTION WHEN duplicate_object THEN NULL;
      END $$`,
    );

    await queryRunner.query(`
      ALTER TABLE "masters"."transporters"
        ADD COLUMN IF NOT EXISTS "email" character varying(255),
        ADD COLUMN IF NOT EXISTS "gstin" character varying(15),
        ADD COLUMN IF NOT EXISTS "msme_registration" character varying(50),
        ADD COLUMN IF NOT EXISTS "company_type" "masters"."transporters_company_type_enum",
        ADD COLUMN IF NOT EXISTS "advance_percentage" numeric(5,2),
        ADD COLUMN IF NOT EXISTS "credit_days" integer,
        ADD COLUMN IF NOT EXISTS "address_line_1" character varying(255),
        ADD COLUMN IF NOT EXISTS "address_line_2" character varying(255),
        ADD COLUMN IF NOT EXISTS "landmark" character varying(255),
        ADD COLUMN IF NOT EXISTS "area_locality" character varying(255),
        ADD COLUMN IF NOT EXISTS "city" character varying(100),
        ADD COLUMN IF NOT EXISTS "state" character varying(100),
        ADD COLUMN IF NOT EXISTS "pin_code" character varying(10),
        ADD COLUMN IF NOT EXISTS "bank_account_number" character varying(30),
        ADD COLUMN IF NOT EXISTS "bank_ifsc" character varying(11),
        ADD COLUMN IF NOT EXISTS "bank_account_holder_name" character varying(150),
        ADD COLUMN IF NOT EXISTS "status" "masters"."transporters_status_enum" NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS "created_by" uuid,
        ADD COLUMN IF NOT EXISTS "updated_by" uuid,
        ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
    `);

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "transporters_tenant_id_idx" ON "masters"."transporters" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "transporters_tenant_phone_active_unique"
       ON "masters"."transporters" ("tenant_id", "phone")
       WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // This migration is intentionally additive. Removing columns in down() could
    // destroy data created after deployment, so rollback leaves the compatible
    // columns and indexes in place.
  }
}
