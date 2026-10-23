import { describe, expect, it, vi } from 'vitest';
import type { TrackingClient } from '../../adapters/tracking.client';
import type { DriverLicenseEndorsement } from '../driver/drivers.types';
import { NOTIFICATION_CATALOG } from './catalog/notification-catalog';
import { licenceMismatchOf } from './licence-check';
import type { LoadAlertRepository } from './load-alert.repository';
import { createLoadAlertResolvers } from './load-alerts';
import type { LicenceCheckRow, LoadAlertSnapshot } from './notifications.interface';

const base = {
  licenceClass: 'LMV, HGMV',
  endorsements: [] as DriverLicenseEndorsement[],
  grossVehicleWeightKg: 25000,
  hazardousProducts: [] as string[],
};

describe('licenceMismatchOf', () => {
  it('a heavy truck needs a transport class; an LMV covers up to 7,500 kg', () => {
    expect(licenceMismatchOf(base)).toBeNull();
    expect(licenceMismatchOf({ ...base, licenceClass: 'LMV, MCWG' })).toEqual({
      needsTransportClass: true,
      needsHazmatEndorsement: false,
    });
    expect(
      licenceMismatchOf({ ...base, licenceClass: 'LMV', grossVehicleWeightKg: 7500 }),
    ).toBeNull();
    // Old and new transport codes both count.
    for (const licenceClass of ['TRANS', 'MGV', 'HMV', 'HTV', 'HPMV', 'LMV-TR, HGMV']) {
      expect(licenceMismatchOf({ ...base, licenceClass })).toBeNull();
    }
  });

  it('hazardous cargo needs the hazmat endorsement, whatever the weight', () => {
    const hazardous = { ...base, hazardousProducts: ['Diesel'] };
    expect(licenceMismatchOf(hazardous)).toEqual({
      needsTransportClass: false,
      needsHazmatEndorsement: true,
    });
    expect(licenceMismatchOf({ ...hazardous, endorsements: ['hazmat'] })).toBeNull();
  });

  it("skips the class check when it can't tell — no class or no weight on file", () => {
    expect(licenceMismatchOf({ ...base, licenceClass: null })).toBeNull();
    expect(
      licenceMismatchOf({ ...base, licenceClass: 'LMV', grossVehicleWeightKg: null }),
    ).toBeNull();
  });
});

describe('LS_N_0050 licence class does not match the vehicle', () => {
  const check: LicenceCheckRow = {
    driverId: 'driver-1',
    driverName: 'Ramesh Yadav',
    endorsements: [],
    licenceClass: 'LMV, MCWG',
    vehicleNo: 'MH12AB1234',
    grossVehicleWeightKg: 25000,
    hazardousProducts: [],
  };

  function setup(overrides: Partial<LicenceCheckRow> | null = {}) {
    const repository = {
      findLicenceCheck: vi.fn(async () => (overrides === null ? null : { ...check, ...overrides })),
      findSnapshot: vi.fn(
        async () => ({ code: 'LD-1001', vehicleNumber: 'MH12AB1234' }) as LoadAlertSnapshot,
      ),
    } as unknown as LoadAlertRepository;
    return createLoadAlertResolvers(repository, vi.fn(), {} as TrackingClient, {
      list: async () => [],
    });
  }
  const context = { loadId: 'load-1', assignedAt: '2026-10-22T08:00:00.000Z' };
  const build = NOTIFICATION_CATALOG['load.licence_mismatch'].buildContent;

  it('names the class held and the class the vehicle needs', async () => {
    const resolved = (await setup().licenceMismatch('tenant-1', context))!;
    const content = build(resolved);
    expect(content.title).toBe('Ramesh Yadav is not licensed for MH12AB1234');
    expect(content.body).toBe(
      'Ramesh Yadav holds LMV, MCWG and MH12AB1234 needs a transport licence (it is over 7,500 kg). Assign a driver with the right class before the vehicle moves.',
    );
    expect(content.metadata).toMatchObject({
      cta_label: 'Change driver',
      cta_path: '/loads/load-1',
    });
  });

  it('a missing hazardous goods endorsement', async () => {
    const resolved = (await setup({
      licenceClass: 'HGMV',
      hazardousProducts: ['Diesel'],
    }).licenceMismatch('tenant-1', context))!;
    expect(build(resolved).body).toBe(
      'Ramesh Yadav has no hazardous goods endorsement and MH12AB1234 is carrying Diesel. Assign a driver with the right class before the vehicle moves.',
    );
  });

  it('both at once', async () => {
    const resolved = (await setup({ hazardousProducts: ['Diesel'] }).licenceMismatch(
      'tenant-1',
      context,
    ))!;
    expect(build(resolved).body).toBe(
      'Ramesh Yadav holds LMV, MCWG with no hazardous goods endorsement and MH12AB1234 needs a transport licence (it is over 7,500 kg) and a hazardous goods endorsement for Diesel. Assign a driver with the right class before the vehicle moves.',
    );
  });

  it('nothing for a driver not in the masters, or a licence that covers the trip', async () => {
    expect(await setup({ driverId: null }).licenceMismatch('tenant-1', context)).toBeNull();
    expect(await setup({ licenceClass: 'HTV' }).licenceMismatch('tenant-1', context)).toBeNull();
    expect(await setup(null).licenceMismatch('tenant-1', context)).toBeNull();
  });
});
