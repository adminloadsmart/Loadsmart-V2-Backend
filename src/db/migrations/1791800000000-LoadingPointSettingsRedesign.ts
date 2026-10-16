import { MigrationInterface, QueryRunner } from 'typeorm';

// Settings redesign — Loading points: geofence radius (default 300 m), gate hours, Google Places
// pin source and notes. address_line_1 becomes optional: the new form only has "Find on map" +
// city/state/PIN. Existing pins with coordinates stay 'manual' — no place id was ever stored.
export class LoadingPointSettingsRedesign1791800000000 implements MigrationInterface {
  name = 'LoadingPointSettingsRedesign1791800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "masters"."loading_points_location_source_enum" AS ENUM('google_places', 'manual')`,
    );
    await queryRunner.query(`
      ALTER TABLE "masters"."loading_points"
        ADD "geofence_radius_m" integer NOT NULL DEFAULT 300,
        ADD "gate_opens_at" time,
        ADD "gate_closes_at" time,
        ADD "google_place_id" character varying(255),
        ADD "location_source" "masters"."loading_points_location_source_enum" NOT NULL DEFAULT 'manual',
        ADD "notes" text,
        ALTER COLUMN "address_line_1" DROP NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "masters"."loading_points" SET "address_line_1" = '' WHERE "address_line_1" IS NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "masters"."loading_points"
        ALTER COLUMN "address_line_1" SET NOT NULL,
        DROP COLUMN "notes", DROP COLUMN "location_source", DROP COLUMN "google_place_id",
        DROP COLUMN "gate_closes_at", DROP COLUMN "gate_opens_at", DROP COLUMN "geofence_radius_m"
    `);
    await queryRunner.query(`DROP TYPE "masters"."loading_points_location_source_enum"`);
  }
}
