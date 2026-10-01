import { MigrationInterface, QueryRunner } from 'typeorm';

// Loading Confirmation gets two new non-mandatory uploads (three loaded-truck photos, a weighing
// slip) alongside the existing mandatory invoice/e-way-bill/E-LR set — see load.service.ts's
// confirmLoading. loading_photo_file_keys mirrors load_issue_reports.photo_file_keys (a plain
// text array, not a child table — see AddLoadIssueReporting1789400000000).
export class AddLoadingConfirmationNonMandatoryUploads1789800000000 implements MigrationInterface {
  name = 'AddLoadingConfirmationNonMandatoryUploads1789800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "storage"."files_purpose_enum" ADD VALUE IF NOT EXISTS 'loads/loading-photo'`,
    );
    await queryRunner.query(
      `ALTER TYPE "storage"."files_purpose_enum" ADD VALUE IF NOT EXISTS 'loads/weighing-slip'`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."loads" ADD "loading_photo_file_keys" text array`);
    await queryRunner.query(`ALTER TABLE "loads"."loads" ADD "weighing_slip_file_key" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "weighing_slip_file_key"`);
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "loading_photo_file_keys"`);
    // PostgreSQL does not support removing individual enum values (same as
    // AddLoadIssueReporting's down()) — the two new purposes remain on rollback, which is safe
    // since no column/application data depends on them once these columns are gone.
  }
}
