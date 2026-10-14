import { MigrationInterface, QueryRunner } from 'typeorm';

// Driver detail / My Drivers screen fields that had no column yet:
// - advance_outstanding: a single hand-entered running balance (no advances ledger yet).
// - home_base: the yard/branch the driver works from — free text until a yards master exists.
// - license_endorsements: codes from DRIVER_LICENSE_ENDORSEMENTS (e.g. 'hazmat'), varchar[] so a
//   new code is a code change, not a migration. Backs the "Hazmat endorsed" roster tab.
// Plus 'medically_unfit' on the company operational status (the "Medically unfit" button).
// All nullable / empty with no backfill — existing drivers stay empty until edited.
export class AddDriverAdvanceHomeBaseEndorsements1790800000000 implements MigrationInterface {
  name = 'AddDriverAdvanceHomeBaseEndorsements1790800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "advance_outstanding" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "home_base" character varying(150)`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "license_endorsements" character varying(30) array NOT NULL DEFAULT '{}'`,
    );
    await queryRunner.query(
      `ALTER TYPE "masters"."driver_operational_statuses_operational_status_enum" ADD VALUE IF NOT EXISTS 'medically_unfit'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres can't drop an enum value — recreate the type without it, moving any
    // medically_unfit rows to on_leave (the closest remaining "not available" status) first.
    await queryRunner.query(
      `UPDATE "masters"."driver_operational_statuses" SET "operational_status" = 'on_leave' WHERE "operational_status" = 'medically_unfit'`,
    );
    await queryRunner.query(
      `ALTER TYPE "masters"."driver_operational_statuses_operational_status_enum" RENAME TO "driver_operational_statuses_operational_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."driver_operational_statuses_operational_status_enum" AS ENUM('active', 'on_trip', 'on_leave', 'inactive')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" ALTER COLUMN "operational_status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" ALTER COLUMN "operational_status" TYPE "masters"."driver_operational_statuses_operational_status_enum" USING "operational_status"::text::"masters"."driver_operational_statuses_operational_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" ALTER COLUMN "operational_status" SET DEFAULT 'active'`,
    );
    await queryRunner.query(
      `DROP TYPE "masters"."driver_operational_statuses_operational_status_enum_old"`,
    );
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "license_endorsements"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "home_base"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "advance_outstanding"`);
  }
}
