import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./driver-licence-lookup-cache', () => ({
  getCachedLicenceLookup: vi.fn(async () => null),
  setCachedLicenceLookup: vi.fn(async () => undefined),
}));
vi.mock('../../adapters/idfy.client', async (importActual) => ({
  ...(await importActual<typeof import('../../adapters/idfy.client')>()),
  toBankVerificationColumns: vi.fn(() => ({ verificationStatus: 'pending' })),
}));

import { DriverService } from './driver.service';
import { AuthorizationError, ConflictError, NotFoundError } from '../../shared/errors';
import { MASTERS_WRITE } from '../../shared/constants/permissions';

const TENANT = 'tenant-b';
const DRIVER_ID = 'drv-1';
const dispatch = { role: 'dispatch', permissions: [MASTERS_WRITE] };

type Status = 'pending_staff_review' | 'pending_driver_review' | 'active' | 'rejected';
type Initiator = 'driver' | 'staff' | 'fleet_owner';

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: DRIVER_ID,
    fullName: 'Ravi Kumar',
    phoneNumber: '9999999999',
    licenseNumber: 'MH1220200001234',
    licenseVerified: false,
    dateOfBirth: '1990-01-01',
    addressLine1: 'Fleet A depot',
    salaryAmount: '22000.00',
    documents: [],
    verifications: [],
    bankDetails: [],
    ...overrides,
  };
}

function setup(status: Status, initiatedBy: Initiator, driverOverrides = {}) {
  const driver = profile(driverOverrides);
  const relation = {
    id: 'rel-1',
    tenantId: TENANT,
    driverId: DRIVER_ID,
    status,
    initiatedBy,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    note: null,
    driver,
  };
  const driverRepository = {
    findById: vi.fn(async () => driver),
    findByPhoneNumber: vi.fn(async () => driver),
    findByLicenseNumber: vi.fn(async () => null),
    update: vi.fn(async () => undefined),
    listDocuments: vi.fn(async () => []),
    findDocumentById: vi.fn(),
    softDeleteDocument: vi.fn(async () => undefined),
    createDocument: vi.fn(),
    findBankDetailsById: vi.fn(),
    softDeleteBankDetails: vi.fn(async () => undefined),
    findBankDetailsByAccount: vi.fn(async () => null),
    createBankDetails: vi.fn(),
    createVerification: vi.fn(),
    findOperationalStatus: vi.fn(async () => null),
    createOperationalStatus: vi.fn(async () => ({})),
  };
  const relationRepository = {
    findByTenantAndDriver: vi.fn(async () => relation),
    findByTenantAndDriverWithFullRelations: vi.fn(async () => relation),
    create: vi.fn(),
    update: vi.fn(async () => undefined),
  };
  const dataSource = { transaction: vi.fn(async (run: (m: unknown) => unknown) => run({})) };
  const idfyClient = { verifyBankAccount: vi.fn(async () => ({})) };
  const dlVerificationClient = {
    lookupDrivingLicence: vi.fn(async () => ({ status: 'verified', holderName: 'Ravi Kumar' })),
  };
  const service = new DriverService(
    driverRepository as never,
    relationRepository as never,
    dataSource as never,
    dlVerificationClient as never,
    { log: vi.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    idfyClient as never,
    {} as never,
    {} as never,
  );
  return { service, driverRepository, relationRepository, idfyClient, relation, driver };
}

describe('a pending link this fleet started (an invite the driver has not accepted)', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup('pending_driver_review', 'fleet_owner');
  });

  it('cannot edit the shared profile', async () => {
    await expect(
      ctx.service.updateDriver(TENANT, 'user-b', DRIVER_ID, { fullName: 'Someone Else' } as never),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(ctx.driverRepository.update).not.toHaveBeenCalled();
  });

  it('cannot delete documents or add/delete bank accounts', async () => {
    await expect(
      ctx.service.deleteDocument(TENANT, 'user-b', DRIVER_ID, 'doc-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      ctx.service.addBankDetails(TENANT, 'user-b', DRIVER_ID, {
        accountNumber: '1234567890',
        ifsc: 'HDFC0001234',
      } as never),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      ctx.service.deleteBankDetails(TENANT, 'user-b', DRIVER_ID, 'bank-1'),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(ctx.driverRepository.softDeleteDocument).not.toHaveBeenCalled();
    expect(ctx.idfyClient.verifyBankAccount).not.toHaveBeenCalled();
  });

  it('cannot read documents', async () => {
    await expect(ctx.service.listDocuments(TENANT, 'dispatch', DRIVER_ID)).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });

  it('sees only the limited view of the driver', async () => {
    const view = (await ctx.service.getDriver(TENANT, dispatch, DRIVER_ID)) as unknown as Record<
      string,
      unknown
    >;
    expect(view).toEqual({
      id: DRIVER_ID,
      driverTenantRelationId: 'rel-1',
      fullName: 'Ravi Kumar',
      phoneNumber: '9999999999',
      status: 'pending_driver_review',
      initiatedBy: 'fleet_owner',
      requestedAt: ctx.relation.createdAt,
      limited: true,
    });
  });
});

