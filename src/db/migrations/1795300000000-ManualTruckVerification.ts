import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Manual truck verification when VAHAN (ULIP) can't be reached:
 * - A fleet truck can be marked verified by an org admin: a 'manual' snapshot type and
 *   masters.vehicles.vahan_verified_manually.
 * - A load's truck check records where its verdict came from (portal | manual) and who verified
 *   it by hand.
 * - The load activity for it.
 * The new enum values aren't used in this migration, so ADD VALUE runs in the transaction.
 */
export class ManualTruckVerification1795300000000 implements MigrationInterface {
  name = 'ManualTruckVerification1795300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "masters"."vehicle_verification_snapshots_verification_type_enum" ADD VALUE IF NOT EXISTS 'manual'`,
    );
    await queryRunner.query(
      `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS 'TRUCK_VERIFIED_MANUALLY'`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicles" ADD "vahan_verified_manually" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."load_verifications_source_enum" AS ENUM('portal', 'manual')`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_verifications" ADD "source" "loads"."load_verifications_source_enum" NOT NULL DEFAULT 'portal'`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."load_verifications" ADD "verified_by" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Enum values can't be dropped in Postgres; 'manual' and 'TRUCK_VERIFIED_MANUALLY' stay.
    await queryRunner.query(`ALTER TABLE "loads"."load_verifications" DROP COLUMN "verified_by"`);
    await queryRunner.query(`ALTER TABLE "loads"."load_verifications" DROP COLUMN "source"`);
    await queryRunner.query(`DROP TYPE "loads"."load_verifications_source_enum"`);
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicles" DROP COLUMN "vahan_verified_manually"`,
    );
  }
}
