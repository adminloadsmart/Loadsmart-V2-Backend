import { MigrationInterface, QueryRunner } from 'typeorm';

// A load's tracking snapshot now also carries the requisition's customer and expected delivery date
// (the tracking service's DELAY rule needs the promised delivery time), so re-snapshot a
// requisition's loads when either of those changes too — not only its loading/delivery points.
// A vehicle's snapshot now carries its truck type's body type (tankers get a lower speed limit and
// a stricter inactivity rule), so a truck type's body type change re-snapshots its vehicles.
export class TrackingOutboxRequisitionFields1790200000000 implements MigrationInterface {
  name = 'TrackingOutboxRequisitionFields1790200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "tracking_outbox_requisitions_points" ON "loads"."requisitions"`,
    );
    await queryRunner.query(`
      CREATE TRIGGER "tracking_outbox_requisitions_points"
      AFTER UPDATE OF "loading_point_id", "customer_delivery_point_id", "customer_id", "expected_delivery_date"
      ON "loads"."requisitions"
      FOR EACH ROW
      WHEN (OLD."loading_point_id" IS DISTINCT FROM NEW."loading_point_id"
         OR OLD."customer_delivery_point_id" IS DISTINCT FROM NEW."customer_delivery_point_id"
         OR OLD."customer_id" IS DISTINCT FROM NEW."customer_id"
         OR OLD."expected_delivery_date" IS DISTINCT FROM NEW."expected_delivery_date")
      EXECUTE FUNCTION "tracking"."enqueue_requisition_loads"()`);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "tracking"."enqueue_truck_type_vehicles"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO "tracking"."outbox" ("aggregate_type", "aggregate_id", "tenant_id")
        SELECT 'vehicle', v."id", v."tenant_id" FROM "masters"."vehicles" v WHERE v."truck_type_id" = NEW."id";
        RETURN NULL;
      END
      $$`);
    await queryRunner.query(`
      CREATE TRIGGER "tracking_outbox_truck_types_body"
      AFTER UPDATE OF "body_type" ON "masters"."truck_types"
      FOR EACH ROW WHEN (OLD."body_type" IS DISTINCT FROM NEW."body_type")
      EXECUTE FUNCTION "tracking"."enqueue_truck_type_vehicles"()`);
    // Publish the new fields for every existing load once.
    await queryRunner.query(
      `INSERT INTO "tracking"."outbox" ("aggregate_type", "aggregate_id", "tenant_id")
       SELECT 'load', "id", "tenant_id" FROM "loads"."loads"
       UNION ALL SELECT 'vehicle', "id", "tenant_id" FROM "masters"."vehicles"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "tracking_outbox_truck_types_body" ON "masters"."truck_types"`,
    );
    await queryRunner.query(`DROP FUNCTION IF EXISTS "tracking"."enqueue_truck_type_vehicles"()`);
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "tracking_outbox_requisitions_points" ON "loads"."requisitions"`,
    );
    await queryRunner.query(`
      CREATE TRIGGER "tracking_outbox_requisitions_points"
      AFTER UPDATE OF "loading_point_id", "customer_delivery_point_id" ON "loads"."requisitions"
      FOR EACH ROW
      WHEN (OLD."loading_point_id" IS DISTINCT FROM NEW."loading_point_id"
         OR OLD."customer_delivery_point_id" IS DISTINCT FROM NEW."customer_delivery_point_id")
      EXECUTE FUNCTION "tracking"."enqueue_requisition_loads"()`);
  }
}
