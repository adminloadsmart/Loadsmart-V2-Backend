import { MigrationInterface, QueryRunner } from 'typeorm';

// LS_N_0034 "shortage or damage recorded": the company's claim window (days to raise a claim after
// the E-POD records it — default 7, editable by the org admin later) and an optional cargo value
// per MT on requisitions and postings, so a shortage can name its value at risk.
//
// LS_N_0037 "driver reported a problem": two more issue types the driver app can report (strike,
// weather), and an optional ETA impact on a report — nothing fills it yet; the alert names it
// once something does.
export class AddShortageClaimsAndDriverProblems1792600000000 implements MigrationInterface {
  name = 'AddShortageClaimsAndDriverProblems1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations" ADD COLUMN IF NOT EXISTS "claim_window_days" integer NOT NULL DEFAULT 7`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."requisitions" ADD COLUMN IF NOT EXISTS "cargo_value_per_tonne" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_postings" ADD COLUMN IF NOT EXISTS "cargo_value_per_tonne" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_issue_reports" ADD COLUMN IF NOT EXISTS "eta_impact_minutes" integer`,
    );
    await queryRunner.query(
      `ALTER TYPE "loads"."load_issue_reports_category_enum" ADD VALUE IF NOT EXISTS 'strike'`,
    );
    await queryRunner.query(
      `ALTER TYPE "loads"."load_issue_reports_category_enum" ADD VALUE IF NOT EXISTS 'weather'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // PostgreSQL does not support removing individual enum values — 'strike' / 'weather' stay on
    // rollback, which is safe: code without them never writes them.
    await queryRunner.query(
      `ALTER TABLE "loads"."load_issue_reports" DROP COLUMN IF EXISTS "eta_impact_minutes"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_postings" DROP COLUMN IF EXISTS "cargo_value_per_tonne"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."requisitions" DROP COLUMN IF EXISTS "cargo_value_per_tonne"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations" DROP COLUMN IF EXISTS "claim_window_days"`,
    );
  }
}
