import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * storage.files.purpose is a Postgres enum backing storage.constants.ts's UPLOAD_PURPOSES (see
 * FileEntity) — adding a new purpose there requires a matching ALTER TYPE here, it isn't just
 * app-level config. Adds the 3 purposes the Loads module's document uploads use; `trips/pod`/
 * `trips/lr` are reused as-is for E-POD/E-LR and need no change.
 */
export class AddLoadsUploadPurposesToFiles1786900000005 implements MigrationInterface {
  name = 'AddLoadsUploadPurposesToFiles1786900000005';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "storage"."files_purpose_enum" ADD VALUE IF NOT EXISTS 'loads/invoice'`,
    );
    await queryRunner.query(
      `ALTER TYPE "storage"."files_purpose_enum" ADD VALUE IF NOT EXISTS 'loads/eway-bill'`,
    );
    await queryRunner.query(
      `ALTER TYPE "storage"."files_purpose_enum" ADD VALUE IF NOT EXISTS 'loads/payment-proof'`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing individual enum values (same as
    // AddShopboardPremisesPhotoOnboardingStep's down()). The enum additions remain on rollback,
    // which is safe because no column or application data depends on them afterwards.
  }
}
