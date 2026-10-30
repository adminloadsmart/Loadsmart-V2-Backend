import { describe, expect, it, vi } from 'vitest';
import type { DataSource } from 'typeorm';
import type { AuditService } from '../../audit/audit.service';
import type { CustomerService } from '../../customers/customer.service';
import type { DriverAuthService } from '../../driver/auth/driver-auth.service';
import type { TruckTypeService } from '../../masters/truck-type/truck-type.service';
import type { VehicleService } from '../../masters/vehicle/vehicle.service';
import type { NotificationsService } from '../../notifications/notifications.service';
import type { AssignmentComplianceService } from '../assignment-compliance.service';
import type { CodeSequenceRepository } from '../code-sequence.repository';
import type { LoadActivityService } from '../load-activity.service';
import type { LoadRepository } from '../load.repository';
import type { AssignmentCompliance } from '../utils/load.interface';
import type { LoadDispatchNotifier } from './load-dispatch-notifier';
import type { LoadPostingRepository } from './load-posting.repository';
import { LoadPostingService } from './load-posting.service';
import type { PostLoadInput } from './utils/load-posting.interface';

const HOUR_MS = 60 * 60 * 1000;

const vehicle = {
  id: 'vehicle-1',
  registrationNumber: 'MH12AB1234',
  status: 'active',
  operationalStatus: { operationalStatus: 'idle' },
  driverLinks: [{ driverId: 'driver-1', isPrimary: true, status: 'active' }],
  grossVehicleWeightKg: 16000,
  capacityTons: '10',
};

const baseDriverRelation = {
  driverId: 'driver-1',
  status: 'active',
  operationalStatus: { operationalStatus: 'active' },
  driver: {
    id: 'driver-1',
    fullName: 'Ramesh Yadav',
    phoneNumber: '9876543210',
    licenseExpiry: '2030-01-01',
    // LMV only — not enough for a 16 t truck.
    verifications: [{ licenseClass: 'LMV', createdAt: new Date('2026-10-01') }],
  },
};

const address = (city: string, pinCode: string) => ({
  label: `${city} yard`,
  addressLine1: `${city} yard`,
  city,
  state: 'Maharashtra',
  pinCode,
  source: 'google',
});

const ownFleetPostInput = {
  mode: 'own_fleet',
  vehicleId: 'vehicle-1',
  truckCount: 1,
  pickupAt: new Date(Date.now() + 24 * HOUR_MS).toISOString(),
  pickup: { newAddress: address('Pune', '411001') },
  drop: { newAddress: address('Mumbai', '400001') },
} as unknown as PostLoadInput;

function setup(compliance: Partial<AssignmentCompliance>, licenseExpiry = '2030-01-01') {
  const driverRelation = {
    ...baseDriverRelation,
    driver: { ...baseDriverRelation.driver, licenseExpiry },
  };
  const onLoadEvent = vi.fn(async () => undefined);
  const repository = {
    listVehicleIdsInWorkshop: vi.fn(async () => new Set<string>()),
    listDriverRelationsByDriverIds: vi.fn(async () => [driverRelation]),
    listDriverIdsOnActiveLoads: vi.fn(async () => new Set<string>()),
    listDriverIdsWithApp: vi.fn(async () => new Set(['driver-1'])),
  } as unknown as LoadPostingRepository;
  const complianceService = {
    check: vi.fn(async () => ({
      vehicleId: 'vehicle-1',
      driverId: 'driver-1',
      driverName: 'Ramesh Yadav',
      vehicleChecked: true,
      driverChecked: true,
      failure: null,
      warnings: [],
      ...compliance,
    })),
  } as unknown as AssignmentComplianceService;
  const service = new LoadPostingService(
    {} as DataSource,
    repository,
    { findActiveByVehicles: vi.fn(async () => []) } as unknown as LoadRepository,
    {} as CodeSequenceRepository,
    {} as CustomerService,
    { getVehicle: vi.fn(async () => vehicle) } as unknown as VehicleService,
    {} as LoadActivityService,
    {} as AuditService,
    {} as LoadDispatchNotifier,
    {} as DriverAuthService,
    {} as NotificationsService,
    {} as TruckTypeService,
    complianceService,
    onLoadEvent,
  );
  return { service, onLoadEvent };
}

describe('Own-fleet post — driver licence checks', () => {
  it('LS_N_0017: an expired licence raises the blocked alert before the post is refused', async () => {
    // Expired on the driver's own record too — the licence check that also catches it must not
    // run first and swallow the alert.
    const { service, onLoadEvent } = setup(
      { failure: { subject: 'driver', docType: 'Driving licence', expiryDate: '2026-10-26' } },
      '2026-10-26',
    );

    await expect(
      service.post('tenant-1', 'user-1', 'org_admin', ownFleetPostInput),
    ).rejects.toThrow(/driving licence expired on 2026-10-26/);
    expect(onLoadEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'assignment_blocked',
        subject: 'driver',
        expiryDate: '2026-10-26',
        vehicleNumber: 'MH12AB1234',
      }),
    );
  });

  it('a licence class that does not cover the truck is still refused, without an alert', async () => {
    const { service, onLoadEvent } = setup({ failure: null });

    await expect(
      service.post('tenant-1', 'user-1', 'org_admin', ownFleetPostInput),
    ).rejects.toThrow(/can't drive this truck/);
    expect(onLoadEvent).not.toHaveBeenCalled();
  });
});
