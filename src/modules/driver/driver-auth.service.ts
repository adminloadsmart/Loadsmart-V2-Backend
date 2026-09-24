import { randomBytes, randomUUID } from 'crypto';
import { env } from '../../config/env';
import {
  AuthenticationError,
  AuthorizationError,
  NotFoundError,
  ValidationError,
} from '../../shared/errors';
import { signToken, hashToken } from '../../shared/utils/token';
import { blockToken } from '../../shared/utils/token-blocklist';
import { normalizePhoneNumber } from '../../shared/utils/phone-number';
import { OtpService } from '../../shared/services/otp.service';
import { OrganizationService } from '../organization/organization.service';
import { isTenantAccessible } from '../organization/organization.constants';
import { DriverRepository } from './driver.repository';
import { DriverTenantRelationRepository } from './driver-tenant-relation.repository';
import { DriverSessionRepository } from './driver-auth.repository';
import { DriverEntity } from './entities/driver.entity';
import { DriverTenantRelationEntity } from './entities/driver-tenant-relation.entity';
import {
  DriverDeviceCaptureInput,
  DriverDevicePlatform,
  DriverLoginCandidate,
  DriverLogoutInput,
  DriverRefreshInput,
  RequestDriverOtpInput,
  SelectDriverRelationInput,
  SelectDriverTenantInput,
  VerifyDriverOtpInput,
} from './driver-auth.types';

// A deliberately separate identity domain from modules/auth/'s AuthService — see
// docs/driver-auth.md for why (drivers get no auth.users row, no role/permissions, phone+OTP
// only). Mirrors auth.service.ts's session-issuance shape (issueTokenPair, refresh, logout,
// device-token) but built on masters.driver_sessions instead of auth.refresh_tokens, and shares
// only the phone-verification primitive (OtpService) with the staff/org flow, nothing else.
//
// A driver profile is global (masters.drivers has no tenantId), so login resolves in two steps:
// find the one driver profile by phone, then resolve which of their `active`
// driver_tenant_relations to sign into (0 -> identity-scoped session, 1 -> straight to a
// tenant-scoped session, >1 -> tenant-selection token, same UX as before).
export class DriverAuthService {
  constructor(
    private readonly driverRepository: DriverRepository,
    private readonly driverTenantRelationRepository: DriverTenantRelationRepository,
    private readonly driverSessionRepository: DriverSessionRepository,
    private readonly organizationService: OrganizationService,
    private readonly otpService: OtpService,
  ) {}

  async requestOtp(input: RequestDriverOtpInput) {
    const phoneNumber = this.normalizePhone(input.phoneNumber);

    // Same non-enumeration-hiding posture as auth.service.ts's requestLoginOtp: a phone with no
    // registered driver gets a generic rejection here rather than silently "succeeding" with no
    // OTP sent.
    const driver = await this.driverRepository.findByPhoneNumber(phoneNumber);
    if (!driver) {
      throw new AuthenticationError('Driver is not registered');
    }

    await this.otpService.requestOtpCode({
      phoneNumber,
      purpose: 'driver-login',
      cooldownSeconds: env.driverLoginOtpResendCooldownSeconds,
    });

    const loginToken = signToken(
      { phoneNumber, driverId: driver.id, purpose: 'driver-login-otp' },
      env.driverLoginOtpTtlSeconds,
    );

    return {
      loginToken,
      expiresIn: env.driverLoginOtpTtlSeconds,
      message: `OTP sent to ${phoneNumber}`,
    };
  }

