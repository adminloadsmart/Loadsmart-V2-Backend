import { describe, expect, it, vi } from 'vitest';
import type { TrackingClient } from '../../adapters/tracking.client';
import type { LoadAlertRepository } from './load-alert.repository';
import { createLoadAlertResolvers, createLoadEventNotifier } from './load-alerts';
import type { LoadAlertSnapshot, NotificationTriggers } from './notifications.interface';

const departedAt = new Date('2026-11-10T09:15:00.000Z');

const snapshot = {
  code: 'LD-1005',
  status: 'in_transit_unloading',
  sourceType: 'market',
  vehicleNumber: 'PB06BM2012',
  route: 'Pune to Bhiwandi',
  originCity: 'Pune',
  destinationCity: 'Bhiwandi',
} as unknown as LoadAlertSnapshot;

function resolversWith(
  overrides: Partial<LoadAlertSnapshot> = {},
  sent: { type: string; metadata: Record<string, string> }[] = [],
) {
  const repository = {
    findSnapshot: vi.fn(async () => ({ ...snapshot, ...overrides })),
    hasSentNotification: vi.fn(
      async (_tenantId: string, type: string, metadata: Record<string, string>) =>
        sent.some(
          (row) =>
            row.type === type &&
            Object.entries(metadata).every(([key, value]) => row.metadata[key] === value),
        ),
    ),
  } as unknown as LoadAlertRepository;
  const tracking = { getTripEta: vi.fn(async () => null) } as unknown as TrackingClient;
  return createLoadAlertResolvers(repository, vi.fn(), tracking, { list: async () => [] }, vi.fn());
}

describe('LS_N_0026 vehicle in transit', () => {
  const context = { loadId: 'load-1', departedAt: departedAt.toISOString() };

  it('is queued on any move to In transit, including one marked by hand', async () => {
    const enqueue = vi.fn();
    const notify = createLoadEventNotifier({ enqueue } as unknown as NotificationTriggers);
    await notify({ kind: 'in_transit', tenantId: 'tenant-1', loadId: 'load-1', at: departedAt });
    expect(enqueue).toHaveBeenCalledWith('load.advance_due', 'tenant-1', { loadId: 'load-1' });
    expect(enqueue).toHaveBeenCalledWith('load.vehicle_in_transit', 'tenant-1', context);
  });

  it('goes out the first time for a load', async () => {
    const resolved = await resolversWith().vehicleInTransit('tenant-1', context);
    expect(resolved).toMatchObject({ loadId: 'load-1', origin: 'Pune', destination: 'Bhiwandi' });
  });

  it('is dropped once already sent for the load (manual move, then the geofence exit)', async () => {
    const resolvers = resolversWith({}, [
      { type: 'load.vehicle_in_transit', metadata: { load_id: 'load-1' } },
    ]);
    expect(await resolvers.vehicleInTransit('tenant-1', context)).toBeNull();
  });

  it('is dropped once the vehicle has reached the delivery point', async () => {
    const resolvers = resolversWith({ status: 'reached_unloading' } as Partial<LoadAlertSnapshot>);
    expect(await resolvers.vehicleInTransit('tenant-1', context)).toBeNull();
  });
});
