import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `transporters` has never had a migration — it only ever existed via `synchronize: true` in
 * local/dev/test (off in staging/production, see data-source.ts). This is the first real
 * migration for it, so it's a full CREATE TABLE against the PRD §5.4.2 (FMS-MAS-TRN-001) shape
 * rather than an ALTER against prior columns.
 */
export class CreateTransportersTable1786783598790 implements MigrationInterface {
  name = 'CreateTransportersTable1786783598790';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "masters"."transporters_company_type_enum" AS ENUM('proprietorship', 'partnership', 'private_limited', 'public_limited', 'llp', 'huf', 'others')`,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."transporters" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "name" character varying(150) NOT NULL, "phone" character varying(15) NOT NULL, "rate" character varying(100), "email" character varying(255), "gstin" character varying(15), "msme_registration" character varying(50), "company_type" "masters"."transporters_company_type_enum", "advance_percentage" numeric(5,2), "credit_days" integer, "address_line_1" character varying(255), "address_line_2" character varying(255), "landmark" character varying(255), "area_locality" character varying(255), "city" character varying(100), "state" character varying(100), "pin_code" character varying(10), "bank_account_number" character varying(30), "bank_ifsc" character varying(11), "bank_account_holder_name" character varying(150), "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_e2d5f6a8c1b4370fce0d9c4a5b6" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "transporters_tenant_id_idx" ON "masters"."transporters" ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "transporters_tenant_name_active_unique" ON "masters"."transporters" ("tenant_id", "name") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "masters"."transporters_tenant_name_active_unique"`);
    await queryRunner.query(`DROP INDEX "masters"."transporters_tenant_id_idx"`);
    await queryRunner.query(`DROP TABLE "masters"."transporters"`);
    await queryRunner.query(`DROP TYPE "masters"."transporters_company_type_enum"`);
  }
}
