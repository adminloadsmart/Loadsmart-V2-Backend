import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from 'typeorm';
import {
  driverFields,
  loadFields,
  placeFields,
  TrackingOutboxService,
  vehicleFields,
} from './tracking-outbox.service';
import type { TrackingOutboxRepository } from './tracking-outbox.repository';

const TENANT = '11111111-1111-4111-8111-111111111111';
const manager = {} as EntityManager;

describe('snapshot field builders (contract: loadsmart-tracking docs/contracts/loadsmart-events.md)', () => {
  it('load: full state with requisition points and ISO milestones', () => {
    const fields = loadFields({
      id: 'l1',
      tenant_id: TENANT,
      code: 'LOAD-0001',
      status: 'in_transit',
      source_type: 'market',
      vehicle_id: null,
      vehicle_number: 'MH12AB1234',
      driver_id: null,
      driver_number: '9876543210',
      driver_name: 'Ravi',
      transporter_id: 't1',
      loading_point_id: 'lp1',
      customer_delivery_point_id: 'dp1',
      customer_id: 'c1',
      promised_delivery_at: new Date('2026-10-06T18:29:00Z'),
      loading_confirmed_at: new Date('2026-10-05T08:00:00Z'),
      at_plant_at: null,
      in_transit_at: null,
      reached_delivery_point_at: null,
      delivered_at: null,
      version: '1759651200000',
    });
    expect(fields).toMatchObject({
      type: 'load',
      id: 'l1',
      tenantId: TENANT,
      version: '1759651200000',
      deleted: 'false',
    });
    expect(JSON.parse(fields.payload)).toMatchObject({
      status: 'in_transit',
      sourceType: 'market',
      loadingPointId: 'lp1',
      deliveryPointId: 'dp1',
      customerId: 'c1',
      promisedDeliveryAt: '2026-10-06T18:29:00.000Z',
      milestones: { loadingConfirmedAt: '2026-10-05T08:00:00.000Z', deliveredAt: null },
    });
  });

  it('vehicle: telemetry fields, gpsEnabled defaults false, soft delete becomes a tombstone', () => {
    const row = {
      id: 'v1',
      tenant_id: TENANT,
      registration_number: 'MH12AB1234',
      status: 'active',
      deleted_at: null,
      gps_provider: null,
      gps_enabled: null,
      gps_device_imei: '359339077123456',
      body_type: 'tanker',
      version: '5',
    };
    expect(JSON.parse(vehicleFields(row).payload)).toEqual({
      registrationNumber: 'MH12AB1234',
      status: 'active',
      gpsProvider: null,
      gpsEnabled: false,
      gpsDeviceImei: '359339077123456',
      bodyType: 'tanker',
    });
    expect(vehicleFields({ ...row, deleted_at: new Date() })).toEqual({
      type: 'vehicle',
      id: 'v1',
      tenantId: TENANT,
      version: '5',
      deleted: 'true',
    });
  });

  it('driver: global — never carries a tenantId', () => {
    const fields = driverFields({
      id: 'd1',
      full_name: 'Ravi',
      phone_number: '98',
      deleted_at: null,
      version: '1',
    });
    expect(fields).not.toHaveProperty('tenantId');
    expect(JSON.parse(fields.payload)).toEqual({ fullName: 'Ravi', phoneNumber: '98' });
  });

  it('place: joins address lines and parses numeric coordinates', () => {
    const fields = placeFields('loading_point', {
      id: 'p1',
      tenant_id: TENANT,
      name: 'Plant A',
      address_line_1: 'Plot 1',
      address_line_2: ' ',
      city: 'Delhi',
      state: 'DL',
      pin_code: '110001',
      latitude: '28.613900',
      longitude: '77.209000',
      deleted_at: null,
      version: '1',
    });
    expect(JSON.parse(fields.payload)).toEqual({
      name: 'Plant A',
      address: 'Plot 1',
      city: 'Delhi',
      state: 'DL',
      pinCode: '110001',
      lat: 28.6139,
      lng: 77.209,
    });
  });
});

describe('TrackingOutboxService.buildSnapshots', () => {
  function service(overrides: Partial<Record<keyof TrackingOutboxRepository, unknown>>) {
    const repository = {
      findLoads: vi.fn().mockResolvedValue([]),
      findVehicles: vi.fn().mockResolvedValue([]),
      findDrivers: vi.fn().mockResolvedValue([]),
      findLoadingPoints: vi.fn().mockResolvedValue([]),
      findDeliveryPoints: vi.fn().mockResolvedValue([]),
      ...overrides,
    } as unknown as TrackingOutboxRepository;
    return { svc: new TrackingOutboxService(repository, () => ({}) as never), repository };
  }

  it('collapses repeated changes to one snapshot per aggregate', async () => {
    const { svc, repository } = service({
      findDrivers: vi
        .fn()
        .mockResolvedValue([
          { id: 'd1', full_name: 'R', phone_number: '1', deleted_at: null, version: '2' },
        ]),
    });
    const snapshots = await svc.buildSnapshots(manager, [
      { id: '1', aggregate_type: 'driver', aggregate_id: 'd1', tenant_id: null },
      { id: '2', aggregate_type: 'driver', aggregate_id: 'd1', tenant_id: null },
    ]);
    expect(snapshots).toHaveLength(1);
    expect(repository.findDrivers).toHaveBeenCalledWith(manager, ['d1']);
  });

  it('turns a hard-deleted row into a tombstone using the tenant captured by the trigger', async () => {
    const { svc } = service({});
    const snapshots = await svc.buildSnapshots(manager, [
      { id: '1', aggregate_type: 'load', aggregate_id: 'gone', tenant_id: TENANT },
      { id: '2', aggregate_type: 'vehicle', aggregate_id: 'no-tenant', tenant_id: null },
    ]);
    expect(snapshots).toEqual([
      expect.objectContaining({ type: 'load', id: 'gone', tenantId: TENANT, deleted: 'true' }),
    ]);
  });
});
