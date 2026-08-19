import { MigrationInterface, QueryRunner } from 'typeorm';

// Commit c361b3e ("added the fallback manual verification of dl") added 'masters/driver' to
// UPLOAD_PURPOSES in storage.constants.ts for driver DL document uploads, but never shipped the
// matching ALTER TYPE — see AddLoadsUploadPurposesToFiles1786900000005 for the same pattern.
export class AddMastersDriverPurposeToFiles1787146048438 implements MigrationInterface {
  name = 'AddMastersDriverPurposeToFiles1787146048438';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "storage"."files_purpose_enum" ADD VALUE IF NOT EXISTS 'masters/driver'`,
    );
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing individual enum values (same as
    // AddLoadsUploadPurposesToFiles's down()). The enum addition remains on rollback, which is
    // safe because no column or application data depends on it afterwards.
  }
}
