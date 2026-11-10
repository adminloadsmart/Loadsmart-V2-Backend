import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sources the Shipper Analytics Metric Guide (§5) reads that were not recorded yet:
 *  - E-LR weighbridge net weight of a load (gross minus tare) — every tonne figure.
 *  - A plant's declared loading turnaround — "Loading completed" and the plant delay reason.
 *  - A product's business unit — the Business unit filter and the By commodity totals.
 *  - Award outcomes — every load a transporter won, and whether it then accepted, refused or had
 *    no truck — Tender acceptance and the "Tender accepted" stage.
 *  - Saved views — the filter bar's named views.
 */
export class AddShipperAnalyticsSources1794000000000 implements MigrationInterface {
  name = 'AddShipperAnalyticsSources1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD "elr_net_weight_tonnes" numeric(10,3)`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."loading_points" ADD "declared_turnaround_hours" numeric(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."products" ADD "business_unit" character varying(80)`,
    );

    await queryRunner.query(
      `CREATE TYPE "loads"."load_award_outcomes_outcome_enum" AS ENUM('won', 'accepted', 'refused', 'no_truck')`,
    );
    await queryRunner.query(`
      CREATE TABLE "loads"."load_award_outcomes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "load_id" uuid NOT NULL,
        "transporter_id" uuid NOT NULL,
        "outcome" "loads"."load_award_outcomes_outcome_enum" NOT NULL,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_load_award_outcomes_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_load_award_outcomes_load" FOREIGN KEY ("load_id")
          REFERENCES "loads"."loads"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "load_award_outcomes_tenant_load_idx" ON "loads"."load_award_outcomes" ("tenant_id", "load_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "load_award_outcomes_tenant_transporter_idx" ON "loads"."load_award_outcomes" ("tenant_id", "transporter_id")`,
    );

    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "analytics"`);
    await queryRunner.query(`
      CREATE TABLE "analytics"."saved_views" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "module" character varying(40) NOT NULL,
        "name" character varying(80) NOT NULL,
        "filters" jsonb NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_saved_views_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "saved_views_user_module_name_uq" ON "analytics"."saved_views" ("tenant_id", "user_id", "module", "name")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "analytics"."saved_views_user_module_name_uq"`);
    await queryRunner.query(`DROP TABLE "analytics"."saved_views"`);
    await queryRunner.query(`DROP INDEX "loads"."load_award_outcomes_tenant_transporter_idx"`);
    await queryRunner.query(`DROP INDEX "loads"."load_award_outcomes_tenant_load_idx"`);
    await queryRunner.query(`DROP TABLE "loads"."load_award_outcomes"`);
    await queryRunner.query(`DROP TYPE "loads"."load_award_outcomes_outcome_enum"`);
    await queryRunner.query(`ALTER TABLE "masters"."products" DROP COLUMN "business_unit"`);
    await queryRunner.query(
      `ALTER TABLE "masters"."loading_points" DROP COLUMN "declared_turnaround_hours"`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "elr_net_weight_tonnes"`);
  }
}
