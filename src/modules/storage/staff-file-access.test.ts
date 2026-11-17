import { describe, expect, it } from 'vitest';
import { staffMayRead } from './storage.service';
import type { FileEntity } from './entities/file.entity';
import type { FileAccessActor } from './storage.types';
import { ROLES } from '../../db/role-catalog';

const file = (purpose: string, uploadedBy = 'someone-else') =>
  ({ id: 'f-1', tenantId: 'tenant-a', purpose, uploadedBy }) as unknown as FileEntity;

// Each staff role's real seeded bundle.
const staff = (role: string, userId = 'staff-1'): FileAccessActor => ({
  tenantId: null,
  role,
  userId,
  permissions: ROLES.find((r) => r.name === role)!.permissionKeys,
});

describe('staffMayRead (a tenant-less staff caller reading another tenant’s file)', () => {
  it('lets platform_admin read anything', () => {
    for (const purpose of ['kyc', 'loads/invoice', 'masters/driver']) {
      expect(staffMayRead(staff('platform_admin'), file(purpose))).not.toBeNull();
    }
  });

  it('lets the KYC reviewer teams (Approval, Admin) read onboarding documents', () => {
    for (const role of ['ls_approval', 'ls_admin']) {
      expect(staffMayRead(staff(role), file('kyc'))).not.toBeNull();
      expect(staffMayRead(staff(role), file('organizations/shopboard-premises'))).not.toBeNull();
      expect(staffMayRead(staff(role), file('masters/driver'))).toBeNull();
    }
  });

  it('lets every ops team read load and trip files, but only reviewers read KYC', () => {
    for (const role of ['ls_admin', 'ls_approval', 'ls_placement', 'ls_tracking', 'ls_payables']) {
      expect(staffMayRead(staff(role), file('trips/pod'))).not.toBeNull();
      expect(staffMayRead(staff(role), file('loads/payment-proof'))).not.toBeNull();
    }
    for (const role of ['ls_placement', 'ls_tracking', 'ls_cs', 'ls_receivables', 'ls_payables']) {
      expect(staffMayRead(staff(role), file('kyc'))).toBeNull();
    }
  });

  it('lets sales read only what it uploaded', () => {
    expect(staffMayRead(staff('sales', 'sales-1'), file('kyc', 'sales-1'))).not.toBeNull();
    expect(staffMayRead(staff('sales', 'sales-1'), file('kyc'))).toBeNull();
    expect(staffMayRead(staff('sales', 'sales-1'), file('loads/invoice'))).toBeNull();
  });

  it('reads nothing of another tenant without identity details', () => {
    expect(staffMayRead({ tenantId: null, role: 'sales' }, file('kyc'))).toBeNull();
  });

  it('passes a miss through as a miss', () => {
    expect(staffMayRead(staff('platform_admin'), null)).toBeNull();
  });
});
