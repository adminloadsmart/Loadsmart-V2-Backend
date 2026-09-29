import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Maintenance workshop visits: a scheduled service is now checked in and out like a breakdown
 * (the truck is out of dispatch while it is in), so "one open job per truck" widens from open
 * breakdowns to any open job. includes_service marks a breakdown on which the due service was
 * also done (closing it reset the service clock).
 *
 * NOTE: statements taken from `migration:generate` output, filtered to this feature — see
 * MaintenanceModule1789500000000's note on dev-DB drift.
 */
export class MaintenanceWorkshopVisits1789600000000 implements MigrationInterface {
  name = 'MaintenanceWorkshopVisits1789600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "maintenance"."maintenance_jobs_open_breakdown_unique"`);
    await queryRunner.query(
      `ALTER TABLE "maintenance"."maintenance_jobs" ADD "includes_service" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "maintenance_jobs_open_unique" ON "maintenance"."maintenance_jobs"  ("vehicle_id") WHERE "status" = 'open'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "maintenance"."maintenance_jobs_open_unique"`);
    await queryRunner.query(
      `ALTER TABLE "maintenance"."maintenance_jobs" DROP COLUMN "includes_service"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "maintenance_jobs_open_breakdown_unique" ON "maintenance"."maintenance_jobs" ("vehicle_id") WHERE "job_type" = 'breakdown' AND "status" = 'open'`,
    );
  }
}