  async verifyOtp(input: VerifyDriverOtpInput) {
    const { phoneNumber, otp, driverId } = input;

    await this.otpService.verifyOtpCode({
      phoneNumber,
      otp,
      purpose: 'driver-login',
      ttlSeconds: env.driverLoginOtpTtlSeconds,
      invalidOtpMessage: 'Invalid OTP',
      tooManyAttemptsMessage: 'Too many incorrect attempts, please request a new login OTP',
    });

    const driver = await this.driverRepository.findById(driverId);
    if (!driver) throw new AuthenticationError('Driver is not registered');

    const activeRelations = await this.driverTenantRelationRepository.listActiveByDriver(driverId);

    if (activeRelations.length === 0) {
      const tokens = await this.issueDriverTokenPair(driver.id, null, null, input);
      return { ...tokens, driver: this.toDriverSummary(driver) };
    }

    if (activeRelations.length === 1) {
      return this.issueSessionForRelation(driver, activeRelations[0], input);
    }

    // >1 tenant relation is active — the OTP is now proven, but which one logs in still needs a
    // choice. One more short-lived token instead of a second OTP round-trip (MSG91 OTPs are
    // per-phone, not per-tenant — re-sending wouldn't disambiguate anything). See docs/driver-auth.md.
    const candidates: DriverLoginCandidate[] = activeRelations.map((relation) => ({
      tenantId: relation.tenantId,
      driverTenantRelationId: relation.id,
    }));
    const tenantSelectionToken = signToken(
      { purpose: 'driver-tenant-select', driverId, candidates },
      env.driverTenantSelectTtlSeconds,
    );
    return {
      requiresTenantSelection: true as const,
      candidates: await this.describeCandidates(candidates),
      tenantSelectionToken,
      expiresIn: env.driverTenantSelectTtlSeconds,
    };
  }

  async selectTenant(input: SelectDriverTenantInput) {
    const match = input.candidates.find((candidate) => candidate.tenantId === input.tenantId);
    if (!match) {
      throw new AuthenticationError('Invalid tenant selection');
    }
    const driver = await this.driverRepository.findById(input.driverId);
    if (!driver) throw new AuthenticationError('Driver is not registered');

    const relation = await this.driverTenantRelationRepository.findById(
      input.tenantId,
      match.driverTenantRelationId,
    );
    if (!relation || relation.status !== 'active') {
      throw new AuthenticationError('Invalid tenant selection');
    }

    return this.issueSessionForRelation(driver, relation, input);
  }

  /** Switches an already-authenticated driver's active tenant context mid-session — e.g. right
   * after accepting an invite — without repeating the OTP dance. */
  async selectRelation(input: SelectDriverRelationInput) {
    const driver = await this.driverRepository.findById(input.driverId);
    if (!driver) throw new AuthenticationError('Driver is not registered');

    const relation = await this.driverTenantRelationRepository.findByIdForDriver(
      input.driverId,
      input.relationId,
    );
    if (!relation || relation.status !== 'active') {
      throw new NotFoundError('Driver tenant relation not found');
    }

    return this.issueSessionForRelation(driver, relation, input.device);
  }

  async refresh(input: DriverRefreshInput) {
    const tokenHash = hashToken(input.refreshToken);
    const stored = await this.driverSessionRepository.claimRefreshToken(tokenHash);
    if (!stored) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    const driver = await this.driverRepository.findById(stored.driverId);
    if (!driver) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    let relation: DriverTenantRelationEntity | null = null;
    if (stored.tenantId) {
      relation = await this.driverTenantRelationRepository.findByTenantAndDriver(
        stored.tenantId,
        driver.id,
      );
      if (!relation || relation.status !== 'active') {
        throw new AuthenticationError('Invalid or expired refresh token');
      }
      await this.assertOrganizationActiveForLogin(stored.tenantId);
    }

    // Carries the old row's device/push data forward onto the new row this creates — same
    // convention as auth.service.ts's refresh/buildAuthSession.
    const tokens = await this.issueDriverTokenPair(
      driver.id,
      relation?.tenantId ?? null,
      relation?.id ?? null,
      {
        fcmToken: stored.fcmToken ?? undefined,
        deviceType: stored.deviceType ?? undefined,
        deviceInfo: stored.deviceInfo ?? undefined,
        ipAddress: stored.ipAddress,
      },
    );

    return { ...tokens, driver: this.toDriverSummary(driver) };
  }

  // Keyed by the caller's own `sid` claim — a verified JWT claim, never client-suppliable — same
  // convention as auth.service.ts's logout.
  async logout(input: DriverLogoutInput) {
    const { sid, jti, exp } = input;
    if (sid) {
      await this.driverSessionRepository.revokeSession(sid);
    }
    await blockToken(jti, exp);
  }

