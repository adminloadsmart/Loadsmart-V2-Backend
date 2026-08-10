import { randomBytes, randomUUID } from 'crypto';
import { DataSource } from 'typeorm';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  RateLimitError,
  ValidationError,
} from '../../shared/errors';
import { AuthenticatedUser } from '../../shared/middleware/request.types';
import { signToken, hashToken } from '../../shared/utils/token';
import { blockToken } from '../../shared/utils/token-blocklist';
import { invalidateUserExistsCache } from '../../shared/utils/user-existence-cache';
import { normalizePhoneNumber } from '../../shared/utils/phone-number';
import { OrganizationService } from '../organization/organization.service';
import { OrganizationDocumentService } from '../organization/organization-document.service';
import { OrganizationOnboardingService } from '../organization/organization-onboarding.service';
import { OrganizationJourneyStageService } from '../organization/organization-journey-stage.service';
import { isTenantAccessible } from '../organization/organization.constants';
import { AuthRepository } from './auth.repository';
import { ReferralCodeService } from '../organization/referral-code.service';
import { RoleService } from '../roles/role.service';
import { AuditService } from '../audit/audit.service';
import { redisManager } from '../../db/redis';
import {
  LOGIN_ATTEMPT_WINDOW_MS,
  MAX_FAILED_ATTEMPTS,
  MAX_OTP_ATTEMPTS,
  SIGNUP_RESEND_COOLDOWN_SECONDS,
  SIGNUP_STATIC_OTP,
  DUMMY_PASSWORD_HASH,
} from './auth.constants';
import { ORG_ADMIN_ROLE, STAFF_ASSIGNABLE_ROLES } from '../../shared/constants/roles';
import {
  SignupInput,
  RequestLoginOtpInput,
  VerifyOtpInput,
  VerifyLoginOtpInput,
  CreateStaffInput,
  LoginInput,
  RefreshInput,
  LogoutInput,
  CreatePasswordInput,
} from './auth.types';
import {
  SaveCompanyDetailsInput,
  SaveBusinessDetailsInput,
  SubmitOrganizationInput,
  OnboardingStatus,
  OnboardingStep,
  OrganizationOnboardingProgress,
} from '../organization/organization.types';
import { UserEntity } from './entities/user.entity';

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  role: string;
  permissions: string[];
  user: {
    id: string;
    phoneNumber: string;
    hasPassword: boolean;
  };
  onboardingStatus: OnboardingStatus;
  onboardingStep: OnboardingStep;
  nextStep: OnboardingStep;
};

