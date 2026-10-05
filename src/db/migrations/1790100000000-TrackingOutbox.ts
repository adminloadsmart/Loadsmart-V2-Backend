import { MigrationInterface, QueryRunner } from 'typeorm';

// Transactional outbox feeding the loadsmart-tracking service (its docs/contracts/loadsmart-events.md).
//
// Row-level triggers record "this aggregate changed" into tracking.outbox in the SAME transaction
// as the change itself, for every write path (repository.update, query builders, raw SQL, imports)
// — no service code has to remember to publish. The outbox relay (modules/tracking/outbox) later
// rebuilds each aggregate's full current snapshot from these tables and XADDs it to the
// `loadsmart.events` Redis stream, so rows here are just pointers, never payloads.
//
// Ends with a one-off backfill so tracking receives every existing aggregate on first deploy.

const SIMPLE_TRIGGERS: Array<{
  table: string;
  name: string;
  aggregateType: string;
  idColumn: string;
}> = [
  { table: 'loads.loads', name: 'loads', aggregateType: 'load', idColumn: 'id' },
  { table: 'masters.vehicles', name: 'vehicles', aggregateType: 'vehicle', idColumn: 'id' },
  {
    table: 'masters.vehicle_telemetry_meta',
    name: 'vehicle_telemetry_meta',
    aggregateType: 'vehicle',
    idColumn: 'vehicle_id',
  },
  { table: 'masters.drivers', name: 'drivers', aggregateType: 'driver', idColumn: 'id' },
  {
    table: 'masters.loading_points',
    name: 'loading_points',
    aggregateType: 'loading_point',
    idColumn: 'id',
  },
  {
    table: 'customers.customer_delivery_points',
    name: 'customer_delivery_points',
    aggregateType: 'delivery_point',
    idColumn: 'id',
  },
];

export class TrackingOutbox1790100000000 implements MigrationInterface {
  name = 'TrackingOutbox1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "tracking"`);
    await queryRunner.query(`
      CREATE TABLE "tracking"."outbox" (
        "id" bigserial PRIMARY KEY,
        "aggregate_type" character varying(30) NOT NULL,
        "aggregate_id" uuid NOT NULL,
        -- Captured at change time: a hard-deleted row can't be looked up later for its tenant.
        "tenant_id" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )`);

    // Generic: TG_ARGV[0] = aggregate type, TG_ARGV[1] = column holding the aggregate id.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "tracking"."enqueue_snapshot"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      DECLARE
        row_json jsonb := to_jsonb(CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END);
        aggregate_id uuid := (row_json ->> TG_ARGV[1])::uuid;
      BEGIN
        IF aggregate_id IS NOT NULL THEN
          INSERT INTO "tracking"."outbox" ("aggregate_type", "aggregate_id", "tenant_id")
          VALUES (TG_ARGV[0], aggregate_id, (row_json ->> 'tenant_id')::uuid);
        END IF;
        -- vehicle_telemetry_meta moved to another vehicle: the old vehicle's snapshot changed too.
        IF TG_OP = 'UPDATE' AND (to_jsonb(OLD) ->> TG_ARGV[1]) IS DISTINCT FROM (row_json ->> TG_ARGV[1])
           AND (to_jsonb(OLD) ->> TG_ARGV[1]) IS NOT NULL THEN
          INSERT INTO "tracking"."outbox" ("aggregate_type", "aggregate_id", "tenant_id")
          VALUES (TG_ARGV[0], (to_jsonb(OLD) ->> TG_ARGV[1])::uuid, (to_jsonb(OLD) ->> 'tenant_id')::uuid);
        END IF;
        RETURN NULL;
      END
      $$`);

    for (const { table, name, aggregateType, idColumn } of SIMPLE_TRIGGERS) {
      await queryRunner.query(`
        CREATE TRIGGER "tracking_outbox_${name}_ins_del"
        AFTER INSERT OR DELETE ON ${table}
        FOR EACH ROW EXECUTE FUNCTION "tracking"."enqueue_snapshot"('${aggregateType}', '${idColumn}')`);
      // Skip no-op UPDATEs (same row written back) — they'd only produce duplicate snapshots.
      await queryRunner.query(`
        CREATE TRIGGER "tracking_outbox_${name}_upd"
        AFTER UPDATE ON ${table}
        FOR EACH ROW WHEN (OLD.* IS DISTINCT FROM NEW.*)
        EXECUTE FUNCTION "tracking"."enqueue_snapshot"('${aggregateType}', '${idColumn}')`);
    }

    // A load's origin/destination come from its requisition: re-snapshot its loads when either
    // point changes.
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION "tracking"."enqueue_requisition_loads"() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO "tracking"."outbox" ("aggregate_type", "aggregate_id", "tenant_id")
        SELECT 'load', l."id", l."tenant_id" FROM "loads"."loads" l WHERE l."requisition_id" = NEW."id";
        RETURN NULL;
      END
      $$`);
    await queryRunner.query(`
      CREATE TRIGGER "tracking_outbox_requisitions_points"
      AFTER UPDATE OF "loading_point_id", "customer_delivery_point_id" ON "loads"."requisitions"
      FOR EACH ROW
      WHEN (OLD."loading_point_id" IS DISTINCT FROM NEW."loading_point_id"
         OR OLD."customer_delivery_point_id" IS DISTINCT FROM NEW."customer_delivery_point_id")
      EXECUTE FUNCTION "tracking"."enqueue_requisition_loads"()`);

    // Backfill: publish every existing aggregate once.
    await queryRunner.query(`
      INSERT INTO "tracking"."outbox" ("aggregate_type", "aggregate_id", "tenant_id")
      SELECT 'loading_point', "id", "tenant_id" FROM "masters"."loading_points"
      UNION ALL SELECT 'delivery_point', "id", "tenant_id" FROM "customers"."customer_delivery_points"
      UNION ALL SELECT 'vehicle', "id", "tenant_id" FROM "masters"."vehicles"
      UNION ALL SELECT 'driver', "id", NULL FROM "masters"."drivers"
      UNION ALL SELECT 'load', "id", "tenant_id" FROM "loads"."loads"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "tracking_outbox_requisitions_points" ON "loads"."requisitions"`,
    );
    for (const { table, name } of SIMPLE_TRIGGERS) {
      await queryRunner.query(`DROP TRIGGER IF EXISTS "tracking_outbox_${name}_upd" ON ${table}`);
      await queryRunner.query(
        `DROP TRIGGER IF EXISTS "tracking_outbox_${name}_ins_del" ON ${table}`,
      );
    }
    await queryRunner.query(`DROP FUNCTION IF EXISTS "tracking"."enqueue_requisition_loads"()`);
    await queryRunner.query(`DROP FUNCTION IF EXISTS "tracking"."enqueue_snapshot"()`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tracking"."outbox"`);
  }
}
