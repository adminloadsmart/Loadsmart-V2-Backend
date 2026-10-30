import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Vehicle onboarding saved GPS = yes + IMEI with gps_enabled left false, so loads on those
 * vehicles never got the `gps` tracking source. VehicleService.setTelemetryMeta now derives it;
 * this fixes the rows saved before that.
 */
export class BackfillVehicleGpsEnabled1793600000000 implements MigrationInterface {
  name = 'BackfillVehicleGpsEnabled1793600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "masters"."vehicle_telemetry_meta" SET "gps_enabled" = true
       WHERE "has_gps" = true AND "gps_device_imei" IS NOT NULL AND "gps_device_imei" <> ''
         AND "gps_enabled" = false`,
    );
  }

  public async down(): Promise<void> {
    // The rows this changed can't be told apart from ones that were already enabled.
  }
}
