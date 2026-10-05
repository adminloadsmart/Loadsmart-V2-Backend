import { DataSource, EntityManager } from 'typeorm';

export interface OutboxRow {
  id: string;
  aggregate_type: OutboxAggregateType;
  aggregate_id: string;
  tenant_id: string | null;
}

export const OUTBOX_AGGREGATE_TYPES = [
  'load',
  'vehicle',
  'driver',
  'loading_point',
  'delivery_point',
] as const;
export type OutboxAggregateType = (typeof OUTBOX_AGGREGATE_TYPES)[number];

export interface LoadSnapshotRow {
  id: string;
  tenant_id: string;
  code: string;
  status: string;
  source_type: string;
  vehicle_id: string | null;
  vehicle_number: string | null;
  driver_id: string | null;
  driver_number: string | null;
  driver_name: string | null;
  transporter_id: string | null;
  loading_point_id: string | null;
  customer_delivery_point_id: string | null;
  loading_confirmed_at: Date | null;
  at_plant_at: Date | null;
  in_transit_at: Date | null;
  reached_delivery_point_at: Date | null;
  delivered_at: Date | null;
  version: string;
}

export interface VehicleSnapshotRow {
  id: string;
  tenant_id: string;
  registration_number: string;
  status: string | null;
  deleted_at: Date | null;
  gps_provider: string | null;
  gps_enabled: boolean | null;
  gps_device_imei: string | null;
  version: string;
}

export interface DriverSnapshotRow {
  id: string;
  full_name: string;
  phone_number: string;
  deleted_at: Date | null;
  version: string;
}

export interface PlaceSnapshotRow {
  id: string;
  tenant_id: string;
  name: string;
  address_line_1: string | null;
  address_line_2: string | null;
  city: string | null;
  state: string | null;
  pin_code: string | null;
  latitude: string | null;
  longitude: string | null;
  deleted_at: Date | null;
  version: string;
}

/**
 * Reads tracking.outbox (filled by DB triggers — see migration TrackingOutbox1790100000000) and
 * the current state of each changed aggregate. Snapshots are always built from current DB state at
 * relay time, never from the change itself, so the published state can't be older than its
 * version. `version` = epoch ms of the latest updated_at among the rows an aggregate is built from.
 */
export class TrackingOutboxRepository {
  constructor(private readonly dataSource: DataSource) {}

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  /** Claims the oldest rows; SKIP LOCKED lets several relays (app instances) run side by side. */
  claimBatch(manager: EntityManager, limit: number): Promise<OutboxRow[]> {
    return manager.query(
      `SELECT "id", "aggregate_type", "aggregate_id", "tenant_id" FROM "tracking"."outbox"
       ORDER BY "id" LIMIT $1 FOR UPDATE SKIP LOCKED`,
      [limit],
    );
  }

  async deleteRows(manager: EntityManager, ids: string[]): Promise<void> {
    await manager.query(`DELETE FROM "tracking"."outbox" WHERE "id" = ANY($1::bigint[])`, [ids]);
  }

  findLoads(manager: EntityManager, ids: string[]): Promise<LoadSnapshotRow[]> {
    return manager.query(
      `SELECT l."id", l."tenant_id", l."code", l."status", l."source_type", l."vehicle_id",
              l."vehicle_number", l."driver_id", l."driver_number", l."driver_name",
              l."transporter_id", r."loading_point_id", r."customer_delivery_point_id",
              l."loading_confirmed_at", l."at_plant_at", l."in_transit_at",
              l."reached_delivery_point_at", l."delivered_at",
              (extract(epoch FROM l."updated_at") * 1000)::bigint AS "version"
       FROM "loads"."loads" l
       LEFT JOIN "loads"."requisitions" r ON r."id" = l."requisition_id"
       WHERE l."id" = ANY($1::uuid[])`,
      [ids],
    );
  }

  findVehicles(manager: EntityManager, ids: string[]): Promise<VehicleSnapshotRow[]> {
    return manager.query(
      `SELECT v."id", v."tenant_id", v."registration_number", v."status"::text AS "status",
              v."deleted_at", m."gps_provider", m."gps_enabled", m."gps_device_imei",
              (extract(epoch FROM GREATEST(v."updated_at", m."updated_at")) * 1000)::bigint AS "version"
       FROM "masters"."vehicles" v
       LEFT JOIN "masters"."vehicle_telemetry_meta" m
         ON m."vehicle_id" = v."id" AND m."deleted_at" IS NULL
       WHERE v."id" = ANY($1::uuid[])`,
      [ids],
    );
  }

  findDrivers(manager: EntityManager, ids: string[]): Promise<DriverSnapshotRow[]> {
    return manager.query(
      `SELECT "id", "full_name", "phone_number", "deleted_at",
              (extract(epoch FROM "updated_at") * 1000)::bigint AS "version"
       FROM "masters"."drivers" WHERE "id" = ANY($1::uuid[])`,
      [ids],
    );
  }

  findLoadingPoints(manager: EntityManager, ids: string[]): Promise<PlaceSnapshotRow[]> {
    return manager.query(
      `SELECT "id", "tenant_id", "title" AS "name", "address_line_1", "address_line_2", "city",
              "state", "pin_code", "latitude", "longitude", "deleted_at",
              (extract(epoch FROM "updated_at") * 1000)::bigint AS "version"
       FROM "masters"."loading_points" WHERE "id" = ANY($1::uuid[])`,
      [ids],
    );
  }

  findDeliveryPoints(manager: EntityManager, ids: string[]): Promise<PlaceSnapshotRow[]> {
    return manager.query(
      `SELECT "id", "tenant_id", "location" AS "name", "address_line_1", "address_line_2", "city",
              "state", "pin_code", NULL AS "latitude", NULL AS "longitude", "deleted_at",
              (extract(epoch FROM "updated_at") * 1000)::bigint AS "version"
       FROM "customers"."customer_delivery_points" WHERE "id" = ANY($1::uuid[])`,
      [ids],
    );
  }
}
