import { MigrationInterface, QueryRunner } from 'typeorm';

// Geofence inside/outside state moved to the tracking service (per vehicle, in its Redis, next to
// the rest of its per-vehicle state) — it runs the check on every GPS point now, so this table
// (written only by the removed POST /geofences/location-pings) has no writer left.
export class DropVehicleGeofenceStates1792300000000 implements MigrationInterface {
  name = 'DropVehicleGeofenceStates1792300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "tracking"."vehicle_geofence_states"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "tracking"."vehicle_geofence_states" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "vehicle_id" uuid NOT NULL,
        "geofence_id" uuid NOT NULL,
        "inside" boolean NOT NULL,
        "entered_at" TIMESTAMP WITH TIME ZONE,
        "last_ping_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_vehicle_geofence_states_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "vehicle_geofence_states_vehicle_geofence_unique" ON "tracking"."vehicle_geofence_states" ("vehicle_id", "geofence_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "vehicle_geofence_states_tenant_idx" ON "tracking"."vehicle_geofence_states" ("tenant_id")`,
    );
  }
}
