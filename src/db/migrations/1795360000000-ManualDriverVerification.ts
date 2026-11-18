import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Manual driver-licence verification when Sarathi can't confirm a licence: the load activity for
 * it. The check itself reuses load_verifications.source / verified_by (ManualTruckVerification).
 * The new enum value isn't used in this migration, so ADD VALUE runs in the transaction.
 */
export class ManualDriverVerification1795360000000 implements MigrationInterface {
  name = 'ManualDriverVerification1795360000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS 'DRIVER_VERIFIED_MANUALLY'`,
    );
  }

  public async down(): Promise<void> {
    // Enum values can't be dropped in Postgres; 'DRIVER_VERIFIED_MANUALLY' stays.
  }
}