describe('a pending join request the driver started', () => {
  it('can be read in full but not edited', async () => {
    const ctx = setup('pending_staff_review', 'driver');
    await expect(ctx.service.listDocuments(TENANT, 'dispatch', DRIVER_ID)).resolves.toEqual([]);
    await expect(
      ctx.service.updateDriver(TENANT, 'user-b', DRIVER_ID, { bloodGroup: 'O+' } as never),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('an active link to a driver whose licence is verified', () => {
  it('cannot change identity fields', async () => {
    const ctx = setup('active', 'fleet_owner', { licenseVerified: true });
    for (const input of [{ fullName: 'Someone Else' }, { licenseNumber: 'KA0120190000001' }]) {
      await expect(
        ctx.service.updateDriver(TENANT, 'user-b', DRIVER_ID, input as never),
      ).rejects.toBeInstanceOf(ConflictError);
    }
    expect(ctx.driverRepository.update).not.toHaveBeenCalled();
  });

  it('can still change non-identity fields', async () => {
    const ctx = setup('active', 'fleet_owner', { licenseVerified: true });
    await ctx.service.updateDriver(TENANT, 'user-b', DRIVER_ID, { bloodGroup: 'O+' } as never);
    expect(ctx.driverRepository.update).toHaveBeenCalledWith(
      DRIVER_ID,
      expect.objectContaining({ bloodGroup: 'O+' }),
    );
  });
});

describe('documents and bank accounts on the shared profile', () => {
  it("cannot be deleted by a fleet that didn't add them", async () => {
    const ctx = setup('active', 'fleet_owner');
    ctx.driverRepository.findDocumentById.mockResolvedValue({ id: 'doc-1', tenantId: 'tenant-a' });
    ctx.driverRepository.findBankDetailsById.mockResolvedValue({ id: 'bank-1', tenantId: null });
    await expect(
      ctx.service.deleteDocument(TENANT, 'user-b', DRIVER_ID, 'doc-1'),
    ).rejects.toBeInstanceOf(AuthorizationError);
    await expect(
      ctx.service.deleteBankDetails(TENANT, 'user-b', DRIVER_ID, 'bank-1'),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(ctx.driverRepository.softDeleteDocument).not.toHaveBeenCalled();
    expect(ctx.driverRepository.softDeleteBankDetails).not.toHaveBeenCalled();
  });

  it('can be deleted by the fleet that added them', async () => {
    const ctx = setup('active', 'fleet_owner');
    ctx.driverRepository.findDocumentById.mockResolvedValue({ id: 'doc-1', tenantId: TENANT });
    await ctx.service.deleteDocument(TENANT, 'user-b', DRIVER_ID, 'doc-1');
    expect(ctx.driverRepository.softDeleteDocument).toHaveBeenCalledWith(
      DRIVER_ID,
      'doc-1',
      'user-b',
    );
  });
});

describe('onboarding a phone number that already has a profile', () => {
  it('creates only the link and writes nothing onto the existing profile', async () => {
    const ctx = setup('pending_staff_review', 'staff');
    // No link yet for this tenant; createDriver then inserts the pending one.
    ctx.relationRepository.findByTenantAndDriver.mockResolvedValueOnce(null as never);
    ctx.relationRepository.create.mockResolvedValue(ctx.relation);

    const result = (await ctx.service.onboardDriver(TENANT, 'user-b', dispatch, {
      phoneNumber: '9999999999',
      licenseNumber: 'MH1220200001234',
      dateOfBirth: '1990-01-01',
      documents: [{ documentType: 'driving_license_front', fileUrl: 'key-1' }],
      bankDetails: { accountNumber: '1234567890', ifsc: 'HDFC0001234' },
    } as never)) as unknown as Record<string, unknown>;

    expect(ctx.relationRepository.create).toHaveBeenCalled();
    expect(ctx.driverRepository.createDocument).not.toHaveBeenCalled();
    expect(ctx.driverRepository.createBankDetails).not.toHaveBeenCalled();
    expect(ctx.driverRepository.createVerification).not.toHaveBeenCalled();
    expect(ctx.driverRepository.update).not.toHaveBeenCalled();
    expect(result.profileReused).toBe(true);
    expect(result.limited).toBe(true);
    expect(result).not.toHaveProperty('dateOfBirth');
  });
});
