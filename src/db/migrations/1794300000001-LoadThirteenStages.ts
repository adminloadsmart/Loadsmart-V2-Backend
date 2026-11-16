import { MigrationInterface, QueryRunner } from 'typeorm';

const NEW_STATUSES = [
  'created',
  'bids_received',
  'truck_assigned',
  'in_transit_loading',
  'reached_loading',
  'loaded',
  'in_transit_unloading',
  'reached_unloading',
  'delivered_ok',
  'delivered_with_issues',
  'invoice_generated',
  'payment',
  'closed',
];
const OLD_STATUSES = [
  ...NEW_STATUSES.slice(0, 10),
  'original_pod_received',
  ...NEW_STATUSES.slice(10),
];

const enumValues = (values: string[]) => values.map((value) => `'${value}'`).join(', ');

/**
 * Load module Phase 1b — the spec's 13 stages and the trigger table (loads/core/stage-rules.ts):
 * - original_pod_received is no longer a stage (Payables tracks it beside the load); a load there
 *   goes back to delivered_ok.
 * - Truck assigned now means the memo was accepted. A market or indent load at truck_assigned
 *   whose memo isn't accepted is an award still waiting on it: back to bids_received.
 * - Own transporter / indent go through 11 and 12: the transporter's invoice columns.
 * - The POD decision's issue text; two new load-activity actions.
 * - source_type is dropped — posting_type and route (Phase 1a) replace it. A rejected indent is
 *   the only time posting_type changes, so it stays a column, not derived.
 * - CHECKs: a load past Bids received has a route; own fleet is routed own_fleet from posting.
 */
export class LoadThirteenStages1794300000001 implements MigrationInterface {
  name = 'LoadThirteenStages1794300000001';

  private async swapStatusEnum(queryRunner: QueryRunner, values: string[], using: string) {
    await queryRunner.query(
      `CREATE TYPE "loads"."loads_status_enum_next" AS ENUM(${enumValues(values)})`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."loads" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ALTER COLUMN "status" TYPE "loads"."loads_status_enum_next" USING (${using})::"loads"."loads_status_enum_next"`,
    );
    await queryRunner.query(`DROP TYPE "loads"."loads_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "loads"."loads_status_enum_next" RENAME TO "loads_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ALTER COLUMN "status" SET DEFAULT 'created'`,
    );
  }

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const action of ['TRANSPORTER_INVOICE_UPLOADED']) {
      await queryRunner.query(
        `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS '${action}'`,
      );
    }

    await this.swapStatusEnum(
      queryRunner,
      NEW_STATUSES,
      `CASE "status"::text WHEN 'original_pod_received' THEN 'delivered_ok' ELSE "status"::text END`,
    );
    await queryRunner.query(`
      UPDATE "loads"."loads" SET "status" = 'bids_received', "truck_assigned_at" = NULL,
             "route" = CASE WHEN "route" = 'loadsmart' THEN NULL ELSE "route" END
       WHERE "status" = 'truck_assigned' AND "memo_accepted_at" IS NULL
         AND "posting_type" <> 'own_fleet'`);

    await queryRunner.query(`
      ALTER TABLE "loads"."loads"
        ADD "transporter_invoice_file_key" character varying,
        ADD "transporter_invoice_number" character varying(50),
        ADD "transporter_invoice_amount" numeric(14,2),
        ADD "delivery_issue_details" text`);

    await queryRunner.query(`ALTER TABLE "loads"."loads" ALTER COLUMN "posting_type" SET NOT NULL`);
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "source_type"`);
    await queryRunner.query(`DROP TYPE "loads"."loads_source_type_enum"`);

    await queryRunner.query(`
      ALTER TABLE "loads"."loads" ADD CONSTRAINT "loads_route_known_after_award"
        CHECK ("route" IS NOT NULL OR "status" IN ('created', 'bids_received'))`);
    await queryRunner.query(`
      ALTER TABLE "loads"."loads" ADD CONSTRAINT "loads_own_fleet_route"
        CHECK (("posting_type" = 'own_fleet') = ("route" IS NOT DISTINCT FROM 'own_fleet'))`);
    await queryRunner.query(`
      ALTER TABLE "loads"."loads" ADD CONSTRAINT "loads_indent_route"
        CHECK ("route" IS DISTINCT FROM 'indent' OR "posting_type" = 'indent')`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP CONSTRAINT "loads_indent_route"`);
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP CONSTRAINT "loads_own_fleet_route"`);
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" DROP CONSTRAINT "loads_route_known_after_award"`,
    );

    await queryRunner.query(
      `CREATE TYPE "loads"."loads_source_type_enum" AS ENUM('own_fleet', 'market', 'indent', 'loadsmart')`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD "source_type" "loads"."loads_source_type_enum"`,
    );
    await queryRunner.query(`
      UPDATE "loads"."loads" SET "source_type" = (CASE
        WHEN "route" = 'loadsmart' THEN 'loadsmart'
        WHEN "posting_type" = 'own_fleet' THEN 'own_fleet'
        WHEN "posting_type" = 'indent' THEN 'indent'
        ELSE 'market' END)::"loads"."loads_source_type_enum"`);
    await queryRunner.query(`ALTER TABLE "loads"."loads" ALTER COLUMN "source_type" SET NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ALTER COLUMN "posting_type" DROP NOT NULL`,
    );

    await queryRunner.query(`
      ALTER TABLE "loads"."loads"
        DROP COLUMN "delivery_issue_details",
        DROP COLUMN "transporter_invoice_amount",
        DROP COLUMN "transporter_invoice_number",
        DROP COLUMN "transporter_invoice_file_key"`);

    // Stages 11–12 of a non-Loadsmart load didn't exist before: back to Delivered.
    await queryRunner.query(`
      UPDATE "loads"."loads" SET "status" = 'delivered_ok'
       WHERE "status" IN ('invoice_generated', 'payment') AND "source_type" <> 'loadsmart'`);
    await this.swapStatusEnum(queryRunner, OLD_STATUSES, `"status"::text`);
    // The activity enum keeps its new values — PostgreSQL can't drop enum values.
  }
}
