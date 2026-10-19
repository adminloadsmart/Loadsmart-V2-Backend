import { MigrationInterface, QueryRunner } from 'typeorm';

// Geofence types for rest stops / dhabas and toll plazas — places a truck is expected to stand, so
// LS_N_0027 (vehicle halted) skips a halt inside one. Drawn like any other geofence in Tracking →
// Geofences; until a tenant draws some, nothing is excluded on this account.
export class AddRestStopTollPlazaGeofenceTypes1792400000000 implements MigrationInterface {
  name = 'AddRestStopTollPlazaGeofenceTypes1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "tracking"."geofences_type_enum" ADD VALUE IF NOT EXISTS 'rest_stop'`,
    );
    await queryRunner.query(
      `ALTER TYPE "tracking"."geofences_type_enum" ADD VALUE IF NOT EXISTS 'toll_plaza'`,
    );
  }

  public async down(): Promise<void> {
    // PostgreSQL does not support removing individual enum values. They stay on rollback, which
    // is safe: code without them never writes them.
  }
}
