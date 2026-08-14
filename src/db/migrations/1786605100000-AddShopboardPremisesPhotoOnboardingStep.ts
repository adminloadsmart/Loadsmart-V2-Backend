import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddShopboardPremisesPhotoOnboardingStep1786605100000 implements MigrationInterface {
  name = 'AddShopboardPremisesPhotoOnboardingStep1786605100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "storage"."files_purpose_enum" ADD VALUE IF NOT EXISTS 'organizations/shopboard-premises'`,
    );
    await queryRunner.query(
      `ALTER TYPE "auth"."organizations_onboarding_step_enum" ADD VALUE IF NOT EXISTS 'shopboard_premises_photo'`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations" ADD COLUMN IF NOT EXISTS "shopboard_premises_photo_key" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations" DROP COLUMN IF EXISTS "shopboard_premises_photo_key"`,
    );
    // PostgreSQL does not support removing individual enum values. The enum additions remain on
    // rollback, which is safe because no column or application data depends on them afterwards.
  }
}