export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly organizationService: OrganizationService,
    private readonly organizationDocumentService: OrganizationDocumentService,
    private readonly organizationOnboardingService: OrganizationOnboardingService,
    private readonly organizationJourneyStageService: OrganizationJourneyStageService,
    private readonly referralCodeService: ReferralCodeService,
    private readonly roleService: RoleService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) {}

  async signup(input: SignupInput) {
    const { phoneNumber } = input;

    const existing = await this.authRepository.findUserByPhone(phoneNumber);
    if (existing) {
      throw new ConflictError('A user with this phone number already exists');
    }

    // Independent of the OTP's own TTL — without this, repeat calls for the same phone number
    // each overwrite the OTP and (once real SMS delivery is wired up, see SIGNUP_STATIC_OTP)
    // resend an SMS with no cooldown, an SMS-bombing vector even within a single OTP's validity window.
    const cooldownKey = `signup:${phoneNumber}:cooldown`;
    if (await redisManager.get(cooldownKey)) {
      throw new RateLimitError('Please wait before requesting another OTP');
    }
    await redisManager.set(cooldownKey, '1', SIGNUP_RESEND_COOLDOWN_SECONDS);

    // const otp = randomInt(100000, 1000000).toString();
    const otp = SIGNUP_STATIC_OTP;
    await redisManager.set(
      `signup:${phoneNumber}`,
      JSON.stringify({ phoneNumber, otp }),
      env.signupOtpTtlSeconds,
    );
    // A fresh OTP always gets a fresh guess budget — otherwise a stale counter from a previous
    // OTP cycle would unfairly shrink this one's.
    await redisManager.delete(`signup:${phoneNumber}:attempts`);
    //  if (env.nodeEnv !== 'production') {
    //     console.log(`OTP for ${phoneNumber}: ${otp}`); // TODO: replace with real SMS/email delivery once notifications module is wired up
    //   }
    const signupToken = signToken({ phoneNumber, purpose: 'signup' }, env.signupOtpTtlSeconds);

    return {
      signupToken,
      expiresIn: env.signupOtpTtlSeconds,
      message: `OTP sent to ${phoneNumber}`,
    };
  }

  async verifyOtp(input: VerifyOtpInput) {
    const { phoneNumber, otp } = input;

    const redisKey = `signup:${phoneNumber}`;
    const attemptsKey = `signup:${phoneNumber}:attempts`;

    const stored = await redisManager.get(redisKey);
    if (!stored) {
      throw new AuthenticationError('OTP expired, please sign up again');
    }

    // Counted here — before checking whether the guess is right — so the cap can't be bypassed
    // by any future reordering; a correct guess still costs nothing since success deletes both
    // keys immediately below. Keyed by phone (not by which signup token presents it), since an
    // attacker can self-mint unlimited signup tokens for a victim's phone via public
    // POST /auth/signup — the OTP itself is the only real proof of ownership.
    const attempts = await redisManager.incr(attemptsKey, env.signupOtpTtlSeconds);
    if (attempts > MAX_OTP_ATTEMPTS) {
      await redisManager.delete(redisKey);
      await redisManager.delete(attemptsKey);
      throw new AuthenticationError('Too many incorrect attempts, please sign up again');
    }

    const { otp: storedOtp } = JSON.parse(stored) as { phoneNumber: string; otp: string };
    if (otp !== storedOtp) {
      throw new AuthenticationError('Invalid OTP');
    }

    await redisManager.delete(redisKey);
    await redisManager.delete(attemptsKey);

    let user = await this.authRepository.findUserByPhone(phoneNumber);
    if (!user) {
      const roleId = await this.roleService.findRoleIdByName(ORG_ADMIN_ROLE);
      user = await this.authRepository.createUser({ phoneNumber, tenantId: null, roleId });
    }

    return this.issueTokenPairForUser(user);
  }

  async requestLoginOtp(input: RequestLoginOtpInput) {
    const phoneNumber = this.normalizePhone(input.phoneNumber);
    const user = await this.authRepository.findUserByPhone(phoneNumber);
    if (!user) {
      throw new AuthenticationError('Unable to send OTP');
    }

    const loginToken = await this.requestOtpCode({
      phoneNumber,
      purpose: 'login',
      ttlSeconds: env.loginOtpTtlSeconds,
      cooldownSeconds: env.loginOtpResendCooldownSeconds,
      otpLabel: 'login',
    });

    return {
      loginToken,
      expiresIn: env.loginOtpTtlSeconds,
      message: `OTP sent to ${phoneNumber}`,
    };
  }

  async verifyLoginOtp(input: VerifyLoginOtpInput) {
    const { phoneNumber, otp } = input;

    await this.verifyOtpCode({
      phoneNumber,
      otp,
      purpose: 'login',
      ttlSeconds: env.loginOtpTtlSeconds,
      invalidOtpMessage: 'Invalid OTP',
      expiredMessage: 'OTP expired, please request a new login OTP',
      tooManyAttemptsMessage: 'Too many incorrect attempts, please request a new login OTP',
    });

    const user = await this.authRepository.findUserByPhone(phoneNumber);
    if (!user) {
      throw new AuthenticationError('Invalid or expired login OTP');
    }

    return this.buildAuthSession(user);
  }

  async createPassword(user: AuthenticatedUser, input: CreatePasswordInput) {
    const current = await this.getUserById(user.id);
    if (current.passwordHash) {
      throw new ConflictError('Password already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    await this.authRepository.setUserPassword(current.id, passwordHash);

    return { success: true, hasPassword: true };
  }

  async getProfile(userId: string) {
    const user = await this.getUserById(userId);
    return {
      id: user.id,
      tenantId: user.tenantId,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      email: user.email,
      role: user.role.name,
      coverage: user.coverage,
      permissions: await this.roleService.getEffectivePermissions(user.id),
      hasPassword: Boolean(user.passwordHash),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /** Platform admin provisions an internal staff account directly (POST /admin/staff) — the only
   *  user-creation path that isn't self-service. Unlike self-signup, phone ownership is never
   *  proven via OTP here, so both phone and email get pre-checked for collisions. The admin sets
   *  an initial password; the staff member logs in themselves via the existing POST /auth/login —
   *  this method never issues a token pair, since the admin isn't the one logging in. */
  async createStaffUser(actingUser: AuthenticatedUser, input: CreateStaffInput) {
    const { fullName, phoneNumber, email, roleId, coverage, permissionIds } = input;

    const role = await this.roleService.getRoleById(roleId);
    if (!STAFF_ASSIGNABLE_ROLES.includes(role.name)) {
      throw new ValidationError(
        `Role "${role.name}" cannot be assigned through staff creation — must be one of: ${STAFF_ASSIGNABLE_ROLES.join(', ')}`,
      );
    }

    const normalizedPhone = this.normalizePhone(phoneNumber);
    const [existingByPhone, existingByEmail] = await Promise.all([
      this.authRepository.findUserByPhone(normalizedPhone),
      this.authRepository.findUserByEmail(email),
    ]);
    if (existingByPhone) throw new ConflictError('A user with this phone number already exists');
    if (existingByEmail) throw new ConflictError('A user with this email already exists');
    const password = this.generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.authRepository.createUser({
      phoneNumber: normalizedPhone,
      tenantId: null,
      roleId,
      email,
      passwordHash,
      fullName,
      coverage,
    });

    await this.auditService.log({
      tenantId: null,
      userId: actingUser.id,
      action: 'STAFF_CREATED',
      resourceType: 'user',
      newData: {
        id: user.id,
        fullName,
        phoneNumber: user.phoneNumber,
        email,
        role: role.name,
        coverage,
      },
    });

    for (const permissionId of new Set(permissionIds ?? [])) {
      await this.roleService.grantPermission(actingUser, user.id, permissionId);
    }

    return {
      id: user.id,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      email: user.email,
      role: user.role.name,
      coverage: user.coverage,
      permissions: await this.roleService.getEffectivePermissions(user.id),
      createdAt: user.createdAt,
    };
  }

  generatePassword() {
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const number = '0123456789';
    const special = '!@#$%^&*';
    const all = upper + lower + number + special;

    let password =
      upper[Math.floor(Math.random() * upper.length)] +
      lower[Math.floor(Math.random() * lower.length)] +
      number[Math.floor(Math.random() * number.length)] +
      special[Math.floor(Math.random() * special.length)];

    while (password.length < 12) {
      password += all[Math.floor(Math.random() * all.length)];
    }

    return password;
  }

  // Thin wrapper so callers outside this module (admin.service.ts's verifier/agent assignment)
  // depend on AuthService, not AuthRepository directly — matches the pattern AdminService already
  // uses for organizationService/organizationDocumentService.
  async getUserById(userId: string) {
    const user = await this.authRepository.findUserById(userId);
    if (!user) throw new NotFoundError(`User ${userId} not found`);
    return user;
  }

  async listStaffUsers(input: { search?: string; role?: string; page: number; limit: number }) {
    const { items, total } = await this.authRepository.listStaffUsers(input);
    // Batched, not per-row — one extra query for the whole page, keyed by owner.
    const codesByOwner = await this.referralCodeService.listByOwnerIds(
      items.map((user) => user.id),
    );
    return {
      items: items.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        email: user.email,
        role: user.role.name,
        coverage: user.coverage,
        referralCodes: codesByOwner.get(user.id) ?? [],
        createdAt: user.createdAt,
      })),
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    };
  }

  async login(input: LoginInput, ipAddress: string | null) {
    return this.loginWithPhone(input.phoneNumber, input.password, ipAddress);
  }

  async refresh(input: RefreshInput) {
    const { refreshToken } = input;

    const tokenHash = hashToken(refreshToken);
    const stored = await this.authRepository.claimRefreshToken(tokenHash);
    if (!stored) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    const user = await this.authRepository.findUserById(stored.userId);
    if (!user) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    return this.buildAuthSession(user);
  }

  async logout(input: LogoutInput) {
    const { refreshToken, userId, jti, exp } = input;

    const tokenHash = hashToken(refreshToken);
    const stored = await this.authRepository.findActiveRefreshTokenByHash(tokenHash);
    if (stored && stored.userId === userId) {
      await this.authRepository.revokeRefreshToken(stored.id);
    }

    await blockToken(jti, exp);
  }

  async deleteAccount(user: AuthenticatedUser) {
    await this.authRepository.softDeleteUser(user.id);
    await this.authRepository.revokeAllRefreshTokensForUser(user.id);
    await blockToken(user.jti, user.exp);
    await invalidateUserExistsCache(user.id);
  }

  async getOrganization(tenantId: string) {
    const [organization, documents] = await Promise.all([
      this.organizationService.getOrganizationStatus(tenantId),
      this.organizationDocumentService.listByOrganization(tenantId),
    ]);
    return this.organizationOnboardingService.buildOrganizationResponse(organization, documents);
  }

  async createOrganization(
    userId: string,
    tenantId: string | null,
    input: SaveCompanyDetailsInput,
  ) {
    const referralCodeId = input.referralCode
      ? (await this.referralCodeService.validateAndResolve(input.referralCode)).id
      : null;

    const profileData = {
      name: input.companyLegalName,
      companyLegalName: input.companyLegalName,
      orgAdminName: input.contactPersonName,
      operationalCity: input.operatingCity,
      hasOwnFleet: input.ownsFleet,
      fleetSize: input.ownsFleet ? (input.fleetSize ?? null) : null,
      referralCodeId,
    };

    if (tenantId) {
      const current = await this.organizationService.getOrganizationStatus(tenantId);
      if (!isTenantAccessible(current.status)) {
        throw new AuthorizationError(`Organization is ${current.status} and cannot be updated`);
      }
      if (current.status === 'pending' || current.status === 'active' || current.submittedAt) {
        throw new AuthorizationError('Organization has already been submitted');
      }
      const onboardingStep = this.organizationOnboardingService.nextStepAfterCompanyDetails(
        current.onboardingStep,
      );

      const [organization, documents] = await Promise.all([
        this.organizationService.updateOrganization(tenantId, { ...profileData, onboardingStep }),
        this.organizationDocumentService.listByOrganization(tenantId),
      ]);
      return this.organizationOnboardingService.buildOrganizationResponse(organization, documents);
    }

    return this.dataSource.transaction(async (manager) => {
      const organization = await this.organizationService.createOrganization(
        { name: input.companyLegalName, status: 'draft' },
        manager,
      );
      const updated = await this.organizationService.updateOrganization(
        organization.id,
        { ...profileData, onboardingStep: 'business_details' },
        manager,
      );
      await this.authRepository.updateUserTenant(userId, organization.id, manager);
      const permissions = await this.roleService.getEffectivePermissions(userId);
      const tokens = await this.issueTokenPair(
        userId,
        organization.id,
        ORG_ADMIN_ROLE,
        permissions,
      );
      return {
        ...this.organizationOnboardingService.buildOrganizationResponse(updated, []),
        ...tokens,
      };
    });
  }

  async saveBusinessDetails(user: AuthenticatedUser, input: SaveBusinessDetailsInput) {
    if (!user.tenantId) {
      throw new AuthorizationError('Missing organization context');
    }

    const current = await this.organizationService.getOrganizationStatus(user.tenantId);
    if (!isTenantAccessible(current.status)) {
      throw new AuthorizationError(`Organization is ${current.status} and cannot be updated`);
    }
    if (current.status === 'pending' || current.status === 'active' || current.submittedAt) {
      throw new AuthorizationError('Organization has already been submitted');
    }

    return this.dataSource.transaction(async (manager) => {
      const organization = await this.organizationService.updateOrganization(
        user.tenantId!,
        {
          registeredBusinessName: input.registeredBusinessName,
          registrationDate: input.registrationDate ?? null,
          addressLine1: input.address.addressLine1,
          addressLine2: input.address.addressLine2 ?? null,
          city: input.address.city,
          district: input.address.district,
          state: input.address.state,
          pinCode: input.address.pinCode,
          status: current.status === 'draft' ? 'partial_pending' : current.status,
          onboardingStep: this.organizationOnboardingService.nextStepAfterBusinessDetails(
            current.onboardingStep,
          ),
        },
        manager,
      );

      const documents = input.documents?.length
        ? await this.organizationDocumentService.upsertDocuments(
            user.tenantId!,
            user.id,
            input.documents,
            manager,
          )
        : await this.organizationDocumentService.listByOrganization(user.tenantId!);

      return this.organizationOnboardingService.buildOrganizationResponse(organization, documents);
    });
  }

  async submitOrganization(user: AuthenticatedUser, input: SubmitOrganizationInput) {
    if (!user.tenantId) {
      throw new AuthorizationError('Missing organization context');
    }

    const referralCodeId = input.referralCode
      ? (await this.referralCodeService.validateAndResolve(input.referralCode)).id
      : null;

    const current = await this.organizationService.getOrganizationStatus(user.tenantId);
    if (!isTenantAccessible(current.status)) {
      throw new AuthorizationError(`Organization is ${current.status} and cannot be updated`);
    }
    if (current.status === 'pending' || current.status === 'active' || current.submittedAt) {
      throw new AuthorizationError('Organization has already been submitted');
    }

    return this.dataSource.transaction(async (manager) => {
      const organization = await this.organizationService.updateOrganization(
        user.tenantId!,
        {
          companyLegalName: input.companyLegalName,
          orgAdminName: input.contactPersonName,
          operationalCity: input.operatingCity,
          hasOwnFleet: input.ownsFleet,
          fleetSize: input.ownsFleet ? (input.fleetSize ?? null) : null,
          registeredBusinessName: input.registeredBusinessName,
          registrationDate: input.registrationDate ?? null,
          addressLine1: input.address.addressLine1,
          addressLine2: input.address.addressLine2 ?? null,
          city: input.address.city,
          district: input.address.district,
          state: input.address.state,
          pinCode: input.address.pinCode,
          referralCodeId,
          status: current.status === 'draft' ? 'partial_pending' : current.status,
          onboardingStep: 'review_submit',
        },
        manager,
      );

      const documents = await this.organizationDocumentService.upsertDocuments(
        user.tenantId!,
        user.id,
        input.documents,
        manager,
      );

      this.organizationOnboardingService.assertReadyForSubmission(organization, documents);

      const submittedAt = organization.submittedAt ?? new Date();
      await this.organizationService.updateOrganization(
        user.tenantId!,
        {
          status: 'pending',
          submittedAt,
          onboardingStep: 'submitted',
        },
        manager,
      );

      const withStage = await this.organizationJourneyStageService.recordTransition(
        user.tenantId!,
        'application_submitted',
        user.id,
        manager,
      );

      return this.organizationOnboardingService.buildOrganizationResponse(withStage, documents);
    });
  }

  private async requestOtpCode(input: {
    phoneNumber: string;
    purpose: 'signup' | 'login';
    ttlSeconds: number;
    cooldownSeconds: number;
    otpLabel: string;
  }) {
    const { phoneNumber, purpose, ttlSeconds, cooldownSeconds, otpLabel } = input;
    const cooldownKey = this.otpCooldownKey(purpose, phoneNumber);
    if (await redisManager.get(cooldownKey)) {
      throw new RateLimitError('Please wait before requesting another OTP');
    }
    await redisManager.set(cooldownKey, '1', cooldownSeconds);

    // The app still has no SMS/email delivery integration, so both OTP flows use a fixed code.
    const otp = SIGNUP_STATIC_OTP;
    await redisManager.set(
      this.otpRedisKey(purpose, phoneNumber),
      JSON.stringify({ phoneNumber, otp }),
      ttlSeconds,
    );
    await redisManager.delete(this.otpAttemptsKey(purpose, phoneNumber));
    return signToken({ phoneNumber, purpose: otpLabel }, ttlSeconds);
  }

  private async verifyOtpCode(input: {
    phoneNumber: string;
    otp: string;
    purpose: 'signup' | 'login';
    ttlSeconds: number;
    invalidOtpMessage: string;
    expiredMessage: string;
    tooManyAttemptsMessage: string;
  }) {
    const {
      phoneNumber,
      otp,
      purpose,
      ttlSeconds,
      invalidOtpMessage,
      expiredMessage,
      tooManyAttemptsMessage,
    } = input;

    const redisKey = this.otpRedisKey(purpose, phoneNumber);
    const attemptsKey = this.otpAttemptsKey(purpose, phoneNumber);

    const stored = await redisManager.get(redisKey);
    if (!stored) {
      throw new AuthenticationError(expiredMessage);
    }

    const attempts = await redisManager.incr(attemptsKey, ttlSeconds);
    if (attempts > MAX_OTP_ATTEMPTS) {
      await redisManager.delete(redisKey);
      await redisManager.delete(attemptsKey);
      throw new AuthenticationError(tooManyAttemptsMessage);
    }

    const { otp: storedOtp } = JSON.parse(stored) as { phoneNumber: string; otp: string };
    if (otp !== storedOtp) {
      throw new AuthenticationError(invalidOtpMessage);
    }

    await redisManager.delete(redisKey);
    await redisManager.delete(attemptsKey);
  }

  private async loginWithPhone(phoneNumber: string, password: string, ipAddress: string | null) {
    const normalizedPhone = this.normalizePhone(phoneNumber);
    const recentFailures = await this.authRepository.countRecentFailedAttempts(
      normalizedPhone,
      ipAddress,
      LOGIN_ATTEMPT_WINDOW_MS,
    );
    if (recentFailures >= MAX_FAILED_ATTEMPTS) {
      throw new AuthenticationError('Too many failed login attempts, try again later');
    }

    const user = await this.authRepository.findUserByPhone(normalizedPhone);
    const passwordMatches = await bcrypt.compare(
      password,
      user?.passwordHash ?? DUMMY_PASSWORD_HASH,
    );
    await this.authRepository.recordLoginAttempt({
      email: normalizedPhone,
      success: passwordMatches,
      ipAddress,
    });

    if (!user || !passwordMatches || !user.passwordHash) {
      throw new AuthenticationError('Invalid credentials');
    }

    return this.buildAuthSession(user);
  }

  private async buildAuthSession(user: UserEntity): Promise<AuthSession> {
    const permissions = await this.roleService.getEffectivePermissions(user.id);
    const tokens = await this.issueTokenPair(user.id, user.tenantId, user.role.name, permissions);
    const progress = await this.getOnboardingProgress(user);

    return {
      ...tokens,
      role: user.role.name,
      permissions,
      user: {
        id: user.id,
        phoneNumber: user.phoneNumber,
        hasPassword: Boolean(user.passwordHash),
      },
      onboardingStatus: progress.onboardingStatus,
      onboardingStep: progress.onboardingStep,
      nextStep: progress.nextStep,
    };
  }

  // The no-tenantId branch (a brand new org_admin who hasn't created their org yet, vs. a
  // brand new staff user for whom onboarding is meaningless) depends on the user's role, which
  // organizationOnboardingService deliberately never sees — kept here rather than in the org
  // module. Once a tenantId exists, the rest of the state machine is pure org/document data and
  // delegates straight to organizationOnboardingService.getProgress.
  private async getOnboardingProgress(user: UserEntity): Promise<OrganizationOnboardingProgress> {
    if (!user.tenantId) {
      return user.role.name === ORG_ADMIN_ROLE
        ? {
            onboardingStatus: 'incomplete',
            onboardingStep: 'company_details',
            nextStep: 'company_details',
            organization: null,
            documents: [],
          }
        : {
            onboardingStatus: 'completed',
            onboardingStep: 'submitted',
            nextStep: 'submitted',
            organization: null,
            documents: [],
          };
    }

    return this.organizationOnboardingService.getProgress(user.tenantId);
  }

  private normalizePhone(phoneNumber: string): string {
    const normalized = normalizePhoneNumber(phoneNumber);
    if (!normalized) {
      throw new ValidationError('phoneNumber is invalid');
    }
    return normalized;
  }

  private otpRedisKey(purpose: 'signup' | 'login', phoneNumber: string): string {
    return `${purpose}:${phoneNumber}`;
  }

  private otpAttemptsKey(purpose: 'signup' | 'login', phoneNumber: string): string {
    return `${this.otpRedisKey(purpose, phoneNumber)}:attempts`;
  }

  private otpCooldownKey(purpose: 'signup' | 'login', phoneNumber: string): string {
    return `${this.otpRedisKey(purpose, phoneNumber)}:cooldown`;
  }

  /** Computes effective permissions for a user fresh (never trusts old token claims) and issues
   *  a token pair for them — the common path used by verifyOtp/login/refresh. */
  private async issueTokenPairForUser(user: {
    id: string;
    tenantId: string | null;
    role: { name: string };
  }) {
    const permissions = await this.roleService.getEffectivePermissions(user.id);
    return this.issueTokenPair(user.id, user.tenantId, user.role.name, permissions);
  }

  private async issueTokenPair(
    userId: string,
    tenantId: string | null,
    role: string,
    permissions: string[],
  ) {
    const jti = randomUUID();
    const accessToken = signToken(
      { id: userId, tenantId, role, permissions, jti, purpose: 'access' },
      env.accessTokenTtlSeconds,
    );

    const rawRefreshToken = randomBytes(40).toString('hex');
    await this.authRepository.createRefreshToken({
      userId,
      tokenHash: hashToken(rawRefreshToken),
      expiresAt: new Date(Date.now() + env.refreshTokenTtlMs),
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }
}
