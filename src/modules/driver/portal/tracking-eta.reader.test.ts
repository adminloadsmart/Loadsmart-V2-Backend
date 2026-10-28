import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import type { DrivingRoute, LatLng } from '../../../adapters/google-routes.client';
import { LoadEntity } from '../../loads/entities/load.entity';
import { RedisTrackingEtaReader } from './tracking-eta.reader';

const latest = vi.hoisted(() => ({ value: {} as Record<string, string> }));
vi.mock('ioredis', () => ({
  default: class {
    async hgetall() {
      return latest.value;
    }
  },
}));

const TRIP = 'trip-1';
const NOW = Date.parse('2026-10-28T10:00:00.000Z');
// Chandigarh University (Gharuan) → Mohali.
const ORIGIN = { lat: 30.7687, lng: 76.5754 };
const DROP = { lat: 30.7046, lng: 76.7179 };

function dataSource(
  load: object | null | (() => never),
  storedRoute: object | null = null,
  masters: Record<string, object> = {},
): DataSource {
  const query = {
    select: () => query,
    addSelect: () => query,
    from: () => query,
    where: () => query,
    orderBy: () => query,
    limit: () => query,
    getRawOne: async () => storedRoute,
  };
  return {
    getRepository: (entity: unknown) =>
      entity === LoadEntity
        ? { findOne: async () => (typeof load === 'function' ? load() : load) }
        : { findOneBy: async ({ id }: { id: string }) => masters[id] ?? null },
    createQueryBuilder: () => query,
  } as unknown as DataSource;
}

const loadAt = (status: string) => ({
  status,
  vehicleId: 'veh-1',
  requisition: {
    loadingPoint: { latitude: String(ORIGIN.lat), longitude: String(ORIGIN.lng) },
    customerDeliveryPoint: { latitude: String(DROP.lat), longitude: String(DROP.lng) },
  },
  posting: null,
});

function google(byOrigin: (origin: LatLng) => DrivingRoute | null) {
  const calls: LatLng[] = [];
  return {
    calls,
    client: {
      drivingRoute: async (origin: LatLng) => {
        calls.push(origin);
        return byOrigin(origin);
      },
    },
  };
}

