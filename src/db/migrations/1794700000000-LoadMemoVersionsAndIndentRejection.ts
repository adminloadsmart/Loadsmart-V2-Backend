import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Load module Phase 4 — memo and checks:
 * - Load memo versions (LM-<load code>-v<n>) with the price and payment terms they showed, a PDF
 *   per version, how they were accepted (app or call), and `superseded` for a version a newer one
 *   replaced. Existing memos are numbered in the order they were sent.
 * - The driver's date of birth on the load, so the Sarathi check can run again.
 * - A rejected indent: the contract's non-placement penalty and loads.load_route_changes.
 * - The memo PDF's upload purpose and document type; new load-activity actions.
 */
export class LoadMemoVersionsAndIndentRejection1794700000000 implements MigrationInterface {
  name = 'LoadMemoVersionsAndIndentRejection1794700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const query of [
      `ALTER TYPE "storage"."files_purpose_enum" ADD VALUE IF NOT EXISTS 'loads/memo'`,
      `ALTER TYPE "loads"."load_memos_status_enum" ADD VALUE IF NOT EXISTS 'superseded'`,
      `ALTER TYPE "loads"."load_documents_doc_type_enum" ADD VALUE IF NOT EXISTS 'load_memo' AFTER 'elr'`,
      `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS 'CHECKS_RERUN'`,
      `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS 'INDENT_REJECTED'`,
    ]) {
      await queryRunner.query(query);
    }

    await queryRunner.query(
      `CREATE TYPE "loads"."load_memos_accepted_via_enum" AS ENUM('app', 'call')`,
    );
    await queryRunner.query(`
      ALTER TABLE "loads"."load_memos"
        ADD "version" integer,
        ADD "reference" character varying(60),
        ADD "driver_licence_number" character varying(30),
        ADD "freight_type" "loads"."loads_freight_type_enum",
        ADD "freight_value" numeric(12,2),
        ADD "advance_percentage" numeric(5,2),
        ADD "balance_percentage" numeric(5,2),
        ADD "pdf_file_key" text,
        ADD "accepted_via" "loads"."load_memos_accepted_via_enum"`);
    await queryRunner.query(`
      UPDATE "loads"."load_memos" m
         SET "version" = numbered."version",
             "reference" = 'LM-' || l."code" || '-v' || numbered."version",
             "accepted_via" = CASE WHEN m."accepted_at" IS NULL THEN NULL ELSE 'app'::"loads"."load_memos_accepted_via_enum" END
        FROM (SELECT "id", row_number() OVER (PARTITION BY "load_id" ORDER BY "sent_at") AS "version"
                FROM "loads"."load_memos") numbered,
             "loads"."loads" l
       WHERE numbered."id" = m."id" AND l."id" = m."load_id"`);
    await queryRunner.query(`
      ALTER TABLE "loads"."load_memos"
        ALTER COLUMN "version" SET NOT NULL,
        ALTER COLUMN "reference" SET NOT NULL`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "load_memos_load_version_unique" ON "loads"."load_memos" ("load_id", "version")`,
    );

    await queryRunner.query(`ALTER TABLE "loads"."loads" ADD "driver_date_of_birth" date`);
    await queryRunner.query(
      `ALTER TABLE "loads"."customer_contracts" ADD "non_placement_penalty" numeric(12,2)`,
    );

    await queryRunner.query(`
      CREATE TABLE "loads"."load_route_changes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "load_id" uuid NOT NULL,
        "from_posting_type" "loads"."loads_posting_type_enum" NOT NULL,
        "to_posting_type" "loads"."loads_posting_type_enum" NOT NULL,
        "reason" text NOT NULL,
        "contract_id" uuid,
        "transporter_id" uuid,
        "penalty_amount" numeric(12,2),
        "changed_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_load_route_changes" PRIMARY KEY ("id"),
        CONSTRAINT "FK_load_route_changes_load" FOREIGN KEY ("load_id")
          REFERENCES "loads"."loads"("id") ON DELETE RESTRICT
      )`);
    await queryRunner.query(
      `CREATE INDEX "load_route_changes_load_idx" ON "loads"."load_route_changes" ("load_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Enum values stay — PostgreSQL can't drop them, and code without them never writes them.
    await queryRunner.query(`DROP TABLE "loads"."load_route_changes"`);
    await queryRunner.query(
      `ALTER TABLE "loads"."customer_contracts" DROP COLUMN "non_placement_penalty"`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "driver_date_of_birth"`);
    await queryRunner.query(`DROP INDEX "loads"."load_memos_load_version_unique"`);
    await queryRunner.query(`
      ALTER TABLE "loads"."load_memos"
        DROP COLUMN "accepted_via",
        DROP COLUMN "pdf_file_key",
        DROP COLUMN "balance_percentage",
        DROP COLUMN "advance_percentage",
        DROP COLUMN "freight_value",
        DROP COLUMN "freight_type",
        DROP COLUMN "driver_licence_number",
        DROP COLUMN "reference",
        DROP COLUMN "version"`);
    await queryRunner.query(`DROP TYPE "loads"."load_memos_accepted_via_enum"`);
  }
}
