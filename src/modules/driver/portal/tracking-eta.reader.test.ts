import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import type { DrivingRoute, LatLng } from '../../../adapters/google-routes.client';
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

function dataSource(load: object | null, storedRoute: object | null = null): DataSource {
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
    getRepository: () => ({ findOne: async () => load }),
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
  });

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

  it('in transit without any position falls back to the planned route', async () => {
    const { client } = google(() => ({ distanceM: 25_000, durationS: 2700 }));
    const reader = new RedisTrackingEtaReader(
      dataSource(loadAt('in_transit_unloading')),
      'redis://x',
      client,
      clock,
    );
    expect(await reader.getTripEta(TRIP)).toMatchObject({ remainingKm: 25, source: 'planned' });
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