describe('RedisTrackingEtaReader', () => {
  let nowMs: number;
  const clock = () => nowMs;
  beforeEach(() => {
    nowMs = NOW;
    latest.value = {};
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  it('before the truck heads for the drop: loading → unloading distance, ETA = now + drive time', async () => {
    const { client, calls } = google(() => ({ distanceM: 25_000, durationS: 45 * 60 }));
    const reader = new RedisTrackingEtaReader(
      dataSource(loadAt('loaded')),
      'redis://x',
      client,
      clock,
    );
    expect(await reader.getTripEta(TRIP)).toEqual({
      distanceKm: 25,
      remainingKm: 25,
      etaAt: new Date(NOW + 45 * 60_000).toISOString(),
      source: 'planned',
      stale: false,
    });
    expect(calls).toEqual([ORIGIN]);
  });

  it('uses the stored planned route when tracking has one (no Google call)', async () => {
    const { client, calls } = google(() => null);
    const reader = new RedisTrackingEtaReader(
      dataSource(loadAt('reached_loading'), { distanceM: '26000', durationS: '3000' }),
      'redis://x',
      client,
      clock,
    );
    const eta = await reader.getTripEta(TRIP);
    expect(eta).toMatchObject({ distanceKm: 26, remainingKm: 26, source: 'planned' });
    expect(calls).toHaveLength(0);
  });

  it('in transit to the drop: truck position → unloading point, cached for 10 min', async () => {
    const truck = { lat: 30.74, lng: 76.65 };
    latest.value = {
      lat: String(truck.lat),
      lng: String(truck.lng),
      recordedAt: new Date(NOW - 60_000).toISOString(),
      tripId: TRIP,
    };
    const { client, calls } = google((origin) =>
      origin.lat === ORIGIN.lat
        ? { distanceM: 25_000, durationS: 2700 }
        : { distanceM: 12_400, durationS: 1500 },
    );
    const reader = new RedisTrackingEtaReader(
      dataSource(loadAt('in_transit_unloading')),
      'redis://x',
      client,
      clock,
    );
    expect(await reader.getTripEta(TRIP)).toEqual({
      distanceKm: 25,
      remainingKm: 12.4,
      etaAt: new Date(NOW + 1500 * 1000).toISOString(),
      source: 'live',
      stale: false,
    });

    nowMs = NOW + 5 * 60_000;
    await reader.getTripEta(TRIP);
    expect(calls.filter((c) => c.lat === truck.lat)).toHaveLength(1);
  });

  it('an old fix keeps the last live numbers, marked stale', async () => {
    latest.value = {
      lat: '30.74',
      lng: '76.65',
      recordedAt: new Date(NOW - 60_000).toISOString(),
      tripId: TRIP,
    };
    const { client } = google(() => ({ distanceM: 12_400, durationS: 1500 }));
    const reader = new RedisTrackingEtaReader(
      dataSource(loadAt('in_transit_unloading')),
      'redis://x',
      client,
      clock,
    );
    await reader.getTripEta(TRIP);
    nowMs = NOW + 2 * 60 * 60_000;
    expect(await reader.getTripEta(TRIP)).toMatchObject({
      remainingKm: 12.4,
      source: 'live',
      stale: true,
    });
  });

  it('in transit without any position falls back to the planned route, marked stale', async () => {
    const { client } = google(() => ({ distanceM: 25_000, durationS: 2700 }));
    const reader = new RedisTrackingEtaReader(
      dataSource(loadAt('in_transit_unloading')),
      'redis://x',
      client,
      clock,
    );
    expect(await reader.getTripEta(TRIP)).toMatchObject({
      remainingKm: 25,
      source: 'planned',
      stale: true,
    });
  });

  it('marked reached_unloading but the truck is far from the drop: measured from the truck', async () => {
    // Pasighat → Bhiwani, truck still in Ludhiana (~240 km away).
    const pasighat = { lat: 28.0663, lng: 95.3268 };
    const bhiwani = { lat: 28.795876, lng: 76.149466 };
    latest.value = {
      lat: '30.9546513',
      lng: '75.8306984',
      recordedAt: new Date(NOW - 60_000).toISOString(),
      tripId: TRIP,
    };
    const { client } = google((origin) =>
      origin.lat === pasighat.lat
        ? { distanceM: 2_494_300, durationS: 45 * 3600 }
        : { distanceM: 301_000, durationS: 6 * 3600 },
    );
    const load = {
      ...loadAt('reached_unloading'),
      requisition: {
        loadingPoint: { latitude: String(pasighat.lat), longitude: String(pasighat.lng) },
        customerDeliveryPoint: {
          latitude: String(bhiwani.lat),
          longitude: String(bhiwani.lng),
          geofenceRadiusM: 300,
        },
      },
    };
    const reader = new RedisTrackingEtaReader(dataSource(load), 'redis://x', client, clock);
    expect(await reader.getTripEta(TRIP)).toEqual({
      distanceKm: 2494.3,
      remainingKm: 301,
      etaAt: new Date(NOW + 6 * 3_600_000).toISOString(),
      source: 'live',
      stale: false,
    });
  });

  it('marked reached_unloading with the truck at the drop: nothing left', async () => {
    latest.value = {
      lat: String(DROP.lat + 0.001), // ~110 m away
      lng: String(DROP.lng),
      recordedAt: new Date(NOW - 60_000).toISOString(),
      tripId: TRIP,
    };
    const { client } = google(() => ({ distanceM: 25_000, durationS: 2700 }));
    const reader = new RedisTrackingEtaReader(
      dataSource(loadAt('reached_unloading')),
      'redis://x',
      client,
      clock,
    );
    expect(await reader.getTripEta(TRIP)).toMatchObject({ remainingKm: 0, etaAt: null });
  });

  it('a posting without coordinates uses the masters it was picked from', async () => {
    const posting = {
      pickupAddress: { latitude: null, longitude: null },
      dropAddress: { latitude: null, longitude: null },
      pickupLoadingPointId: 'lp-1',
      dropCustomerDeliveryPointId: 'dp-1',
      dropLoadingPointId: null,
    };
    const { client, calls } = google(() => ({ distanceM: 25_000, durationS: 2700 }));
    const reader = new RedisTrackingEtaReader(
      dataSource({ status: 'loaded', vehicleId: 'veh-1', requisition: null, posting }, null, {
        'lp-1': { latitude: String(ORIGIN.lat), longitude: String(ORIGIN.lng) },
        'dp-1': { latitude: String(DROP.lat), longitude: String(DROP.lng), geofenceRadiusM: 300 },
      }),
      'redis://x',
      client,
      clock,
    );
    expect(await reader.getTripEta(TRIP)).toMatchObject({ remainingKm: 25, source: 'planned' });
    expect(calls).toEqual([ORIGIN]);
  });

  it('a failing load read is logged, and no ETA is shown', async () => {
    const { client } = google(() => null);
    const reader = new RedisTrackingEtaReader(
      dataSource(() => {
        throw new Error('db down');
      }),
      'redis://x',
      client,
      clock,
    );
    expect(await reader.getTripEta(TRIP)).toBeNull();
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('reading the load failed'),
      expect.any(Error),
    );
  });

  it('at the drop: nothing left', async () => {
    const { client } = google(() => ({ distanceM: 25_000, durationS: 2700 }));
    const reader = new RedisTrackingEtaReader(
      dataSource(loadAt('reached_unloading')),
      'redis://x',
      client,
      clock,
    );
    expect(await reader.getTripEta(TRIP)).toMatchObject({ remainingKm: 0, etaAt: null });
  });
});
