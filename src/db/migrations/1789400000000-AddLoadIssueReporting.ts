import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Driver-app "Report An Issue" — see load.service.ts's reportIssue. Three independent schema
 * changes for one feature: a new storage purpose, a new load_activities action, and the
 * dedicated load_issue_reports table itself.
 *
 * NOTE: hand-written, not `migration:generate` output as-is — this dev DB currently has unrelated
 * drift against the entity metadata (masters.driver_sessions column types, a dropped
 * notifications index, and auth.roles_scope_enum missing a 'driver' value the DB has but no
 * entity declares) that produced a much larger, partly destructive diff when generated. Only the
 * three statements below are this feature's actual change; the drift is a separate, pre-existing
 * issue left for someone to investigate on its own.
 */
export class AddLoadIssueReporting1789400000000 implements MigrationInterface {
  name = 'AddLoadIssueReporting1789400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "storage"."files_purpose_enum" ADD VALUE IF NOT EXISTS 'loads/issue'`,
    );
    await queryRunner.query(
      `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS 'ISSUE_REPORTED'`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."load_issue_reports_category_enum" AS ENUM('breakdown', 'halt_rest_stop', 'traffic_jam', 'accident', 'road_blocked', 'police_rto_check', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "loads"."load_issue_reports" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "load_id" uuid NOT NULL, "reported_by" uuid, "category" "loads"."load_issue_reports_category_enum" NOT NULL, "details" text, "latitude" numeric(9,6) NOT NULL, "longitude" numeric(9,6) NOT NULL, "location_label" character varying(255) NOT NULL, "location_captured_at" TIMESTAMP WITH TIME ZONE NOT NULL, "photo_file_keys" text array, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_1d69a58e87e414495b4805458f9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "load_issue_reports_tenant_load_idx" ON "loads"."load_issue_reports"  ("tenant_id", "load_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_issue_reports" ADD CONSTRAINT "FK_d9fbf46126baa26929e75904d6f" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."load_issue_reports" DROP CONSTRAINT "FK_d9fbf46126baa26929e75904d6f"`,
    );
    await queryRunner.query(`DROP INDEX "loads"."load_issue_reports_tenant_load_idx"`);
    await queryRunner.query(`DROP TABLE "loads"."load_issue_reports"`);
    await queryRunner.query(`DROP TYPE "loads"."load_issue_reports_category_enum"`);
    // PostgreSQL does not support removing individual enum values (same as
    // AddLoadsUploadPurposesToFiles's down()) — the 'loads/issue' purpose and 'ISSUE_REPORTED'
    // action remain on rollback, which is safe since no column/application data depends on them
    // once this table is gone.
  }
}
