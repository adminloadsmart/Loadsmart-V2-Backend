import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lane matching: lane cities' locations looked up once on Google (loads.geo_places), and the
 * loads.brokers row each Loadsmart partner stands for (ls_partners.broker_id) — a matched broker's
 * bids are kept on its partner row.
 */
export class LaneMatching1795410000000 implements MigrationInterface {
  name = 'LaneMatching1795410000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "loads"."geo_places" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "query_key" varchar(220) NOT NULL,
        "city" varchar(100),
        "state" varchar(100),
        "latitude" numeric(10,6),
        "longitude" numeric(10,6),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_geo_places" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "geo_places_query_key_uq" ON "loads"."geo_places" ("query_key")`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."ls_partners" ADD "broker_id" uuid`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "ls_partners_broker_uq" ON "loads"."ls_partners" ("broker_id") WHERE "broker_id" IS NOT NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "loads"."ls_partners" ADD CONSTRAINT "FK_ls_partners_broker"
      FOREIGN KEY ("broker_id") REFERENCES "loads"."brokers"("id") ON DELETE SET NULL`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_partners" DROP CONSTRAINT "FK_ls_partners_broker"`,
    );
    await queryRunner.query(`DROP INDEX "loads"."ls_partners_broker_uq"`);
    await queryRunner.query(`ALTER TABLE "loads"."ls_partners" DROP COLUMN "broker_id"`);
    await queryRunner.query(`DROP INDEX "loads"."geo_places_query_key_uq"`);
    await queryRunner.query(`DROP TABLE "loads"."geo_places"`);
  }
}
