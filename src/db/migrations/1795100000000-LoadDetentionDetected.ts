import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tracking's "Detention detected" flag: the truck has been inside the loading or unloading
 * geofence for more than the detention time (24 h by default; tracking decides and sends
 * `trip.detention_detected`). Set once, by the first event; the billable detention amounts stay
 * with the free-hours alerts (LS_N_0023 / LS_N_0032).
 */
export class LoadDetentionDetected1795100000000 implements MigrationInterface {
  name = 'LoadDetentionDetected1795100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "loads"."loads"
        ADD "detention_detected_at" TIMESTAMP WITH TIME ZONE,
        ADD "detention_point" character varying(16)`);
    await queryRunner.query(`
      ALTER TABLE "loads"."loads"
        ADD CONSTRAINT "loads_detention_point_check"
        CHECK ("detention_point" IS NULL OR "detention_point" IN ('loading', 'unloading'))`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" DROP CONSTRAINT "loads_detention_point_check"`,
    );
    await queryRunner.query(`
      ALTER TABLE "loads"."loads"
        DROP COLUMN "detention_point",
        DROP COLUMN "detention_detected_at"`);
  }
}
