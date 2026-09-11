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
import { DriverSessionRepository } from './driver-auth.repository';
import {
  DriverDeviceCaptureInput,
  DriverDevicePlatform,
  DriverLoginCandidate,
  DriverLogoutInput,
  DriverRefreshInput,
  RequestDriverOtpInput,
  SelectDriverTenantInput,
  VerifyDriverOtpInput,
} from './driver-auth.types';

// A deliberately separate identity domain from modules/auth/'s AuthService — see
// docs/driver-auth.md for why (drivers get no auth.users row, no role/permissions, phone+OTP
// only). Mirrors auth.service.ts's session-issuance shape (issueTokenPair, refresh, logout,
// device-token) but built on masters.driver_sessions instead of auth.refresh_tokens, and shares
// only the phone-verification primitive (OtpService) with the staff/org flow, nothing else.
export class DriverAuthService {
  constructor(
    private readonly driverRepository: DriverRepository,
    private readonly driverSessionRepository: DriverSessionRepository,
    private readonly organizationService: OrganizationService,
    private readonly otpService: OtpService,
  ) {}

  async requestOtp(input: RequestDriverOtpInput) {
    const phoneNumber = this.normalizePhone(input.phoneNumber);

    // masters.drivers' phone uniqueness is only per-tenant (drivers_tenant_phone_number_active_
    // unique) — the same phone can legitimately be an active driver in more than one tenant. All
    // matches ride along in the signed token below; /otp/verify resolves 0/1/many. Same
    // non-enumeration-hiding posture as auth.service.ts's requestLoginOtp: a phone with zero
    // matches gets a generic rejection here rather than silently "succeeding" with no OTP sent.
    const candidates = await this.driverRepository.findActiveDriversByPhone(phoneNumber);
    if (candidates.length === 0) {
      throw new AuthenticationError('Driver is not registered');
    }

    await this.otpService.requestOtpCode({
      phoneNumber,
      purpose: 'driver-login',
      cooldownSeconds: env.driverLoginOtpResendCooldownSeconds,
    });

    const loginToken = signToken(
      {
        phoneNumber,
        purpose: 'driver-login-otp',
        candidates: candidates.map((driver): DriverLoginCandidate => ({
          driverId: driver.id,
          tenantId: driver.tenantId,
        })),
      },
      env.driverLoginOtpTtlSeconds,
    );

    return {
      loginToken,
      expiresIn: env.driverLoginOtpTtlSeconds,
      message: `OTP sent to ${phoneNumber}`,
    };
  }

  async verifyOtp(input: VerifyDriverOtpInput) {
    const { phoneNumber, otp, candidates } = input;

    await this.otpService.verifyOtpCode({
      phoneNumber,
      otp,
      purpose: 'driver-login',
      ttlSeconds: env.driverLoginOtpTtlSeconds,
      invalidOtpMessage: 'Invalid OTP',
      tooManyAttemptsMessage: 'Too many incorrect attempts, please request a new login OTP',
    });

    // >1 tenant matched this phone at /otp/request — the OTP is now proven, but which driver
    // record logs in still needs a choice. One more short-lived token instead of a second OTP
    // round-trip (MSG91 OTPs are per-phone, not per-tenant — re-sending wouldn't disambiguate
    // anything). See docs/driver-auth.md.
    if (candidates.length > 1) {
      const tenantSelectionToken = signToken(
        { purpose: 'driver-tenant-select', candidates },
        env.driverTenantSelectTtlSeconds,
      );
      return {
        requiresTenantSelection: true as const,
        candidates: await this.describeCandidates(candidates),
        tenantSelectionToken,
        expiresIn: env.driverTenantSelectTtlSeconds,
      };
    }

    return this.issueSessionForCandidate(candidates[0], input);
  }

  async selectTenant(input: SelectDriverTenantInput) {
    const match = input.candidates.find((candidate) => candidate.tenantId === input.tenantId);
    if (!match) {
      throw new AuthenticationError('Invalid tenant selection');
    }
    return this.issueSessionForCandidate(match, input);
  }

  async refresh(input: DriverRefreshInput) {
    const tokenHash = hashToken(input.refreshToken);
    const stored = await this.driverSessionRepository.claimRefreshToken(tokenHash);
    if (!stored) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    // Not tenant-scoped yet at this point — the session row only carries driverId. See
    // driver.repository.ts's findByIdAnyTenant.
    const driver = await this.driverRepository.findByIdAnyTenant(stored.driverId);
    if (!driver || driver.status !== 'active') {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    await this.assertOrganizationActiveForLogin(driver.tenantId);

    // Carries the old row's device/push data forward onto the new row this creates — same
    // convention as auth.service.ts's refresh/buildAuthSession.
    const tokens = await this.issueDriverTokenPair(driver.id, driver.tenantId, {
      fcmToken: stored.fcmToken ?? undefined,
      deviceType: stored.deviceType ?? undefined,
      deviceInfo: stored.deviceInfo ?? undefined,
      ipAddress: stored.ipAddress,
    });

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

  private async issueSessionForCandidate(
    candidate: DriverLoginCandidate,
    device?: DriverDeviceCaptureInput,
  ) {
    await this.assertOrganizationActiveForLogin(candidate.tenantId);

    const driver = await this.driverRepository.findById(candidate.tenantId, candidate.driverId);
    if (!driver || driver.status !== 'active') {
      throw new AuthenticationError('Driver is not active');
    }

    const tokens = await this.issueDriverTokenPair(driver.id, driver.tenantId, device);
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
  // its staff/org users — see auth.service.ts's assertOrganizationActiveForLogin. Unlike that
  // one, there's no "no tenantId yet" branch: DriverEntity.tenantId is NOT NULL, a driver always
  // belongs to exactly one org by the time they can log in at all.
  private async assertOrganizationActiveForLogin(tenantId: string): Promise<void> {
    const organization = await this.organizationService.getOrganizationStatus(tenantId);
    if (!isTenantAccessible(organization.status)) {
      throw new AuthorizationError('Organization access is not available');
    }
  }

  private async issueDriverTokenPair(
    driverId: string,
    tenantId: string,
    device?: DriverDeviceCaptureInput,
  ) {
    // Created before the access token is signed, deliberately — issuing it needs this row's own
    // id for the access token's `sid` claim. Same convention as auth.service.ts's issueTokenPair.
    const rawRefreshToken = randomBytes(40).toString('hex');
    const session = await this.driverSessionRepository.createSession({
      driverId,
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
      { id: driverId, tenantId, jti, sid: session.id, purpose: 'driver-access' },
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
