import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Maintenance screen alignment (Figma): Log a service carries "What was done" (service_type) and
 * an invoice; Record Tyre Maintenance becomes a `tyre` job linked to its fitments (size code,
 * maintenance_job_id) with a `replaced` removal reason; queue rows show the vehicle's make/model;
 * invoices upload under a new `maintenance/invoice` storage purpose.
 *
 * NOTE: statements taken from `migration:generate` output, filtered to this feature — see
 * MaintenanceModule1789500000000's note on dev-DB drift.
 */
export class MaintenanceScreenAlignment1789700000000 implements MigrationInterface {
  name = 'MaintenanceScreenAlignment1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "storage"."files_purpose_enum" ADD VALUE IF NOT EXISTS 'maintenance/invoice'`,
    );
    await queryRunner.query(
      `ALTER TYPE "maintenance"."maintenance_jobs_job_type_enum" ADD VALUE IF NOT EXISTS 'tyre'`,
    );
    await queryRunner.query(
      `ALTER TYPE "maintenance"."tyres_removed_reason_enum" ADD VALUE IF NOT EXISTS 'replaced'`,
    );
    await queryRunner.query(
      `CREATE TYPE "maintenance"."maintenance_jobs_service_type_enum" AS ENUM('preventive_service', 'oil_change', 'spare_parts', 'repair', 'other')`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance"."maintenance_jobs" ADD "service_type" "maintenance"."maintenance_jobs_service_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance"."maintenance_jobs" ADD "invoice_file_key" character varying(512)`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance"."tyres" ADD "size_code" character varying(50)`,
    );
    await queryRunner.query(`ALTER TABLE "maintenance"."tyres" ADD "maintenance_job_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "maintenance"."tyres" ADD CONSTRAINT "FK_f621f95c5222ed7b57230e6faea" FOREIGN KEY ("maintenance_job_id") REFERENCES "maintenance"."maintenance_jobs"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicles" ADD "make_model" character varying(100)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "masters"."vehicles" DROP COLUMN "make_model"`);
    await queryRunner.query(
      `ALTER TABLE "maintenance"."tyres" DROP CONSTRAINT "FK_f621f95c5222ed7b57230e6faea"`,
    );
    await queryRunner.query(`ALTER TABLE "maintenance"."tyres" DROP COLUMN "maintenance_job_id"`);
    await queryRunner.query(`ALTER TABLE "maintenance"."tyres" DROP COLUMN "size_code"`);
    await queryRunner.query(
      `ALTER TABLE "maintenance"."maintenance_jobs" DROP COLUMN "invoice_file_key"`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance"."maintenance_jobs" DROP COLUMN "service_type"`,
    );
    await queryRunner.query(`DROP TYPE "maintenance"."maintenance_jobs_service_type_enum"`);
    // PostgreSQL can't remove individual enum values (same as AddLoadIssueReporting's down()) —
    // 'maintenance/invoice', 'tyre' and 'replaced' remain on rollback, which is safe since the
    // entities no longer reference them once rolled back.
  }
}
