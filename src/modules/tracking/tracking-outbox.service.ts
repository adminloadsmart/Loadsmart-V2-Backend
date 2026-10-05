import type Redis from 'ioredis';
import { EntityManager } from 'typeorm';
import {
  LoadSnapshotRow,
  OutboxAggregateType,
  OutboxRow,
  PlaceSnapshotRow,
  TrackingOutboxRepository,
  VehicleSnapshotRow,
  DriverSnapshotRow,
} from './tracking-outbox.repository';

/** Stream the loadsmart-tracking service consumes — see its docs/contracts/loadsmart-events.md. */
export const LOADSMART_EVENTS_STREAM = 'loadsmart.events';
// Approximate cap: the stream is a transport, not storage; tracking's consumer group keeps up in
// seconds, and a full republish is always possible (snapshots are idempotent).
const STREAM_MAX_LEN = 100_000;
const BATCH_SIZE = 500;
// Bounds one relay run so a large backfill doesn't hold the worker for minutes; the next run
// (every few seconds) continues where this one stopped.
const MAX_BATCHES_PER_RUN = 20;

/** Stream fields for one snapshot, exactly as the contract specifies. */
export type SnapshotFields = Record<string, string>;

function iso(value: Date | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function joinAddress(...parts: Array<string | null>): string | null {
  const joined = parts.filter((part) => part && part.trim()).join(', ');
  return joined || null;
}

function toCoordinate(value: string | null): number | null {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function loadFields(row: LoadSnapshotRow): SnapshotFields {
  return {
    type: 'load',
    id: row.id,
    tenantId: row.tenant_id,
    version: String(row.version),
    deleted: 'false',
    payload: JSON.stringify({
      code: row.code,
      status: row.status,
      sourceType: row.source_type,
      vehicleId: row.vehicle_id,
      vehicleNumber: row.vehicle_number,
      driverId: row.driver_id,
      driverNumber: row.driver_number,
      driverName: row.driver_name,
      transporterId: row.transporter_id,
      loadingPointId: row.loading_point_id,
      deliveryPointId: row.customer_delivery_point_id,
      milestones: {
        loadingConfirmedAt: iso(row.loading_confirmed_at),
        atPlantAt: iso(row.at_plant_at),
        inTransitAt: iso(row.in_transit_at),
        reachedDeliveryPointAt: iso(row.reached_delivery_point_at),
        deliveredAt: iso(row.delivered_at),
      },
    }),
  };
}

export function vehicleFields(row: VehicleSnapshotRow): SnapshotFields {
  if (row.deleted_at) return tombstone('vehicle', row.id, row.tenant_id, String(row.version));
  return {
    type: 'vehicle',
    id: row.id,
    tenantId: row.tenant_id,
    version: String(row.version),
    deleted: 'false',
    payload: JSON.stringify({
      registrationNumber: row.registration_number,
      status: row.status,
      gpsProvider: row.gps_provider,
      gpsEnabled: row.gps_enabled ?? false,
      gpsDeviceImei: row.gps_device_imei,
    }),
  };
}

export function driverFields(row: DriverSnapshotRow): SnapshotFields {
  // Drivers are global profiles: no tenantId field (see the contract).
  if (row.deleted_at) return tombstone('driver', row.id, null, String(row.version));
  return {
    type: 'driver',
    id: row.id,
    version: String(row.version),
    deleted: 'false',
    payload: JSON.stringify({ fullName: row.full_name, phoneNumber: row.phone_number }),
  };
}

export function placeFields(
  type: 'loading_point' | 'delivery_point',
  row: PlaceSnapshotRow,
): SnapshotFields {
  if (row.deleted_at) return tombstone(type, row.id, row.tenant_id, String(row.version));
  return {
    type,
    id: row.id,
    tenantId: row.tenant_id,
    version: String(row.version),
    deleted: 'false',
    payload: JSON.stringify({
      name: row.name,
      address: joinAddress(row.address_line_1, row.address_line_2),
      city: row.city,
      state: row.state,
      pinCode: row.pin_code,
      lat: toCoordinate(row.latitude),
      lng: toCoordinate(row.longitude),
    }),
  };
}

export function tombstone(
  type: OutboxAggregateType,
  id: string,
  tenantId: string | null,
  version: string,
): SnapshotFields {
  return {
    type,
    id,
    ...(type === 'driver' || !tenantId ? {} : { tenantId }),
    version,
    deleted: 'true',
  };
}

/**
 * Relays tracking.outbox to the `loadsmart.events` stream: claim a batch (SKIP LOCKED), rebuild
 * each changed aggregate's current snapshot, XADD them, delete the claimed rows — all inside one
 * DB transaction, so a failed XADD leaves the rows for the next run. A crash after XADD but
 * before commit republishes the same snapshots, which the consumer ignores (same version).
 */
export class TrackingOutboxService {
  constructor(
    private readonly repository: TrackingOutboxRepository,
    private readonly redis: () => Redis,
  ) {}

  /** Returns how many snapshots were published. */
  async relay(): Promise<number> {
    let published = 0;
    for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
      const count = await this.repository.transaction(async (manager) => {
        const rows = await this.repository.claimBatch(manager, BATCH_SIZE);
        if (rows.length === 0) return -1;

        const snapshots = await this.buildSnapshots(manager, rows);
        await this.publish(snapshots);
        await this.repository.deleteRows(
          manager,
          rows.map((row) => row.id),
        );
        return snapshots.length;
      });
      if (count < 0) break;
      published += count;
      if (count < BATCH_SIZE) break;
    }
    return published;
  }

  async buildSnapshots(manager: EntityManager, rows: OutboxRow[]): Promise<SnapshotFields[]> {
    // Several outbox rows for one aggregate collapse into one snapshot of its current state.
    const byType = new Map<OutboxAggregateType, Map<string, string | null>>();
    for (const row of rows) {
      const ids = byType.get(row.aggregate_type) ?? new Map<string, string | null>();
      ids.set(row.aggregate_id, row.tenant_id ?? ids.get(row.aggregate_id) ?? null);
      byType.set(row.aggregate_type, ids);
    }

    const snapshots: SnapshotFields[] = [];
    for (const [type, tenantById] of byType) {
      const ids = [...tenantById.keys()];
      const found = await this.findCurrent(manager, type, ids);
      for (const id of ids) {
        // Row gone: hard delete. The trigger captured its tenant at delete time.
        snapshots.push(
          found.get(id) ?? tombstone(type, id, tenantById.get(id) ?? null, String(Date.now())),
        );
      }
    }
    return snapshots.filter(
      // A tenant-scoped tombstone without a tenant can't be routed by the consumer — skip it.
      (fields) => fields.type === 'driver' || Boolean(fields.tenantId),
    );
  }

  private async findCurrent(
    manager: EntityManager,
    type: OutboxAggregateType,
    ids: string[],
  ): Promise<Map<string, SnapshotFields>> {
    const entries: Array<[string, SnapshotFields]> = [];
    switch (type) {
      case 'load':
        for (const row of await this.repository.findLoads(manager, ids)) {
          entries.push([row.id, loadFields(row)]);
        }
        break;
      case 'vehicle':
        for (const row of await this.repository.findVehicles(manager, ids)) {
          entries.push([row.id, vehicleFields(row)]);
        }
        break;
      case 'driver':
        for (const row of await this.repository.findDrivers(manager, ids)) {
          entries.push([row.id, driverFields(row)]);
        }
        break;
      case 'loading_point':
        for (const row of await this.repository.findLoadingPoints(manager, ids)) {
          entries.push([row.id, placeFields('loading_point', row)]);
        }
        break;
      case 'delivery_point':
        for (const row of await this.repository.findDeliveryPoints(manager, ids)) {
          entries.push([row.id, placeFields('delivery_point', row)]);
        }
        break;
    }
    return new Map(entries);
  }

  private async publish(snapshots: SnapshotFields[]): Promise<void> {
    if (snapshots.length === 0) return;
    const pipeline = this.redis().pipeline();
    for (const fields of snapshots) {
      pipeline.xadd(
        LOADSMART_EVENTS_STREAM,
        'MAXLEN',
        '~',
        STREAM_MAX_LEN,
        '*',
        ...Object.entries(fields).flat(),
      );
    }
    const results = await pipeline.exec();
    const failed = results?.find(([err]) => err);
    if (failed) throw failed[0];
  }
}
