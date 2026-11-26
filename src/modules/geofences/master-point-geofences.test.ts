import { describe, expect, it, vi } from 'vitest';
import { DataSource } from 'typeorm';
import { CustomerDeliveryPointEntity } from '../customers/entities/customer-delivery-point.entity';
import { CustomerEntity } from '../customers/entities/customer.entity';
import { LoadingPointEntity } from '../masters/loading-point/entities/loading-point.entity';
import { MasterPointGeofences } from './master-point-geofences';

const TENANT = 'tenant-1';

function setup(opts: {
  loadingPoint?: Partial<LoadingPointEntity> | null;
  deliveryPoint?: Partial<CustomerDeliveryPointEntity> | null;
  loadingFence?: boolean;
  deliveryFenceFor?: string[];
  pin?: { lat: number; lng: number } | null;
}) {
  const loadingRepo = {
    findOneBy: vi.fn(async () => opts.loadingPoint ?? null),
    update: vi.fn(async () => ({})),
  };
  const deliveryRepo = {
    findOneBy: vi.fn(async () => opts.deliveryPoint ?? null),
    update: vi.fn(async () => ({})),
  };
  const customer = {
    id: 'cust-1',
    tenantId: TENANT,
    deliveryPoints: [],
  } as unknown as CustomerEntity;
  const customerRepo = { findOne: vi.fn(async () => customer) };
  const dataSource = {
    getRepository: (entity: unknown) =>
      entity === LoadingPointEntity
        ? loadingRepo
        : entity === CustomerDeliveryPointEntity
          ? deliveryRepo
          : customerRepo,
  } as unknown as DataSource;
  const geofences = {
    findByLoadingPointId: vi.fn(async () => (opts.loadingFence ? ({ id: 'g1' } as never) : null)),
    findByCustomerId: vi.fn(async () =>
      (opts.deliveryFenceFor ?? []).map((id) => ({ customerDeliveryPointId: id }) as never),
    ),
  };
  const loadingSync = { upsert: vi.fn(async () => undefined) };
  const deliverySync = { sync: vi.fn(async () => undefined) };
  const geocode = vi.fn(async () =>
    opts.pin ? ({ geometry: { location: opts.pin } } as never) : null,
  );
  const service = new MasterPointGeofences(dataSource, geofences, loadingSync, deliverySync, {
    geocode,
  });
  return { service, loadingRepo, deliveryRepo, customer, loadingSync, deliverySync, geocode };
}

describe('MasterPointGeofences.ensure', () => {
  it('fences a pinned loading point that has no geofence', async () => {
    const point = { id: 'lp-1', tenantId: TENANT, latitude: '19.1', longitude: '72.9' };
    const t = setup({ loadingPoint: point });
    await t.service.ensure(TENANT, { loadingPointIds: ['lp-1', null], deliveryPointIds: [] }, 'u1');
    expect(t.loadingSync.upsert).toHaveBeenCalledWith(point, 'u1');
    expect(t.geocode).not.toHaveBeenCalled();
  });

  it('leaves a loading point that already has its geofence alone', async () => {
    const t = setup({
      loadingPoint: { id: 'lp-1', latitude: '19.1', longitude: '72.9' },
      loadingFence: true,
    });
    await t.service.ensure(TENANT, { loadingPointIds: ['lp-1'], deliveryPointIds: [] }, 'u1');
    expect(t.loadingSync.upsert).not.toHaveBeenCalled();
  });

  it('pins an unpinned loading point from its address, saves the pin, then fences it', async () => {
    const t = setup({
      loadingPoint: { id: 'lp-1', title: 'Plant', city: 'Pune', latitude: null, longitude: null },
      pin: { lat: 18.5, lng: 73.8 },
    });
    await t.service.ensure(TENANT, { loadingPointIds: ['lp-1'], deliveryPointIds: [] }, 'u1');
    expect(t.loadingRepo.update).toHaveBeenCalledWith(
      { id: 'lp-1', tenantId: TENANT },
      { latitude: '18.5', longitude: '73.8' },
    );
    expect(t.loadingSync.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ latitude: '18.5', longitude: '73.8' }),
      'u1',
    );
  });

  it('skips a point Google cannot place (nothing to fence)', async () => {
    const t = setup({ loadingPoint: { id: 'lp-1', latitude: null, longitude: null }, pin: null });
    await t.service.ensure(TENANT, { loadingPointIds: ['lp-1'], deliveryPointIds: [] }, 'u1');
    expect(t.loadingSync.upsert).not.toHaveBeenCalled();
  });

  it("syncs the customer's geofences when an unloading point has none", async () => {
    const t = setup({
      deliveryPoint: { id: 'dp-1', customerId: 'cust-1', latitude: '28.6', longitude: '77.2' },
      deliveryFenceFor: ['dp-other'],
    });
    await t.service.ensure(TENANT, { loadingPointIds: [], deliveryPointIds: ['dp-1'] }, 'u1');
    expect(t.deliverySync.sync).toHaveBeenCalledWith(t.customer, 'u1');
  });

  it('pins an unpinned unloading point before syncing', async () => {
    const t = setup({
      deliveryPoint: {
        id: 'dp-1',
        customerId: 'cust-1',
        location: 'Okhla DC',
        city: 'Delhi',
        latitude: null,
        longitude: null,
      },
      pin: { lat: 28.5, lng: 77.27 },
    });
    await t.service.ensure(TENANT, { loadingPointIds: [], deliveryPointIds: ['dp-1'] }, 'u1');
    expect(t.deliveryRepo.update).toHaveBeenCalledWith(
      { id: 'dp-1', tenantId: TENANT },
      { latitude: '28.5', longitude: '77.27' },
    );
    expect(t.deliverySync.sync).toHaveBeenCalled();
  });

  it('leaves an unloading point that already has its geofence alone', async () => {
    const t = setup({
      deliveryPoint: { id: 'dp-1', customerId: 'cust-1', latitude: '28.6', longitude: '77.2' },
      deliveryFenceFor: ['dp-1'],
    });
    await t.service.ensure(TENANT, { loadingPointIds: [], deliveryPointIds: ['dp-1'] }, 'u1');
    expect(t.deliverySync.sync).not.toHaveBeenCalled();
  });
});