  async updateDeviceToken(sid: string, fcmToken: string, deviceType: DriverDevicePlatform) {
    const updated = await this.driverSessionRepository.updateSessionDeviceInfo(sid, {
      fcmToken,
      deviceType,
    });
    if (!updated) throw new NotFoundError('No active session found');
  }

  // Consumed by push-notification producers (e.g. dispatch-planning.service.ts when a load gets
  // assigned to a driver) — same "consumer takes producer service directly" pattern as
  // AuthService.getActiveDeviceTokensForUser. See docs/driver-auth.md.
  async getActiveDeviceTokensForDriver(driverId: string) {
    return this.driverSessionRepository.findActiveByDriverId(driverId);
  }

  /** Issues an identity-scoped session (no tenant context) right after self-registration — see
   * driver-identity.service.ts's registerSelf. */
  async issueIdentitySession(driverId: string, device?: DriverDeviceCaptureInput) {
    return this.issueDriverTokenPair(driverId, null, null, device);
  }

  private async issueSessionForRelation(
    driver: DriverEntity,
    relation: DriverTenantRelationEntity,
    device?: DriverDeviceCaptureInput,
  ) {
    await this.assertOrganizationActiveForLogin(relation.tenantId);
    const tokens = await this.issueDriverTokenPair(
      driver.id,
      relation.tenantId,
      relation.id,
      device,
    );
    return { ...tokens, driver: this.toDriverSummary(driver) };
  }

  private toDriverSummary(driver: { id: string; fullName: string; phoneNumber: string }) {
    return { id: driver.id, fullName: driver.fullName, phoneNumber: driver.phoneNumber };
  }

  private async describeCandidates(candidates: DriverLoginCandidate[]) {
    return Promise.all(
      candidates.map(async (candidate) => {
        const organization = await this.organizationService.getOrganizationStatus(
          candidate.tenantId,
        );
        return { tenantId: candidate.tenantId, tenantName: organization.name };
      }),
    );
  }

  // A rejected/suspended org locks its drivers out of the app the same way it already locks out
  // its staff/org users — see auth.service.ts's assertOrganizationActiveForLogin.
  private async assertOrganizationActiveForLogin(tenantId: string): Promise<void> {
    const organization = await this.organizationService.getOrganizationStatus(tenantId);
    if (!isTenantAccessible(organization.status)) {
      throw new AuthorizationError('Organization access is not available');
    }
  }

  private async issueDriverTokenPair(
    driverId: string,
    tenantId: string | null,
    driverTenantRelationId: string | null,
    device?: DriverDeviceCaptureInput,
  ) {
    // Created before the access token is signed, deliberately — issuing it needs this row's own
    // id for the access token's `sid` claim. Same convention as auth.service.ts's issueTokenPair.
    const rawRefreshToken = randomBytes(40).toString('hex');
    const session = await this.driverSessionRepository.createSession({
      driverId,
      tenantId,
      driverTenantRelationId,
      tokenHash: hashToken(rawRefreshToken),
      expiresAt: new Date(Date.now() + env.driverRefreshTokenTtlMs),
      fcmToken: device?.fcmToken,
      deviceType: device?.deviceType,
      deviceInfo: device?.deviceInfo,
      ipAddress: device?.ipAddress,
    });

    const jti = randomUUID();
    // Deliberately no `role`/`permissions`/`permissionsVersion` claim — see docs/driver-auth.md.
    // A driver token can never satisfy requirePermission(...) or be mistaken for a staff
    // AuthenticatedUser by construction, not by convention.
    const accessToken = signToken(
      {
        id: driverId,
        tenantId: tenantId ?? undefined,
        driverTenantRelationId: driverTenantRelationId ?? undefined,
        jti,
        sid: session.id,
        purpose: tenantId ? 'driver-access' : 'driver-identity-access',
      },
      env.driverAccessTokenTtlSeconds,
    );

    return { accessToken, refreshToken: rawRefreshToken };
  }

  private normalizePhone(phoneNumber: string): string {
    const normalized = normalizePhoneNumber(phoneNumber);
    if (!normalized) {
      throw new ValidationError('phoneNumber is invalid');
    }
    return normalized;
  }
}
