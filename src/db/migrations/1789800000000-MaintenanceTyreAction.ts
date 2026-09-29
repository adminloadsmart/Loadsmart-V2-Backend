import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Record Tyre Maintenance's "Action performed" (new_fitment / cold_retread) is kept on the tyre
 * job as tyre_action, so job history can show it. Existing tyre jobs are backfilled from the
 * description recordTyreWork wrote ("Cold retread — …" / "New tyre fitment — …").
 */
export class MaintenanceTyreAction1789800000000 implements MigrationInterface {
  name = 'MaintenanceTyreAction1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "maintenance"."maintenance_jobs_tyre_action_enum" AS ENUM('new_fitment', 'cold_retread')`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance"."maintenance_jobs" ADD "tyre_action" "maintenance"."maintenance_jobs_tyre_action_enum"`,
    );
    await queryRunner.query(
      `UPDATE "maintenance"."maintenance_jobs"
         SET "tyre_action" = CASE WHEN "description" LIKE 'Cold retread%' THEN 'cold_retread'::"maintenance"."maintenance_jobs_tyre_action_enum"
                                  ELSE 'new_fitment'::"maintenance"."maintenance_jobs_tyre_action_enum" END
       WHERE "job_type" = 'tyre'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "maintenance"."maintenance_jobs" DROP COLUMN "tyre_action"`,
    );
    await queryRunner.query(`DROP TYPE "maintenance"."maintenance_jobs_tyre_action_enum"`);
  }
}
