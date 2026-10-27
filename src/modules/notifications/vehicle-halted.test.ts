import { describe, expect, it, vi } from 'vitest';
import type { TrackingClient, TripEta, TripPosition } from '../../adapters/tracking.client';
import { NOTIFICATION_CATALOG, VehicleHaltedContext } from './catalog/notification-catalog';
import type { LoadAlertRepository } from './load-alert.repository';
import { createLoadAlertResolvers } from './load-alerts';
import type { LoadAlertSnapshot, TrackingEvent } from './notifications.interface';
import { createTrackingEventHandlers } from './tracking-events.consumer';
import { NotificationTriggers, HaltGeofence, HaltGeofences } from './notifications.interface';

const HOUR = 60 * 60 * 1000;
const ANCHOR = { lat: 22.7196, lng: 75.8577 };

const snapshot = {
  code: 'LD-1001',
  status: 'in_transit_unloading',
  vehicleNumber: 'MH12AB1234',
  route: 'Ludhiana to Bhiwandi',
  transporterName: null,
  consigneeName: 'Asian Paints',
  destinationCity: 'Bhiwandi',
  driverName: 'Ramesh Yadav',
  driverPhone: '9876500000',
  originLat: 30.9,
  originLng: 75.85,
  originGeofenceRadiusM: null,
  originLoadingPointId: 'lp-1',
  destinationDeliveryPointId: 'cdp-1',
  destinationLoadingPointId: null,
  destinationLat: 19.3,
  destinationLng: 73.06,
  destinationGeofenceRadiusM: null,
} as unknown as LoadAlertSnapshot;

const context: VehicleHaltedContext = {
  loadId: 'load-1',
  haltAlertId: 'alert-1',
  haltStartedAt: new Date(Date.now() - 2 * HOUR - 5 * 60_000).toISOString(),
  anchorLat: ANCHOR.lat,
  anchorLng: ANCHOR.lng,
  stopPlaceKind: null,
  step: '2h',
};

const freshPosition: TripPosition = {
  ...ANCHOR,
  recordedAt: new Date(),
  stale: false,
  placeName: 'Dewas bypass',
};
const lateEta: TripEta = {
  etaAt: new Date(Date.now() + 20 * HOUR),
  remainingKm: 600,
  stale: false,
  projectedDelayMin: 95,
};

function setup(
  overrides: {
    snapshot?: Partial<LoadAlertSnapshot>;
    eta?: TripEta | null;
    position?: TripPosition | null;
    alreadySent?: boolean;
    geofences?: HaltGeofence[];
  } = {},
) {
  const repository = {
    findSnapshot: vi.fn(async () => ({ ...snapshot, ...overrides.snapshot })),
    hasSentNotification: vi.fn(async () => overrides.alreadySent ?? false),
  } as unknown as LoadAlertRepository;
  const tracking: TrackingClient = {
    getTripEta: vi.fn(),
    getTrip: vi.fn(async () => ({
      eta: overrides.eta === undefined ? lateEta : overrides.eta,
      position: overrides.position === undefined ? freshPosition : overrides.position,
    })),
  };
  const resolvers = createLoadAlertResolvers(repository, vi.fn(), tracking, {
    list: async () => overrides.geofences ?? [],
  } satisfies HaltGeofences);
  return (ctx = context) => resolvers.vehicleHalted('tenant-1', ctx);
}

describe('vehicleHalted resolver (LS_N_0027)', () => {
  it('sends when the truck is still there, outside expected stops, and the ETA is late', async () => {
    const resolved = await setup()();
    expect(resolved).toMatchObject({
      vehicleNo: 'MH12AB1234',
      location: 'Dewas bypass',
      destination: 'Bhiwandi',
      delayMin: 95,
      driverName: 'Ramesh Yadav',
      driverPhone: '9876500000',
    });
    expect(resolved!.haltDurationMin).toBeGreaterThanOrEqual(125);
  });

  it('skips when the ETA is on time, unknown or stale', async () => {
    expect(await setup({ eta: { ...lateEta, projectedDelayMin: 0 } })()).toBeNull();
    expect(await setup({ eta: { ...lateEta, projectedDelayMin: null } })()).toBeNull();
    expect(await setup({ eta: { ...lateEta, stale: true } })()).toBeNull();
    expect(await setup({ eta: null })()).toBeNull();
  });

  it('skips when the truck has moved on or tracking has no fresh position', async () => {
    const moved = { ...freshPosition, lat: ANCHOR.lat + 0.01 }; // ~1.1 km
    expect(await setup({ position: moved })()).toBeNull();
    expect(await setup({ position: { ...freshPosition, stale: true } })()).toBeNull();
    expect(await setup({ position: null })()).toBeNull();
  });

  it('skips a halt inside the destination geofence', async () => {
    expect(
      await setup({ snapshot: { destinationLat: ANCHOR.lat, destinationLng: ANCHOR.lng } })(),
    ).toBeNull();
  });

  it('skips a halt in a rest stop / toll plaza geofence, not in other types', async () => {
    const toll: HaltGeofence = {
      type: 'toll_plaza',
      name: 'Dewas Toll Plaza',
      shape: 'circle',
      ...ANCHOR,
      radiusM: 300,
      polygon: null,
      loadingPointId: null,
      customerDeliveryPointId: null,
    };
    expect(await setup({ geofences: [toll] })()).toBeNull();
    // A fuel pump is not an expected stop — the halt is still alerted.
    expect(await setup({ geofences: [{ ...toll, type: 'fuel_pump' }] })()).not.toBeNull();
    expect(await setup()({ ...context, stopPlaceKind: 'rest_stop' })).toBeNull();
  });

  it('skips once the load is no longer in transit, or this step already went out', async () => {
    expect(await setup({ snapshot: { status: 'reached_unloading' } })()).toBeNull();
    expect(await setup({ alreadySent: true })()).toBeNull();
  });
});

