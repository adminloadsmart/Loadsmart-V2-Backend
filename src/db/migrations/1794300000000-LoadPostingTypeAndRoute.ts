import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Load module Phase 1a — the route model as two fields, added beside source_type and backfilled
 * from it. No behaviour change on its own; Phase 1b (next migration) makes them the source of
 * truth and drops source_type.
 *
 * - posting_type: how the shipper posted it (market_fleet / indent / own_fleet).
 * - route: who carries it (loadsmart / own_transporter / indent / own_fleet), null while a market
 *   load has no winner.
 * - awarded_party / awarded_bid_id: whose bid the shipper awarded.
 *
 * Backfill, from the old meaning where truck_assigned was the accepted bid:
 *   own_fleet → own_fleet; loadsmart → loadsmart; indent past created → indent; market past
 *   bids_received → own_transporter; anything else unrouted.
 */
export class LoadPostingTypeAndRoute1794300000000 implements MigrationInterface {
  name = 'LoadPostingTypeAndRoute1794300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "loads"."loads_posting_type_enum" AS ENUM('market_fleet', 'indent', 'own_fleet')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."loads_route_enum" AS ENUM('loadsmart', 'own_transporter', 'indent', 'own_fleet')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."loads_awarded_party_enum" AS ENUM('transporter', 'loadsmart')`,
    );
    await queryRunner.query(`
      ALTER TABLE "loads"."loads"
        ADD "posting_type" "loads"."loads_posting_type_enum",
        ADD "route" "loads"."loads_route_enum",
        ADD "awarded_party" "loads"."loads_awarded_party_enum",
        ADD "awarded_bid_id" uuid`);

    await queryRunner.query(`
      UPDATE "loads"."loads" SET "posting_type" = (CASE "source_type"::text
        WHEN 'own_fleet' THEN 'own_fleet'
        WHEN 'indent' THEN 'indent'
        ELSE 'market_fleet' END)::"loads"."loads_posting_type_enum"`);
    await queryRunner.query(`
      UPDATE "loads"."loads" SET "route" = (CASE
        WHEN "source_type" = 'own_fleet' THEN 'own_fleet'
        WHEN "source_type" = 'loadsmart' THEN 'loadsmart'
        WHEN "source_type" = 'indent' AND "status" <> 'created' THEN 'indent'
        WHEN "source_type" = 'market' AND "status" NOT IN ('created', 'bids_received')
          THEN 'own_transporter'
        END)::"loads"."loads_route_enum"`);
    await queryRunner.query(`
      UPDATE "loads"."loads" SET "awarded_party" = (CASE
        WHEN "route" = 'loadsmart' THEN 'loadsmart'
        WHEN "route" IN ('own_transporter', 'indent') THEN 'transporter'
        END)::"loads"."loads_awarded_party_enum"`);
    await queryRunner.query(`
      UPDATE "loads"."loads" l SET "awarded_bid_id" = b."id"
        FROM "loads"."load_bids" b
       WHERE b."load_id" = l."id" AND b."status" = 'accepted'`);

    await queryRunner.query(
      `CREATE INDEX "loads_tenant_posting_type_idx" ON "loads"."loads" ("tenant_id", "posting_type")`,
    );
    await queryRunner.query(
      `CREATE INDEX "loads_tenant_route_idx" ON "loads"."loads" ("tenant_id", "route")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "loads"."loads_tenant_route_idx"`);
    await queryRunner.query(`DROP INDEX "loads"."loads_tenant_posting_type_idx"`);
    await queryRunner.query(`
      ALTER TABLE "loads"."loads"
        DROP COLUMN "awarded_bid_id",
        DROP COLUMN "awarded_party",
        DROP COLUMN "route",
        DROP COLUMN "posting_type"`);
    await queryRunner.query(`DROP TYPE "loads"."loads_awarded_party_enum"`);
    await queryRunner.query(`DROP TYPE "loads"."loads_route_enum"`);
    await queryRunner.query(`DROP TYPE "loads"."loads_posting_type_enum"`);
  }
}
