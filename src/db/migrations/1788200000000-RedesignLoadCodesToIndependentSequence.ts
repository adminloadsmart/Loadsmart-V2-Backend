import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Redesigns `loads.code` from a derived `REQ-nnnn-Lx` (per-requisition, joined against the
 * parent requisition's own code) into `LOAD-nnnn` — an independent, tenant-wide sequence with no
 * relationship to which requisition created it. Migration 1786900000006 (already run in
 * production) shipped the original derived format, so this one re-backfills existing rows and
 * re-scopes the `load` counter in `loads.code_sequences` from per-requisition to per-tenant,
 * rather than editing that already-applied migration in place.
 */
export class RedesignLoadCodesToIndependentSequence1788200000000 implements MigrationInterface {
  name = 'RedesignLoadCodesToIndependentSequence1788200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ALTER COLUMN "code" TYPE character varying(20)`,
    );

    // Old counter rows were scoped by requisition_id (`entity = 'load'`) — no longer valid now
    // that the sequence is tenant-wide. Cleared before the code below re-backfills and re-seeds it.
    await queryRunner.query(`DELETE FROM "loads"."code_sequences" WHERE "entity" = 'load'`);

    await queryRunner.query(`
      UPDATE "loads"."loads" AS l
      SET "code" = 'LOAD-' || (1000 + sub.rn)
      FROM (
        SELECT "id", ROW_NUMBER() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id") AS rn
        FROM "loads"."loads"
      ) AS sub
      WHERE l."id" = sub."id"
    `);

    await queryRunner.query(`
      INSERT INTO "loads"."code_sequences" ("entity", "scope_id", "value")
      SELECT 'load', "tenant_id", COUNT(*) FROM "loads"."loads" GROUP BY "tenant_id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Best-effort restore of the pre-redesign REQ-nnnn-Lx format — a fresh per-requisition
    // renumbering in creation order, same shape as the original 1786900000006 backfill produced.
    await queryRunner.query(`DELETE FROM "loads"."code_sequences" WHERE "entity" = 'load'`);

    await queryRunner.query(`
      UPDATE "loads"."loads" AS l
      SET "code" = req."code" || '-L' || sub.rn
      FROM (
        SELECT "id", "requisition_id", ROW_NUMBER() OVER (PARTITION BY "requisition_id" ORDER BY "created_at", "id") AS rn
        FROM "loads"."loads"
      ) AS sub
      JOIN "loads"."requisitions" AS req ON req."id" = sub."requisition_id"
      WHERE l."id" = sub."id"
    `);

    await queryRunner.query(`
      INSERT INTO "loads"."code_sequences" ("entity", "scope_id", "value")
      SELECT 'load', "requisition_id", COUNT(*) FROM "loads"."loads" GROUP BY "requisition_id"
    `);

    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ALTER COLUMN "code" TYPE character varying(30)`,
    );
  }
}
