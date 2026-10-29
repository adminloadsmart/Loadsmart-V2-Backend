import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../shared/utils/token', () => ({
  signToken: vi.fn(() => 'signed-token'),
  hashToken: vi.fn((raw: string) => `hash:${raw}`),
}));
vi.mock('../../../shared/utils/token-blocklist', () => ({ blockToken: vi.fn(async () => {}) }));

import { DriverAuthService } from './driver-auth.service';
import { blockToken } from '../../../shared/utils/token-blocklist';
import { signToken } from '../../../shared/utils/token';
import { DriverRepository } from '../driver.repository';
import { DriverTenantRelationRepository } from '../driver-tenant-relation.repository';
import { DriverSessionRepository } from './driver-auth.repository';
import { OrganizationService } from '../../organization/organization.service';
import { OtpService } from '../../../shared/services/otp.service';
import { RevokedDriverSessionToken } from './driver-auth.types';

const DRIVER = {
  id: 'driver-1',
  fullName: 'Ramesh',
  phoneNumber: '9999999999',
  onboardingStep: null,
};
const RELATION = { id: 'rel-1', tenantId: 'tenant-1', status: 'active' };

const OLD_EXPIRY = new Date(Date.now() + 10 * 60 * 1000);

function build(
  activeRelations: (typeof RELATION)[] = [RELATION],
  revokedSessions: RevokedDriverSessionToken[] = [],
) {
  const calls: string[] = [];
  const sessions = {
    revokeAllForDriver: vi.fn(async () => {
      calls.push('revokeAll');
      return revokedSessions;
    }),
    createSession: vi.fn(async (_data: { accessJti?: string | null }) => {
      calls.push('create');
      return { id: 'session-new' };
    }),
    claimRefreshToken: vi.fn(async () => ({
      driverId: DRIVER.id,
      tenantId: RELATION.tenantId,
      fcmToken: 'tokA',
      deviceType: 'android',
      deviceInfo: null,
      ipAddress: null,
    })),
  };
  const drivers = { findById: vi.fn(async () => DRIVER) };
  const relations = {
    listActiveByDriver: vi.fn(async () => activeRelations),
    findById: vi.fn(async () => RELATION),
    findByIdForDriver: vi.fn(async () => RELATION),
    findByTenantAndDriver: vi.fn(async () => RELATION),
  };
  const organizations = {
    getOrganizationStatus: vi.fn(async () => ({ status: 'active', name: 'Genboot' })),
  };
  const service = new DriverAuthService(
    drivers as unknown as DriverRepository,
    relations as unknown as DriverTenantRelationRepository,
    sessions as unknown as DriverSessionRepository,
    organizations as unknown as OrganizationService,
    { requestOtpCode: vi.fn(), verifyOtpCode: vi.fn() } as unknown as OtpService,
  );
  return { service, sessions, calls };
}

const LOGIN = { phoneNumber: '9999999999', otp: '1234', driverId: DRIVER.id, fcmToken: 'tokB' };

describe('DriverAuthService — one login per driver', () => {
  beforeEach(() => vi.clearAllMocks());

  it('OTP login closes every older session before creating the new one', async () => {
    const { service, sessions, calls } = build();
    await service.verifyOtp(LOGIN);

    expect(sessions.revokeAllForDriver).toHaveBeenCalledWith(DRIVER.id);
    expect(calls).toEqual(['revokeAll', 'create']);
  });

  it('also applies to a driver with no organisation yet (identity session)', async () => {
    const { service, calls } = build([]);
    await service.verifyOtp(LOGIN);

    expect(calls).toEqual(['revokeAll', 'create']);
  });

  it.each([
    ['no relation', []],
    ['one relation', [RELATION]],
    ['several relations', [RELATION, { ...RELATION, id: 'rel-2', tenantId: 'tenant-2' }]],
  ])('OTP login returns an identity-scoped token pair with %s', async (_label, relations) => {
    const { service } = build(relations);
    const result = await service.verifyOtp(LOGIN);

    expect(result).toMatchObject({ accessToken: 'signed-token', refreshToken: expect.any(String) });
    expect(result).not.toHaveProperty('tenantSelectionToken');
    expect((result as { tenants: unknown[] }).tenants).toHaveLength(relations.length);
    const claims = vi.mocked(signToken).mock.calls.at(-1)![0] as {
      purpose: string;
      tenantId?: string;
    };
    expect(claims.purpose).toBe('driver-identity-access');
    expect(claims.tenantId).toBeUndefined();
  });

  it('picking an organisation after OTP closes older sessions', async () => {
    const { service, calls } = build();
    await service.selectTenant({
      driverId: DRIVER.id,
      tenantId: RELATION.tenantId,
      candidates: [{ tenantId: RELATION.tenantId, driverTenantRelationId: RELATION.id }],
    } as never);

    expect(calls).toEqual(['revokeAll', 'create']);
  });

  it('switching organisation mid-session closes older sessions', async () => {
    const { service, calls } = build();
    await service.selectRelation({ driverId: DRIVER.id, relationId: RELATION.id } as never);

    expect(calls).toEqual(['revokeAll', 'create']);
  });

  it('self-registration closes older sessions', async () => {
    const { service, calls } = build();
    await service.issueIdentitySession(DRIVER.id);

    expect(calls).toEqual(['revokeAll', 'create']);
  });

  it('token refresh does NOT close other sessions — it only replaces its own', async () => {
    const { service, sessions } = build();
    await service.refresh({ refreshToken: 'raw-refresh' });

    expect(sessions.revokeAllForDriver).not.toHaveBeenCalled();
    expect(sessions.createSession).toHaveBeenCalledTimes(1);
    expect(blockToken).not.toHaveBeenCalled();
  });

  it("a new login blocklists the closed sessions' access tokens at once", async () => {
    const { service } = build(
      [RELATION],
      [
        { accessJti: 'jti-redmi', accessExpiresAt: OLD_EXPIRY },
        // A session from before access_jti existed — nothing to block.
        { accessJti: null, accessExpiresAt: null },
      ],
    );
    await service.verifyOtp(LOGIN);

    expect(blockToken).toHaveBeenCalledWith('jti-redmi', Math.ceil(OLD_EXPIRY.getTime() / 1000));
    expect(blockToken).toHaveBeenCalledWith(undefined, undefined);
  });

  it('stores the same jti on the session that is signed into the access token', async () => {
    const { service, sessions } = build();
    await service.verifyOtp(LOGIN);

    const stored = sessions.createSession.mock.calls[0][0].accessJti;
    const signedClaims = vi.mocked(signToken).mock.calls.at(-1)![0] as { jti: string };
    expect(stored).toBeTruthy();
    expect(signedClaims.jti).toBe(stored);
  });
});
