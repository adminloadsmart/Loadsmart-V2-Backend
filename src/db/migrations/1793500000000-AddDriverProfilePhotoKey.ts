import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Driver app profile edit: the driver's own profile photo, stored as an S3 key on the driver, plus
 * the 'driver/profile' upload purpose it is uploaded under (see AddMastersDriverPurposeToFiles
 * for the same ALTER TYPE pattern).
 */
export class AddDriverProfilePhotoKey1793500000000 implements MigrationInterface {
  name = 'AddDriverProfilePhotoKey1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" ADD COLUMN IF NOT EXISTS "profile_photo_key" varchar(500)`,
    );
    await queryRunner.query(
      `ALTER TYPE "storage"."files_purpose_enum" ADD VALUE IF NOT EXISTS 'driver/profile'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."drivers" DROP COLUMN IF EXISTS "profile_photo_key"`,
    );
    // PostgreSQL cannot remove an enum value; the 'driver/profile' addition stays on rollback,
    // which is harmless since nothing depends on it afterwards.
  }
}
