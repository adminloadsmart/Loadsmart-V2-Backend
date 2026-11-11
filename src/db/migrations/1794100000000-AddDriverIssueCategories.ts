import { MigrationInterface, QueryRunner } from 'typeorm';

// Driver-app "Report a Problem" gained three categories: Flat tyre, Stopped for no-entry and
// Feeling unwell.
export class AddDriverIssueCategories1794100000000 implements MigrationInterface {
  name = 'AddDriverIssueCategories1794100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const value of ['flat_tyre', 'no_entry', 'feeling_unwell']) {
      await queryRunner.query(
        `ALTER TYPE "loads"."load_issue_reports_category_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(): Promise<void> {
    // PostgreSQL does not support removing individual enum values — they stay on rollback, which
    // is safe: code without them never writes them.
  }
}
