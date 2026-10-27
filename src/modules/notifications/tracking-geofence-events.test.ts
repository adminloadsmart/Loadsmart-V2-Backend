import { describe, expect, it, vi } from 'vitest';
import type { TrackingEvent } from './notifications.interface';
import { createTrackingEventHandlers } from './tracking-events.consumer';
import { NotificationTriggers } from './notifications.interface';

const AT = '2026-10-19T10:15:00.000Z';

const event = (type: string, payload: Record<string, unknown>): TrackingEvent => ({
  streamId: '1-0',
  eventId: '7',
  type,
  tenantId: 'tenant-1',
  payload,
});

function setup() {
  const deps = {
    markArrivedAtPickup: vi.fn(async () => true),
    markDepartedPickup: vi.fn(async () => true),
    markReachedDeliveryPoint: vi.fn(async () => true),
    markDepartedDrop: vi.fn(async () => true),
    notifyGeofenceTransition: vi.fn(async () => undefined),
  };
  const enqueue = vi.fn(async () => undefined);
  const handlers = createTrackingEventHandlers(
    { enqueue } as unknown as NotificationTriggers,
    deps,
  );
  return { deps, enqueue, handlers };
}

describe('tracking geofence events', () => {
  it('trip.arrived_at_pickup moves the load to At plant at the arrival time', async () => {
    const { deps, handlers } = setup();
    await handlers['trip.arrived_at_pickup']!(
      event('trip.arrived_at_pickup', { loadId: 'load-1', occurredAt: AT }),
    );
    expect(deps.markArrivedAtPickup).toHaveBeenCalledWith('tenant-1', 'load-1', new Date(AT));
  });

  it('trip.departed_pickup moves the load to In transit and queues LS_N_0026', async () => {
    const { deps, enqueue, handlers } = setup();
    await handlers['trip.departed_pickup']!(
      event('trip.departed_pickup', { loadId: 'load-1', occurredAt: AT }),
    );
    expect(deps.markDepartedPickup).toHaveBeenCalledWith('tenant-1', 'load-1', new Date(AT));
    expect(enqueue).toHaveBeenCalledWith('load.vehicle_in_transit', 'tenant-1', {
      loadId: 'load-1',
      departedAt: AT,
    });
  });

  it('trip.departed_pickup still queues LS_N_0026 when the load was already in transit', async () => {
    const { deps, enqueue, handlers } = setup();
    deps.markDepartedPickup.mockResolvedValueOnce(false);
    await handlers['trip.departed_pickup']!(
      event('trip.departed_pickup', { loadId: 'load-1', occurredAt: AT }),
    );
    expect(enqueue).toHaveBeenCalledWith('load.vehicle_in_transit', 'tenant-1', {
      loadId: 'load-1',
      departedAt: AT,
    });
  });

  it('trip.departed_pickup without a load is skipped', async () => {
    const { deps, enqueue, handlers } = setup();
    await handlers['trip.departed_pickup']!(event('trip.departed_pickup', { occurredAt: AT }));
    expect(deps.markDepartedPickup).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('trip.departed_drop records the departure and queues LS_N_0033', async () => {
    const { deps, enqueue, handlers } = setup();
    await handlers['trip.departed_drop']!(
      event('trip.departed_drop', { loadId: 'load-1', occurredAt: AT }),
    );
    expect(deps.markDepartedDrop).toHaveBeenCalledWith('tenant-1', 'load-1', new Date(AT));
    expect(enqueue).toHaveBeenCalledWith('load.trip_completed', 'tenant-1', { loadId: 'load-1' });
  });

  it('trip.departed_drop without a load is skipped', async () => {
    const { deps, enqueue, handlers } = setup();
    await handlers['trip.departed_drop']!(event('trip.departed_drop', { occurredAt: AT }));
    expect(deps.markDepartedDrop).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('trip.arrived_at_drop moves the load to Reached delivery point', async () => {
    const { deps, handlers } = setup();
    await handlers['trip.arrived_at_drop']!(
      event('trip.arrived_at_drop', { loadId: 'load-1', occurredAt: AT }),
    );
    expect(deps.markReachedDeliveryPoint).toHaveBeenCalledWith('tenant-1', 'load-1', new Date(AT));
  });

  it('trip.arrived_at_drop without a load is skipped', async () => {
    const { deps, handlers } = setup();
    await handlers['trip.arrived_at_drop']!(event('trip.arrived_at_drop', { occurredAt: AT }));
    expect(deps.markReachedDeliveryPoint).not.toHaveBeenCalled();
  });

  it('geofence.entered / geofence.exited send the geofence alert', async () => {
    const { deps, handlers } = setup();
    await handlers['geofence.entered']!(
      event('geofence.entered', {
        geofenceId: 'geo-1',
        vehicleId: 'veh-1',
        vehicleNumber: 'PB10AB1234',
        loadId: 'load-1',
        occurredAt: AT,
      }),
    );
    await handlers['geofence.exited']!(
      event('geofence.exited', { geofenceId: 'geo-1', vehicleId: 'veh-1', occurredAt: AT }),
    );
    expect(deps.notifyGeofenceTransition.mock.calls).toEqual([
      [
        {
          tenantId: 'tenant-1',
          geofenceId: 'geo-1',
          vehicleId: 'veh-1',
          vehicleNumber: 'PB10AB1234',
          event: 'enter',
          loadId: 'load-1',
          at: new Date(AT),
        },
      ],
      [
        {
          tenantId: 'tenant-1',
          geofenceId: 'geo-1',
          vehicleId: 'veh-1',
          vehicleNumber: null,
          event: 'exit',
          loadId: null,
          at: new Date(AT),
        },
      ],
    ]);
  });

  it('a geofence event without geofence or vehicle is skipped', async () => {
    const { deps, handlers } = setup();
    await handlers['geofence.entered']!(event('geofence.entered', { vehicleId: 'veh-1' }));
    expect(deps.notifyGeofenceTransition).not.toHaveBeenCalled();
  });
});
