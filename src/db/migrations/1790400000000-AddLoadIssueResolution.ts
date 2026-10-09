import { MigrationInterface, QueryRunner } from 'typeorm';

// A halting issue (accident/breakdown) keeps its load on hold until staff resolve it — see
// LoadService.resolveIssue. resolved_by is a plain uuid (staff auth.users id), no FK, same
// convention as reported_by on this table.
export class AddLoadIssueResolution1790400000000 implements MigrationInterface {
  name = 'AddLoadIssueResolution1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."load_issue_reports" ADD "resolved_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."load_issue_reports" ADD "resolved_by" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loads"."load_issue_reports" DROP COLUMN "resolved_by"`);
    await queryRunner.query(`ALTER TABLE "loads"."load_issue_reports" DROP COLUMN "resolved_at"`);
  }
}
