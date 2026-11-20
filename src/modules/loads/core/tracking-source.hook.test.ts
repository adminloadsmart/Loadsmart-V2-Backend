import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import { createDriverTrackingReevaluator, createTrackingSourceHook } from './tracking-source.hook';
import type { LoadRepository } from './load.repository';
import type { LoadEntity } from '../entities/load.entity';

const load = (over: Record<string, unknown> = {}) =>
  ({
    id: 'load-1',
    tenantId: 't1',
    driverId: 'd1',
    vehicleId: 'v1',
    status: 'truck_assigned',
    trackingSource: 'sim',
    podStatus: null,
    driverNumber: '9876543210',
    vehicleNumber: 'PB10AB1234',
    ...over,
  }) as unknown as LoadEntity;

/** A DataSource whose repositories answer from plain values: GPS meta, driver sessions, loads. */
function world(opts: { gps?: boolean; hasSession?: boolean; loads?: LoadEntity[] }) {
  const repos = new Map<string, unknown>();
  const byName = (name: string) => {
    if (name === 'VehicleTelemetryMetaEntity') {
      return {
        findOneBy: async () => (opts.gps ? { hasGps: true, gpsEnabled: true } : null),
      };
    }
    if (name === 'DriverSessionEntity') return { existsBy: async () => opts.hasSession ?? false };
    return { find: vi.fn(async () => opts.loads ?? []) };
  };
  const dataSource = {
    getRepository: (entity: { name: string }) => {
      if (!repos.has(entity.name)) repos.set(entity.name, byName(entity.name));
      return repos.get(entity.name);
    },
  } as unknown as DataSource;
  const update = vi.fn(async () => null);
  return { dataSource, loadRepository: { update } as unknown as LoadRepository, update };
}

describe('createTrackingSourceHook', () => {
  it('only acts on truck_assigned', async () => {
    const { dataSource, loadRepository, update } = world({ hasSession: true });
    await createTrackingSourceHook(dataSource, loadRepository)(load(), 'loaded');
    expect(update).not.toHaveBeenCalled();
  });

  it.each([
    ['gps beats the app', { gps: true, hasSession: true }, 'gps'],
    ['the app beats SIM', { hasSession: true }, 'driver_app'],
    ['SIM when there is no app', { hasSession: false }, 'sim'],
  ])('%s', async (_label, opts, expected) => {
    const { dataSource, loadRepository, update } = world(opts);
    await createTrackingSourceHook(dataSource, loadRepository)(
      load({ trackingSource: null }),
      'truck_assigned',
    );
    expect(update).toHaveBeenCalledWith('t1', 'load-1', { trackingSource: expected });
  });
});

describe('createDriverTrackingReevaluator', () => {
  it('moves a SIM load to driver_app once the driver has the app', async () => {
    const { dataSource, loadRepository, update } = world({
      hasSession: true,
      loads: [load(), load({ id: 'load-2', trackingSource: 'fastag' })],
    });
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    const switched = await createDriverTrackingReevaluator(dataSource, loadRepository)('d1');
    expect(switched).toEqual(['load-1', 'load-2']);
    expect(update).toHaveBeenCalledWith('t1', 'load-1', { trackingSource: 'driver_app' });
    info.mockRestore();
  });

  it('leaves a GPS truck on GPS', async () => {
    const { dataSource, loadRepository, update } = world({
      gps: true,
      hasSession: true,
      loads: [load()],
    });
    expect(await createDriverTrackingReevaluator(dataSource, loadRepository)('d1')).toEqual([]);
    expect(update).not.toHaveBeenCalled();
  });

  it('skips a load whose POD is accepted, and does nothing without an app', async () => {
    const accepted = world({ hasSession: true, loads: [load({ podStatus: 'accepted' })] });
    expect(
      await createDriverTrackingReevaluator(accepted.dataSource, accepted.loadRepository)('d1'),
    ).toEqual([]);
    const noApp = world({ hasSession: false, loads: [load()] });
    expect(
      await createDriverTrackingReevaluator(noApp.dataSource, noApp.loadRepository)('d1'),
    ).toEqual([]);
    expect(accepted.update).not.toHaveBeenCalled();
    expect(noApp.update).not.toHaveBeenCalled();
  });
});
