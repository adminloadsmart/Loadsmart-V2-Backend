import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the human-readable `REQ-nnnn` (requisition) / `REQ-nnnn-Lx` (load) display codes Plan
 * Dispatch v2.0 is written around — until now both tables only had a UUID `id`. Backed by a
 * small per-scope counter table (`loads.code_sequences`, see CodeSequenceEntity/Repository):
 * `entity: 'requisition'` scoped per tenant, `entity: 'load'` scoped per requisition (restarts
 * at 1 each time). Existing rows are backfilled in creation order before the column is made
 * NOT NULL, and the counters are seeded to match so the next code handed out by the app
 * continues on from the backfill rather than colliding with it.
 *
 * Also adds `requisitions.pickup_date` — when the truck is expected at the loading point,
 * distinct from `expected_delivery_date`. Existing rows are backfilled from their own
 * `expected_delivery_date` (the best available stand-in) before the column is made NOT NULL.
 */
export class AddCodesToRequisitionsAndLoads1786900000006 implements MigrationInterface {
  name = 'AddCodesToRequisitionsAndLoads1786900000006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "loads"."code_sequences" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "entity" character varying(30) NOT NULL, "scope_id" uuid NOT NULL, "value" integer NOT NULL DEFAULT 0, "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "code_sequences_entity_scope_unique" UNIQUE ("entity", "scope_id"), CONSTRAINT "PK_code_sequences_id" PRIMARY KEY ("id"))`,
    );

    // --- requisitions.code ---
    await queryRunner.query(
      `ALTER TABLE "loads"."requisitions" ADD COLUMN "code" character varying(20)`,
    );
    await queryRunner.query(`
      UPDATE "loads"."requisitions" AS r
      SET "code" = 'REQ-' || (1000 + sub.rn)
      FROM (
        SELECT "id", ROW_NUMBER() OVER (PARTITION BY "tenant_id" ORDER BY "created_at", "id") AS rn
        FROM "loads"."requisitions"
      ) AS sub
      WHERE r."id" = sub."id"
    `);
    await queryRunner.query(`ALTER TABLE "loads"."requisitions" ALTER COLUMN "code" SET NOT NULL`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "requisitions_tenant_code_unique" ON "loads"."requisitions" ("tenant_id", "code")`,
    );

    // --- requisitions.pickup_date ---
    await queryRunner.query(`ALTER TABLE "loads"."requisitions" ADD COLUMN "pickup_date" date`);
    await queryRunner.query(
      `UPDATE "loads"."requisitions" SET "pickup_date" = "expected_delivery_date" WHERE "pickup_date" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."requisitions" ALTER COLUMN "pickup_date" SET NOT NULL`,
    );

    // --- loads.code ---
    await queryRunner.query(`ALTER TABLE "loads"."loads" ADD COLUMN "code" character varying(30)`);
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
    await queryRunner.query(`ALTER TABLE "loads"."loads" ALTER COLUMN "code" SET NOT NULL`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "loads_tenant_code_unique" ON "loads"."loads" ("tenant_id", "code")`,
    );
    await queryRunner.query(
      `CREATE INDEX "loads_tenant_vehicle_number_idx" ON "loads"."loads" ("tenant_id", "vehicle_number")`,
    );

    // Seed the counters so the next code the app hands out continues from the backfill above —
    // COUNT(*) per scope equals the highest `rn` just assigned, since rn is dense from 1.
    await queryRunner.query(`
      INSERT INTO "loads"."code_sequences" ("entity", "scope_id", "value")
      SELECT 'requisition', "tenant_id", COUNT(*) FROM "loads"."requisitions" GROUP BY "tenant_id"
    `);
    await queryRunner.query(`
      INSERT INTO "loads"."code_sequences" ("entity", "scope_id", "value")
      SELECT 'load', "requisition_id", COUNT(*) FROM "loads"."loads" GROUP BY "requisition_id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "loads"."loads_tenant_vehicle_number_idx"`);
    await queryRunner.query(`DROP INDEX "loads"."loads_tenant_code_unique"`);
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "code"`);

    await queryRunner.query(`DROP INDEX "loads"."requisitions_tenant_code_unique"`);
    await queryRunner.query(`ALTER TABLE "loads"."requisitions" DROP COLUMN "code"`);
    await queryRunner.query(`ALTER TABLE "loads"."requisitions" DROP COLUMN "pickup_date"`);

    await queryRunner.query(`DROP TABLE "loads"."code_sequences"`);
  }
}
