import { MigrationInterface, QueryRunner } from 'typeorm';

// Commit d96b1c7 ("added approval and rejection functionality for customers, vehicles, and
// drivers") added approved_by/approved_at/rejection_reason to DriverEntity and VehicleEntity, and
// rejection_reason to CustomerEntity (approved_by/approved_at already existed there), plus new
// 'pending'/'rejected' status values for drivers and vehicles ('rejected' only for customers,
// which already had 'pending') — but never shipped a migration. This backfills the DB to match
// those entities.
export class AddApprovalFieldsToDriversAndVehicles1787120525096 implements MigrationInterface {
  name = 'AddApprovalFieldsToDriversAndVehicles1787120525096';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "masters"."drivers" ADD "approved_by" uuid`);
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "approved_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD "rejection_reason" character varying`,
    );
    await queryRunner.query(`ALTER TABLE "masters"."vehicles" ADD "approved_by" uuid`);
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicles" ADD "approved_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicles" ADD "rejection_reason" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD "rejection_reason" character varying`,
    );

    await queryRunner.query(`ALTER TYPE "masters"."drivers_status_enum" ADD VALUE 'pending'`);
    await queryRunner.query(`ALTER TYPE "masters"."drivers_status_enum" ADD VALUE 'rejected'`);
    await queryRunner.query(`ALTER TYPE "masters"."vehicles_status_enum" ADD VALUE 'pending'`);
    await queryRunner.query(`ALTER TYPE "masters"."vehicles_status_enum" ADD VALUE 'rejected'`);
    await queryRunner.query(`ALTER TYPE "customers"."customers_status_enum" ADD VALUE 'rejected'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres can't drop enum values directly, so roll each status enum back the same way
    // TypeORM does: rebuild the type under an _old name, cast the column across, drop, rename.
    await queryRunner.query(
      `CREATE TYPE "customers"."customers_status_enum_old" AS ENUM('pending', 'active')`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ALTER COLUMN "status" TYPE "customers"."customers_status_enum_old" USING "status"::"text"::"customers"."customers_status_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "customers"."customers_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "customers"."customers_status_enum_old" RENAME TO "customers_status_enum"`,
    );

    await queryRunner.query(
      `CREATE TYPE "masters"."vehicles_status_enum_old" AS ENUM('active', 'inactive', 'under_maintenance')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicles" ALTER COLUMN "status" TYPE "masters"."vehicles_status_enum_old" USING "status"::"text"::"masters"."vehicles_status_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "masters"."vehicles_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "masters"."vehicles_status_enum_old" RENAME TO "vehicles_status_enum"`,
    );

    await queryRunner.query(
      `CREATE TYPE "masters"."drivers_status_enum_old" AS ENUM('active', 'inactive', 'on_trip', 'on_leave')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ALTER COLUMN "status" TYPE "masters"."drivers_status_enum_old" USING "status"::"text"::"masters"."drivers_status_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "masters"."drivers_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "masters"."drivers_status_enum_old" RENAME TO "drivers_status_enum"`,
    );

    await queryRunner.query(`ALTER TABLE "customers"."customers" DROP COLUMN "rejection_reason"`);
    await queryRunner.query(`ALTER TABLE "masters"."vehicles" DROP COLUMN "rejection_reason"`);
    await queryRunner.query(`ALTER TABLE "masters"."vehicles" DROP COLUMN "approved_at"`);
    await queryRunner.query(`ALTER TABLE "masters"."vehicles" DROP COLUMN "approved_by"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "rejection_reason"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "approved_at"`);
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "approved_by"`);
  }
}
