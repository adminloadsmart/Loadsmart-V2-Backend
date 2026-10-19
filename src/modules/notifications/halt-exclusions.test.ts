import { describe, expect, it, vi } from 'vitest';
import {
  createHaltGeofences,
  findHaltExclusion,
  HaltGeofence,
  HaltGeofences,
  stopPlaceKindOf,
  TripEnd,
} from './halt-exclusions';
import type { GeofenceEntity } from '../geofences/entities/geofence.entity';

// ~111 m per 0.001° of latitude.
const ANCHOR = { lat: 22.7196, lng: 75.8577 };
const north = (metres: number) => ({ lat: ANCHOR.lat + metres / 111_320, lng: ANCHOR.lng });
const geofencesOf = (list: HaltGeofence[]): HaltGeofences => ({ list: async () => list });

const circle = (overrides: Partial<HaltGeofence>): HaltGeofence => ({
  type: 'rest_stop',
  name: 'Geofence',
  shape: 'circle',
  ...ANCHOR,
  radiusM: 300,
  polygon: null,
  loadingPointId: null,
  customerDeliveryPointId: null,
  ...overrides,
});

const origin: TripEnd = { loadingPointId: 'lp-1', customerDeliveryPointId: null, pin: null };
const destination: TripEnd = { loadingPointId: null, customerDeliveryPointId: 'cdp-1', pin: null };

const base = {
  tenantId: 'tenant-1',
  anchor: ANCHOR,
  origin,
  destination,
  trackingStopPlaceKind: null,
  geofences: geofencesOf([]),
};

describe('findHaltExclusion', () => {
  it('returns null when the tenant has no matching geofence', async () => {
    expect(await findHaltExclusion(base)).toBeNull();
  });

  it("excludes a halt inside the origin's linked loading_point geofence", async () => {
    const linked = circle({ type: 'loading_point', loadingPointId: 'lp-1' });
    expect(await findHaltExclusion({ ...base, geofences: geofencesOf([linked]) })).toEqual({
      kind: 'origin',
      name: null,
    });
  });

  it('ignores a loading_point geofence linked to another point', async () => {
    const other = circle({ type: 'loading_point', loadingPointId: 'lp-2' });
    expect(await findHaltExclusion({ ...base, geofences: geofencesOf([other]) })).toBeNull();
  });

  it("uses the destination geofence's drawn polygon, not the master pin", async () => {
    // A 1 km square around the anchor, while the master pin's 300 m circle is 800 m away.
    const d = 0.0045;
    const polygon = circle({
      type: 'unloading_point',
      customerDeliveryPointId: 'cdp-1',
      shape: 'polygon',
      radiusM: null,
      polygon: [
        { latitude: ANCHOR.lat - d, longitude: ANCHOR.lng - d },
        { latitude: ANCHOR.lat - d, longitude: ANCHOR.lng + d },
        { latitude: ANCHOR.lat + d, longitude: ANCHOR.lng + d },
        { latitude: ANCHOR.lat + d, longitude: ANCHOR.lng - d },
      ],
    });
    expect(
      await findHaltExclusion({
        ...base,
        destination: { ...destination, pin: { ...north(800), radiusM: 300 } },
        geofences: geofencesOf([polygon]),
      }),
    ).toEqual({ kind: 'destination', name: null });
  });

  it('falls back to the master pin + radius when no geofence is linked', async () => {
    expect(
      await findHaltExclusion({
        ...base,
        origin: { ...origin, pin: { ...north(250), radiusM: null } }, // default 300 m
      }),
    ).toEqual({ kind: 'origin', name: null });
    expect(
      await findHaltExclusion({
        ...base,
        origin: { ...origin, pin: { ...north(250), radiusM: 200 } },
      }),
    ).toBeNull();
  });

  it('excludes a halt inside a rest stop or toll plaza geofence', async () => {
    const toll = circle({ type: 'toll_plaza', name: 'Dewas Toll Plaza', ...north(100) });
    expect(await findHaltExclusion({ ...base, geofences: geofencesOf([toll]) })).toEqual({
      kind: 'toll_plaza',
      name: 'Dewas Toll Plaza',
    });
    const farRestStop = circle({ type: 'rest_stop', ...north(900) });
    expect(await findHaltExclusion({ ...base, geofences: geofencesOf([farRestStop]) })).toBeNull();
  });

  it("honours tracking's own tag without reading geofences", async () => {
    const list = vi.fn(async () => []);
    expect(
      await findHaltExclusion({
        ...base,
        trackingStopPlaceKind: 'rest_stop',
        geofences: { list },
      }),
    ).toEqual({ kind: 'rest_stop', name: null });
    expect(list).not.toHaveBeenCalled();
  });
});

describe('createHaltGeofences', () => {
  it('reads the check types and parses the numeric columns', async () => {
    const listActiveByTypes = vi.fn(async () => [
      {
        type: 'toll_plaza',
        name: 'Dewas Toll Plaza',
        shape: 'circle',
        latitude: '22.719600',
        longitude: '75.857700',
        radiusM: 250,
        polygon: null,
        loadingPointId: null,
        customerDeliveryPointId: null,
      } as unknown as GeofenceEntity,
    ]);
    const [geofence] = await createHaltGeofences({ listActiveByTypes }).list('tenant-1');
    expect(listActiveByTypes).toHaveBeenCalledWith('tenant-1', [
      'loading_point',
      'unloading_point',
      'rest_stop',
      'toll_plaza',
    ]);
    expect(geofence).toMatchObject({ lat: 22.7196, lng: 75.8577, radiusM: 250 });
  });
});

describe('stopPlaceKindOf', () => {
  it('accepts only rest stop / toll plaza', () => {
    expect(stopPlaceKindOf('rest_stop')).toBe('rest_stop');
    expect(stopPlaceKindOf('toll_plaza')).toBe('toll_plaza');
    expect(stopPlaceKindOf('fuel_pump')).toBeNull();
    expect(stopPlaceKindOf(undefined)).toBeNull();
  });
});
