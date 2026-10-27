import { MigrationInterface, QueryRunner } from 'typeorm';

// The client's 13-stage load lifecycle replaces the 8-status model (stages 1–10 here; 11–13 come
// with the Loadsmart route). Postgres can't rename or drop enum values in place, so the status
// column moves to a fresh enum type through a CASE that maps every old value, then the new type
// takes the old name. Also adds the stage timestamps the old model didn't have, the POD's back
// side, the delivery-issue settlement fields, and 'pilferage' on the POD condition, and the
// 'DELIVERY_ISSUE_SETTLED' activity.

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
  'closed',
];
const OLD_STATUSES = [
  'created',
  'assigned',
  'loading_confirmed',
  'at_plant',
  'in_transit',
  'reached_delivery_point',
  'delivered',
  'closed',
];

/** Old status -> new stage. 'delivered' splits on what the POD noted, see DELIVERED_SQL. Exported
 *  for load-status-migration.test.ts. */
export const OLD_TO_NEW_STATUS: Record<string, string> = {
  created: 'created',
  assigned: 'truck_assigned',
  at_plant: 'reached_loading',
  loading_confirmed: 'loaded',
  in_transit: 'in_transit_unloading',
  reached_delivery_point: 'reached_unloading',
  delivered: 'delivered_ok',
  closed: 'closed',
};

/** New stage -> old status, for `down`. Stages the old model never had fold into the one before. */
export const NEW_TO_OLD_STATUS: Record<string, string> = {
  created: 'created',
  bids_received: 'created',
  truck_assigned: 'assigned',
  in_transit_loading: 'assigned',
  reached_loading: 'at_plant',
  loaded: 'loading_confirmed',
  in_transit_unloading: 'in_transit',
  reached_unloading: 'reached_delivery_point',
  delivered_ok: 'delivered',
  delivered_with_issues: 'delivered',
  closed: 'closed',
};

const DELIVERED_SQL = `WHEN 'delivered' THEN CASE WHEN "shortage_or_damage" IS NOT NULL AND "shortage_or_damage" <> 'none' THEN 'delivered_with_issues' ELSE 'delivered_ok' END`;

const caseFor = (mapping: Record<string, string>, extra = '') =>
  `CASE "status"::text ${extra} ${Object.entries(mapping)
    .map(([from, to]) => `WHEN '${from}' THEN '${to}'`)
    .join(' ')} END`;

const enumValues = (values: string[]) => values.map((value) => `'${value}'`).join(', ');

export class LoadLifecycleStages1792800000000 implements MigrationInterface {
  name = 'LoadLifecycleStages1792800000000';

  private async swapStatusEnum(
    queryRunner: QueryRunner,
    values: string[],
    usingCase: string,
  ): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "loads"."loads_status_enum_next" AS ENUM(${enumValues(values)})`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."loads" ALTER COLUMN "status" DROP DEFAULT`);
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ALTER COLUMN "status" TYPE "loads"."loads_status_enum_next" USING (${usingCase})::"loads"."loads_status_enum_next"`,
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
    const { delivered: _delivered, ...rest } = OLD_TO_NEW_STATUS;
    await this.swapStatusEnum(queryRunner, NEW_STATUSES, caseFor(rest, DELIVERED_SQL));
    // Own fleet never sits in Created any more — the only own-fleet loads there were released by a
    // driver deleting their account, and they still have their truck.
    await queryRunner.query(
      `UPDATE "loads"."loads" SET "status" = 'truck_assigned' WHERE "source_type" = 'own_fleet' AND "status" = 'created'`,
    );

    await queryRunner.query(
      `ALTER TABLE "loads"."loads"
        ADD "bids_received_at" TIMESTAMP WITH TIME ZONE,
        ADD "truck_assigned_at" TIMESTAMP WITH TIME ZONE,
        ADD "in_transit_loading_at" TIMESTAMP WITH TIME ZONE,
        ADD "pod_back_file_key" text,
        ADD "delivery_issue_settled_at" TIMESTAMP WITH TIME ZONE,
        ADD "delivery_issue_settled_by" uuid,
        ADD "delivery_issue_settlement_note" text`,
    );
    await queryRunner.query(
      `ALTER TYPE "loads"."loads_shortage_or_damage_enum" ADD VALUE IF NOT EXISTS 'pilferage'`,
    );
    await queryRunner.query(
      `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS 'DELIVERY_ISSUE_SETTLED'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // 'pilferage' and 'DELIVERY_ISSUE_SETTLED' stay on their enums — Postgres can't drop a value.
    // Rows using pilferage read as damage under the old model.
    await queryRunner.query(
      `UPDATE "loads"."loads" SET "shortage_or_damage" = 'damage' WHERE "shortage_or_damage" = 'pilferage'`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads"
        DROP COLUMN "delivery_issue_settlement_note",
        DROP COLUMN "delivery_issue_settled_by",
        DROP COLUMN "delivery_issue_settled_at",
        DROP COLUMN "pod_back_file_key",
        DROP COLUMN "in_transit_loading_at",
        DROP COLUMN "truck_assigned_at",
        DROP COLUMN "bids_received_at"`,
    );
    await this.swapStatusEnum(queryRunner, OLD_STATUSES, caseFor(NEW_TO_OLD_STATUS));
  }
}
