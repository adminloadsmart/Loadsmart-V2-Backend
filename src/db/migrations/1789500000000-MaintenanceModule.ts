import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Maintenance module (FMS-MNT-000): the workshop tables — maintenance_jobs (services and
 * breakdowns), tyres + tyre_readings, battery_packs + battery_soh_readings — plus the three
 * columns other modules gain for it:
 *   - masters.vehicle_service_usage.service_interval_km / service_interval_months (service policy)
 *   - masters.vehicle_telemetry_meta.fixed_cost_monthly (downtime's "fixed cost that ran anyway")
 *   - loads.loads.covers_vehicle_id (market loads bought to cover a truck in the workshop)
 *
 * Replaces the placeholder maintenance.maintenance_records table (never written to — no service
 * code ever read or wrote it), which is dropped here and recreated as-was on rollback.
 *
 * NOTE: statements taken from `migration:generate` output, filtered to this feature — the dev DB
 * has unrelated drift (see AddLoadIssueReporting1789400000000's note) that the raw output also
 * carries.
 */
export class MaintenanceModule1789500000000 implements MigrationInterface {
  name = 'MaintenanceModule1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "maintenance"."maintenance_records"`);
    await queryRunner.query(
      `CREATE TYPE "maintenance"."maintenance_jobs_job_type_enum" AS ENUM('service', 'breakdown')`,
    );
    await queryRunner.query(
      `CREATE TYPE "maintenance"."maintenance_jobs_status_enum" AS ENUM('open', 'closed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "maintenance"."maintenance_jobs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "vehicle_id" uuid NOT NULL, "job_type" "maintenance"."maintenance_jobs_job_type_enum" NOT NULL, "status" "maintenance"."maintenance_jobs_status_enum" NOT NULL, "opened_at" TIMESTAMP WITH TIME ZONE NOT NULL, "closed_at" TIMESTAMP WITH TIME ZONE, "odometer_km" integer, "workshop_name" character varying(150), "location_label" character varying(255), "latitude" numeric(9,6), "longitude" numeric(9,6), "towed" boolean NOT NULL DEFAULT false, "description" text, "parts_replaced" jsonb NOT NULL DEFAULT '[]', "labour_cost" numeric(12,2), "parts_cost" numeric(12,2), "total_cost" numeric(12,2), "source_issue_report_id" uuid, "created_by" uuid, "updated_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_eeab42a825d840bd95635b5f873" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "maintenance_jobs_open_breakdown_unique" ON "maintenance"."maintenance_jobs"  ("vehicle_id") WHERE "job_type" = 'breakdown' AND "status" = 'open'`,
    );
    await queryRunner.query(
      `CREATE INDEX "maintenance_jobs_vehicle_id_idx" ON "maintenance"."maintenance_jobs"  ("vehicle_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "maintenance_jobs_tenant_opened_idx" ON "maintenance"."maintenance_jobs"  ("tenant_id", "opened_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "maintenance_jobs_tenant_id_idx" ON "maintenance"."maintenance_jobs"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "maintenance"."tyre_readings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "tyre_id" uuid NOT NULL, "tread_mm" numeric(4,1) NOT NULL, "reading_date" date NOT NULL, "odometer_km" integer, "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_450ca1b3bf7b223e23809a2fea7" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "tyre_readings_tyre_date_idx" ON "maintenance"."tyre_readings"  ("tyre_id", "reading_date") `,
    );
    await queryRunner.query(
      `CREATE INDEX "tyre_readings_tenant_id_idx" ON "maintenance"."tyre_readings"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TYPE "maintenance"."tyres_casing_condition_enum" AS ENUM('ok', 'damaged')`,
    );
    await queryRunner.query(
      `CREATE TYPE "maintenance"."tyres_status_enum" AS ENUM('fitted', 'removed', 'scrapped')`,
    );
    await queryRunner.query(
      `CREATE TYPE "maintenance"."tyres_removed_reason_enum" AS ENUM('retread', 'scrap', 'rotation', 'damage', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "maintenance"."tyres" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "vehicle_id" uuid NOT NULL, "position" character varying(20) NOT NULL, "serial_number" character varying(50), "brand" character varying(100), "original_tread_mm" numeric(4,1) NOT NULL, "fitted_at" date NOT NULL, "fitted_odometer_km" integer NOT NULL, "retread_count" smallint NOT NULL DEFAULT '0', "max_retreads" smallint NOT NULL DEFAULT '2', "casing_condition" "maintenance"."tyres_casing_condition_enum" NOT NULL DEFAULT 'ok', "status" "maintenance"."tyres_status_enum" NOT NULL DEFAULT 'fitted', "removed_at" date, "removed_odometer_km" integer, "removed_reason" "maintenance"."tyres_removed_reason_enum", "created_by" uuid, "updated_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_defc4360cca43337b34a94e095b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "tyres_vehicle_position_fitted_unique" ON "maintenance"."tyres"  ("vehicle_id", "position") WHERE "status" = 'fitted'`,
    );
    await queryRunner.query(
      `CREATE INDEX "tyres_vehicle_id_idx" ON "maintenance"."tyres"  ("vehicle_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "tyres_tenant_id_idx" ON "maintenance"."tyres"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "maintenance"."battery_soh_readings" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "battery_pack_id" uuid NOT NULL, "reading_month" date NOT NULL, "soh_pct" numeric(5,2) NOT NULL, "odometer_km" integer, "created_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_718e08705fa2416ad8b8c74ded1" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "battery_soh_readings_pack_month_unique" ON "maintenance"."battery_soh_readings"  ("battery_pack_id", "reading_month") `,
    );
    await queryRunner.query(
      `CREATE INDEX "battery_soh_readings_tenant_id_idx" ON "maintenance"."battery_soh_readings"  ("tenant_id") `,
    );
    await queryRunner.query(
      `CREATE TABLE "maintenance"."battery_packs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "vehicle_id" uuid NOT NULL, "serial_number" character varying(50), "capacity_kwh" numeric(7,2), "warranty_start" date NOT NULL, "warranty_end" date NOT NULL, "warranty_soh_floor_pct" numeric(5,2) NOT NULL DEFAULT '70', "created_by" uuid, "updated_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9aef0227c25b747a53e9728e673" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "battery_packs_vehicle_id_idx" ON "maintenance"."battery_packs"  ("vehicle_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "battery_packs_tenant_id_idx" ON "maintenance"."battery_packs"  ("tenant_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_telemetry_meta" ADD "fixed_cost_monthly" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_service_usage" ADD "service_interval_km" integer`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_service_usage" ADD "service_interval_months" smallint`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."loads" ADD "covers_vehicle_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "loads_tenant_covers_vehicle_idx" ON "loads"."loads"  ("tenant_id", "covers_vehicle_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance"."maintenance_jobs" ADD CONSTRAINT "FK_33cf84b5e8a2682abfcb6b7b674" FOREIGN KEY ("vehicle_id") REFERENCES "masters"."vehicles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance"."tyre_readings" ADD CONSTRAINT "FK_274e69ca46c886a79136c3b7882" FOREIGN KEY ("tyre_id") REFERENCES "maintenance"."tyres"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance"."tyres" ADD CONSTRAINT "FK_c0a3a57c057b35e7b2678ad6ef4" FOREIGN KEY ("vehicle_id") REFERENCES "masters"."vehicles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance"."battery_soh_readings" ADD CONSTRAINT "FK_b7e3c12d598dbbeb54ee7c2b12d" FOREIGN KEY ("battery_pack_id") REFERENCES "maintenance"."battery_packs"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance"."battery_packs" ADD CONSTRAINT "FK_2f27e21684bcb42e62abb5b9982" FOREIGN KEY ("vehicle_id") REFERENCES "masters"."vehicles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD CONSTRAINT "FK_264e88ea0ea8d0cdc1994773004" FOREIGN KEY ("covers_vehicle_id") REFERENCES "masters"."vehicles"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" DROP CONSTRAINT "FK_264e88ea0ea8d0cdc1994773004"`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance"."battery_packs" DROP CONSTRAINT "FK_2f27e21684bcb42e62abb5b9982"`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance"."battery_soh_readings" DROP CONSTRAINT "FK_b7e3c12d598dbbeb54ee7c2b12d"`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance"."tyres" DROP CONSTRAINT "FK_c0a3a57c057b35e7b2678ad6ef4"`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance"."tyre_readings" DROP CONSTRAINT "FK_274e69ca46c886a79136c3b7882"`,
    );
    await queryRunner.query(
      `ALTER TABLE "maintenance"."maintenance_jobs" DROP CONSTRAINT "FK_33cf84b5e8a2682abfcb6b7b674"`,
    );
    await queryRunner.query(`DROP INDEX "loads"."loads_tenant_covers_vehicle_idx"`);
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "covers_vehicle_id"`);
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_service_usage" DROP COLUMN "service_interval_months"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_service_usage" DROP COLUMN "service_interval_km"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_telemetry_meta" DROP COLUMN "fixed_cost_monthly"`,
    );
    await queryRunner.query(`DROP INDEX "maintenance"."battery_packs_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "maintenance"."battery_packs_vehicle_id_idx"`);
    await queryRunner.query(`DROP TABLE "maintenance"."battery_packs"`);
    await queryRunner.query(`DROP INDEX "maintenance"."battery_soh_readings_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "maintenance"."battery_soh_readings_pack_month_unique"`);
    await queryRunner.query(`DROP TABLE "maintenance"."battery_soh_readings"`);
    await queryRunner.query(`DROP INDEX "maintenance"."tyres_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "maintenance"."tyres_vehicle_id_idx"`);
    await queryRunner.query(`DROP INDEX "maintenance"."tyres_vehicle_position_fitted_unique"`);
    await queryRunner.query(`DROP TABLE "maintenance"."tyres"`);
    await queryRunner.query(`DROP TYPE "maintenance"."tyres_removed_reason_enum"`);
    await queryRunner.query(`DROP TYPE "maintenance"."tyres_status_enum"`);
    await queryRunner.query(`DROP TYPE "maintenance"."tyres_casing_condition_enum"`);
    await queryRunner.query(`DROP INDEX "maintenance"."tyre_readings_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "maintenance"."tyre_readings_tyre_date_idx"`);
    await queryRunner.query(`DROP TABLE "maintenance"."tyre_readings"`);
    await queryRunner.query(`DROP INDEX "maintenance"."maintenance_jobs_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "maintenance"."maintenance_jobs_tenant_opened_idx"`);
    await queryRunner.query(`DROP INDEX "maintenance"."maintenance_jobs_vehicle_id_idx"`);
    await queryRunner.query(`DROP INDEX "maintenance"."maintenance_jobs_open_breakdown_unique"`);
    await queryRunner.query(`DROP TABLE "maintenance"."maintenance_jobs"`);
    await queryRunner.query(`DROP TYPE "maintenance"."maintenance_jobs_status_enum"`);
    await queryRunner.query(`DROP TYPE "maintenance"."maintenance_jobs_job_type_enum"`);
    await queryRunner.query(
      `CREATE TABLE "maintenance"."maintenance_records" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" character varying NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_287b838a22e8c8804262ccdb6a1" PRIMARY KEY ("id"))`,
    );
  }
}