describe('load.vehicle_halted content', () => {
  it('renders the sheet copy, variables and the Call driver CTA', () => {
    const content = NOTIFICATION_CATALOG['load.vehicle_halted'].buildContent({
      ...context,
      vehicleNo: 'MH12AB1234',
      location: 'Dewas bypass',
      destination: 'Bhiwandi',
      revisedEtaAt: lateEta.etaAt.toISOString(),
      delayMin: 95,
      haltDurationMin: 130,
      driverName: 'Ramesh Yadav',
      driverPhone: '9876500000',
    });
    expect(content.title).toBe('MH12AB1234 halted for 2 h 10 min');
    expect(content.body).toMatch(
      /^Stopped near Dewas bypass since .+\. ETA at Bhiwandi has moved to .+, which is 1 h 35 min behind plan\. Driver Ramesh Yadav on 9876500000\.$/,
    );
    expect(content.metadata).toMatchObject({
      vehicle_no: 'MH12AB1234',
      halt_duration: '2 h 10 min',
      location: 'Dewas bypass',
      destination: 'Bhiwandi',
      delay: '1 h 35 min',
      driver_name: 'Ramesh Yadav',
      driver_phone: '9876500000',
      halt_step: '2h',
      cta_label: 'Call driver',
      cta_phone: '+919876500000',
    });
  });
});

describe("tracking's HALT-GPS alert.opened", () => {
  const event = (payload: Record<string, unknown>): TrackingEvent => ({
    streamId: '1-0',
    eventId: '42',
    type: 'alert.opened',
    tenantId: 'tenant-1',
    payload,
  });

  it('queues the 2 h and 6 h checks from the halt start', async () => {
    const enqueue = vi.fn(async () => undefined);
    const handlers = createTrackingEventHandlers({ enqueue } as unknown as NotificationTriggers, {
      markArrivedAtPickup: vi.fn(),
      markDepartedPickup: vi.fn(),
      markReachedDeliveryPoint: vi.fn(),
      markDepartedDrop: vi.fn(),
      notifyGeofenceTransition: vi.fn(),
    });
    const haltStartedAt = new Date(Date.now() - 10 * 60_000);
    await handlers['alert.opened']!(
      event({
        id: 'alert-1',
        rule_id: 'HALT-GPS',
        trip_id: 'load-1',
        tenant_id: 'tenant-1',
        payload: { haltStartedAt: haltStartedAt.toISOString(), anchor: ANCHOR },
      }),
    );
    expect(enqueue).toHaveBeenCalledTimes(2);
    const calls = enqueue.mock.calls as unknown as [
      string,
      string,
      VehicleHaltedContext,
      { delayMs: number },
    ][];
    expect(calls.map(([type, , ctx]) => [type, ctx.step])).toEqual([
      ['load.vehicle_halted', '2h'],
      ['load.vehicle_halted', '6h'],
    ]);
    expect(calls[0][2]).toMatchObject({
      loadId: 'load-1',
      haltAlertId: 'alert-1',
      stopPlaceKind: null,
    });
    const expected2h = haltStartedAt.getTime() + 2 * HOUR - Date.now();
    expect(Math.abs(calls[0][3].delayMs - expected2h)).toBeLessThan(5000);
  });

  it("ignores other rules' alerts", async () => {
    const enqueue = vi.fn();
    const handlers = createTrackingEventHandlers({ enqueue } as unknown as NotificationTriggers, {
      markArrivedAtPickup: vi.fn(),
      markDepartedPickup: vi.fn(),
      markReachedDeliveryPoint: vi.fn(),
      markDepartedDrop: vi.fn(),
      notifyGeofenceTransition: vi.fn(),
    });
    await handlers['alert.opened']!(event({ id: 'a', rule_id: 'OVER-GPS', trip_id: 'load-1' }));
    expect(enqueue).not.toHaveBeenCalled();
  });
});
