import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import {
  createDriverAccountMatcher,
  createDriverTrackingReevaluator,
  createTrackingSourceHook,
} from './tracking-source.hook';
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

type Account = { id: string; phoneNumber: string };

/** A DataSource whose repositories answer from plain values: GPS meta, driver sessions, loads,
 *  driver accounts. Loads are matched on the driverId / driverNumber of each `where` branch. */
function world(opts: {
  gps?: boolean;
  hasSession?: boolean;
  loads?: LoadEntity[];
  accounts?: Account[];
}) {
  const accounts = opts.accounts ?? [];
  const inList = (cond: unknown, value: unknown) =>
    cond && typeof cond === 'object' && '_value' in cond
      ? (cond as { _value: unknown[] })._value.includes(value)
      : cond === value;
  const repos = new Map<string, unknown>();
  const byName = (name: string) => {
    if (name === 'VehicleTelemetryMetaEntity') {
      return {
        findOneBy: async () => (opts.gps ? { hasGps: true, gpsEnabled: true } : null),
      };
    }
    if (name === 'DriverSessionEntity') return { existsBy: async () => opts.hasSession ?? false };
    if (name === 'DriverEntity') {
      return {
        findOne: async ({ where }: { where: { id: string } }) =>
          accounts.find((a) => a.id === where.id) ?? null,
        find: async ({ where }: { where: { phoneNumber: unknown } }) =>
          accounts.filter((a) => inList(where.phoneNumber, a.phoneNumber)),
      };
    }
    return {
      find: vi.fn(
        async ({ where }: { where: Record<string, unknown> | Record<string, unknown>[] }) => {
          const branches = Array.isArray(where) ? where : [where];
          return (opts.loads ?? []).filter((l) =>
            branches.some((b) => {
              const row = l as unknown as Record<string, unknown>;
              if ('driverNumber' in b)
                return row.driverId === null && inList(b.driverNumber, row.driverNumber);
              return row.driverId === b.driverId;
            }),
          );
        },
      ),
    };
  };
  const dataSource = {
    getRepository: (entity: { name: string }) => {
      if (!repos.has(entity.name)) repos.set(entity.name, byName(entity.name));
      return repos.get(entity.name);
    },
  } as unknown as DataSource;
  const update = vi.fn(
    async (_tenantId: string, _loadId: string, _data: Record<string, unknown>) => null,
  );
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

describe('market / indent loads and driver accounts', () => {
  const market = (over: Record<string, unknown> = {}) =>
    load({ driverId: null, vehicleId: null, postingType: 'market_fleet', ...over });

  it('matches exactly one account by mobile number, in either stored form', async () => {
    const { dataSource } = world({ accounts: [{ id: 'd9', phoneNumber: '919876543210' }] });
    const match = createDriverAccountMatcher(dataSource);
    expect(await match('9876543210')).toBe('d9');
    expect(await match('12345')).toBeNull();
    expect(await match(null)).toBeNull();
  });

  it('never links a number two accounts share, or one nobody has', async () => {
    const shared = world({
      accounts: [
        { id: 'd1', phoneNumber: '9876543210' },
        { id: 'd2', phoneNumber: '9876543210' },
      ],
    });
    expect(await createDriverAccountMatcher(shared.dataSource)('9876543210')).toBeNull();
    expect(await createDriverAccountMatcher(world({}).dataSource)('9876543210')).toBeNull();
  });

  it.each(['market_fleet', 'indent'])(
    'links a %s load named by phone on login and moves it from SIM to the app',
    async (postingType) => {
      const onRoad = market({ postingType });
      const { dataSource, loadRepository, update } = world({
        hasSession: true,
        accounts: [{ id: 'd9', phoneNumber: '9876543210' }],
        loads: [onRoad],
      });
      // The repository update is what the next lookup sees.
      update.mockImplementation(async (_t: string, _id: string, data: Record<string, unknown>) => {
        Object.assign(onRoad, data);
        return null;
      });
      const info = vi.spyOn(console, 'info').mockImplementation(() => {});
      const switched = await createDriverTrackingReevaluator(dataSource, loadRepository)('d9');
      info.mockRestore();
      expect(update).toHaveBeenCalledWith('t1', 'load-1', { driverId: 'd9' });
      expect(update).toHaveBeenCalledWith('t1', 'load-1', { trackingSource: 'driver_app' });
      expect(switched).toEqual(['load-1']);
    },
  );

  it('does not link when the number belongs to another account too', async () => {
    const { dataSource, loadRepository, update } = world({
      hasSession: true,
      accounts: [
        { id: 'd9', phoneNumber: '9876543210' },
        { id: 'd8', phoneNumber: '9876543210' },
      ],
      loads: [market()],
    });
    expect(await createDriverTrackingReevaluator(dataSource, loadRepository)('d9')).toEqual([]);
    expect(update).not.toHaveBeenCalled();
  });
});
