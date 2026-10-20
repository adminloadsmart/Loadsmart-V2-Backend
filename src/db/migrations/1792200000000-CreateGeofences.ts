import { MigrationInterface, QueryRunner } from 'typeorm';

// Tracking → Geofences: named places (circle or polygon) with alert rules, the trucks/people they
// apply to, per-vehicle inside/outside state, and an enter/exit event log. Lives in the existing
// "tracking" schema; tracking.tracking_events is untouched.
export class CreateGeofences1792200000000 implements MigrationInterface {
  name = 'CreateGeofences1792200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "tracking"."geofences_type_enum" AS ENUM('yard', 'loading_point', 'unloading_point', 'fuel_pump', 'no_go_area')`,
    );
    await queryRunner.query(
      `CREATE TYPE "tracking"."geofences_shape_enum" AS ENUM('circle', 'polygon')`,
    );
    await queryRunner.query(
      `CREATE TYPE "tracking"."geofence_events_event_enum" AS ENUM('enter', 'exit')`,
    );

    await queryRunner.query(`
      CREATE TABLE "tracking"."geofences" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "name" character varying(150) NOT NULL,
        "type" "tracking"."geofences_type_enum" NOT NULL,
        "address" text,
        "latitude" numeric(10,6) NOT NULL,
        "longitude" numeric(10,6) NOT NULL,
        "shape" "tracking"."geofences_shape_enum" NOT NULL DEFAULT 'circle',
        "radius_m" integer,
        "polygon" jsonb,
        "alert_on_enter" boolean NOT NULL DEFAULT true,
        "alert_on_exit" boolean NOT NULL DEFAULT true,
        "dwell_alert_minutes" integer,
        "engine_on_alert_minutes" integer,
        "applies_to_all_vehicles" boolean NOT NULL DEFAULT true,
        "loading_point_id" uuid,
        "customer_delivery_point_id" uuid,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_by" uuid,
        "updated_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        CONSTRAINT "PK_geofences_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "geofences_tenant_id_idx" ON "tracking"."geofences" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "geofences_tenant_type_idx" ON "tracking"."geofences" ("tenant_id", "type")`,
    );

    await queryRunner.query(`
      CREATE TABLE "tracking"."geofence_vehicles" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "geofence_id" uuid NOT NULL,
        "vehicle_id" uuid NOT NULL,
        CONSTRAINT "PK_geofence_vehicles_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_geofence_vehicles_geofence" FOREIGN KEY ("geofence_id") REFERENCES "tracking"."geofences"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "geofence_vehicles_geofence_vehicle_unique" ON "tracking"."geofence_vehicles" ("geofence_id", "vehicle_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "geofence_vehicles_vehicle_idx" ON "tracking"."geofence_vehicles" ("vehicle_id")`,
    );

    await queryRunner.query(`
      CREATE TABLE "tracking"."geofence_recipients" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "geofence_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "channels" jsonb NOT NULL DEFAULT '["app"]',
        CONSTRAINT "PK_geofence_recipients_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_geofence_recipients_geofence" FOREIGN KEY ("geofence_id") REFERENCES "tracking"."geofences"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "geofence_recipients_geofence_user_unique" ON "tracking"."geofence_recipients" ("geofence_id", "user_id")`,
    );

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

    await queryRunner.query(`
      CREATE TABLE "tracking"."geofence_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "geofence_id" uuid NOT NULL,
        "vehicle_id" uuid NOT NULL,
        "load_id" uuid,
        "event" "tracking"."geofence_events_event_enum" NOT NULL,
        "latitude" numeric(10,6) NOT NULL,
        "longitude" numeric(10,6) NOT NULL,
        "occurred_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_geofence_events_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "geofence_events_tenant_geofence_idx" ON "tracking"."geofence_events" ("tenant_id", "geofence_id", "occurred_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "geofence_events_tenant_vehicle_idx" ON "tracking"."geofence_events" ("tenant_id", "vehicle_id", "occurred_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "tracking"."geofence_events_tenant_vehicle_idx"`);
    await queryRunner.query(`DROP INDEX "tracking"."geofence_events_tenant_geofence_idx"`);
    await queryRunner.query(`DROP TABLE "tracking"."geofence_events"`);
    await queryRunner.query(`DROP INDEX "tracking"."vehicle_geofence_states_tenant_idx"`);
    await queryRunner.query(
      `DROP INDEX "tracking"."vehicle_geofence_states_vehicle_geofence_unique"`,
    );
    await queryRunner.query(`DROP TABLE "tracking"."vehicle_geofence_states"`);
    await queryRunner.query(`DROP INDEX "tracking"."geofence_recipients_geofence_user_unique"`);
    await queryRunner.query(`DROP TABLE "tracking"."geofence_recipients"`);
    await queryRunner.query(`DROP INDEX "tracking"."geofence_vehicles_vehicle_idx"`);
    await queryRunner.query(`DROP INDEX "tracking"."geofence_vehicles_geofence_vehicle_unique"`);
    await queryRunner.query(`DROP TABLE "tracking"."geofence_vehicles"`);
    await queryRunner.query(`DROP INDEX "tracking"."geofences_tenant_type_idx"`);
    await queryRunner.query(`DROP INDEX "tracking"."geofences_tenant_id_idx"`);
    await queryRunner.query(`DROP TABLE "tracking"."geofences"`);
    await queryRunner.query(`DROP TYPE "tracking"."geofence_events_event_enum"`);
    await queryRunner.query(`DROP TYPE "tracking"."geofences_shape_enum"`);
    await queryRunner.query(`DROP TYPE "tracking"."geofences_type_enum"`);
  }
}
