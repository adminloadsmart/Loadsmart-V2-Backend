import { MigrationInterface, QueryRunner } from 'typeorm';

// loads.tracking_source — how the load's truck is tracked (gps | driver_app | sim | fastag), the
// key the tracking service reads and updates. Set when a truck is assigned
// (modules/loads/tracking-source.hook.ts); loads that already have a truck are backfilled with the
// same rule: GPS on the vehicle master → gps, a driver-app driver → driver_app, else a truck
// number → fastag.
export class AddLoadTrackingSource1793300000000 implements MigrationInterface {
  name = 'AddLoadTrackingSource1793300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "loads"."loads_tracking_source_enum" AS ENUM('gps', 'driver_app', 'sim', 'fastag')`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD "tracking_source" "loads"."loads_tracking_source_enum"`,
    );
    await queryRunner.query(
      `UPDATE "loads"."loads" l
       SET "tracking_source" = (CASE
         WHEN EXISTS (
           SELECT 1 FROM "masters"."vehicle_telemetry_meta" m
           WHERE m."vehicle_id" = l."vehicle_id" AND m."tenant_id" = l."tenant_id"
             AND m."has_gps" = true AND m."gps_enabled" = true
         ) THEN 'gps'
         WHEN l."driver_id" IS NOT NULL THEN 'driver_app'
         WHEN l."vehicle_number" IS NOT NULL THEN 'fastag'
       END)::"loads"."loads_tracking_source_enum"
       WHERE l."status" NOT IN ('created', 'bids_received')`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "tracking_source"`);
    await queryRunner.query(`DROP TYPE "loads"."loads_tracking_source_enum"`);
  }
}
