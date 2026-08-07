import { randomBytes, randomInt, randomUUID } from 'crypto';
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
import { OrganizationService } from './organization.service';
import { OrganizationDocumentService } from './organization-document.service';
import { OrganizationEntity, OrganizationOnboardingStep } from './entities/organization.entity';
import { OrganizationDocumentEntity } from './entities/organization-document.entity';
import { isTenantAccessible } from './organization.constants';
import { AuthRepository } from './auth.repository';
import { ReferralCodeService } from './referral-code.service';
import { RoleService } from '../roles/role.service';
import { AuditService } from '../audit/audit.service';
import { redisManager } from '../../db/redis';
import {
  LOGIN_ATTEMPT_WINDOW_MS,
  MAX_FAILED_ATTEMPTS,
  MAX_OTP_ATTEMPTS,
  SIGNUP_RESEND_COOLDOWN_SECONDS,
  DUMMY_PASSWORD_HASH,
} from './auth.constants';
import { ORG_ADMIN_ROLE, STAFF_ASSIGNABLE_ROLES } from '../../shared/constants/roles';
import {
  SignupInput,
  VerifyOtpInput,
  CreateStaffInput,
  LoginInput,
  RefreshInput,
  LogoutInput,
  SaveCompanyDetailsInput,
  SaveBusinessDetailsInput,
  SubmitOrganizationInput,
  CreatePasswordInput,
  OnboardingStatus,
  OnboardingStep,
} from './auth.types';
import { UserEntity } from './entities/user.entity';

type AuthSession = {
  accessToken: string;
  refreshToken: string;
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

type OrganizationProgress = {
  onboardingStatus: OnboardingStatus;
  onboardingStep: OrganizationOnboardingStep;
  nextStep: OnboardingStep;
  organization: OrganizationEntity | null;
  documents: OrganizationDocumentEntity[];
};

type OrganizationReviewData = {
  companyLegalName: string | null;
  contactPersonName: string | null;
  operatingCity: string | null;
  ownsFleet: boolean | null;
  fleetSize: number | null;
  registeredBusinessName: string | null;
  registrationDate: string | null;
  address: {
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    district: string | null;
    state: string | null;
    pinCode: string | null;
  };
  referralCode: string | null;
  documents: Array<{
    documentType: string;
    documentNumber: string | null;
    documentUrl: string | null;
    isVaild: boolean;
  }>;
};

export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly organizationService: OrganizationService,
    private readonly organizationDocumentService: OrganizationDocumentService,
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
    // each overwrite the OTP and (once real SMS delivery is wired up per the TODO below) resend
    // an SMS with no cooldown, an SMS-bombing vector even within a single OTP's validity window.
    const cooldownKey = `signup:${phoneNumber}:cooldown`;
    if (await redisManager.get(cooldownKey)) {
      throw new RateLimitError('Please wait before requesting another OTP');
    }
    await redisManager.set(cooldownKey, '1', SIGNUP_RESEND_COOLDOWN_SECONDS);

    const otp = randomInt(100000, 1000000).toString();
    await redisManager.set(
      `signup:${phoneNumber}`,
      JSON.stringify({ phoneNumber, otp }),
      env.signupOtpTtlSeconds,
    );
    // A fresh OTP always gets a fresh guess budget — otherwise a stale counter from a previous
    // OTP cycle would unfairly shrink this one's.
    await redisManager.delete(`signup:${phoneNumber}:attempts`);

    if (env.nodeEnv !== 'production') {
      console.log(`OTP for ${phoneNumber}: ${otp}`); // TODO: replace with real SMS/email delivery once notifications module is wired up
    }

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
  async createPassword(user: AuthenticatedUser, input: CreatePasswordInput) {
    const current = await this.getUserById(user.id);
    if (current.passwordHash) {
      throw new ConflictError('Password already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, 10);
    await this.authRepository.setUserPassword(current.id, passwordHash);

    return { success: true, hasPassword: true };
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
    return this.buildOrganizationResponse(organization, documents);
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
      const onboardingStep = this.advanceStepAfterCompanyDetails(current.onboardingStep);

      const [organization, documents] = await Promise.all([
        this.organizationService.updateOrganization(tenantId, { ...profileData, onboardingStep }),
        this.organizationDocumentService.listByOrganization(tenantId),
      ]);
      return this.buildOrganizationResponse(organization, documents);
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
      return { ...this.buildOrganizationResponse(updated, []), ...tokens };
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
          onboardingStep: this.advanceStepAfterBusinessDetails(current.onboardingStep),
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

      return this.buildOrganizationResponse(organization, documents);
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

      this.assertCompanyDetailsComplete(organization);
      this.assertBusinessDetailsComplete(organization);
      this.assertDocumentsReady(documents);

      const submittedAt = organization.submittedAt ?? new Date();
      const updated = await this.organizationService.updateOrganization(
        user.tenantId!,
        {
          status: 'pending',
          submittedAt,
          onboardingStep: 'submitted',
        },
        manager,
      );

      return this.buildOrganizationResponse(updated, documents);
    });
  }

  private async requestOtp(phoneNumber: string) {
    const cooldownKey = `signup:${phoneNumber}:cooldown`;
    if (await redisManager.get(cooldownKey)) {
      throw new RateLimitError('Please wait before requesting another OTP');
    }
    await redisManager.set(cooldownKey, '1', SIGNUP_RESEND_COOLDOWN_SECONDS);

    const otp = randomInt(100000, 1000000).toString();
    await redisManager.set(
      this.otpRedisKey(phoneNumber),
      JSON.stringify({ phoneNumber, otp }),
      env.signupOtpTtlSeconds,
    );
    await redisManager.delete(`${this.otpRedisKey(phoneNumber)}:attempts`);
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
    const progress = await this.getOrganizationProgress(user);

    return {
      ...tokens,
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

  private async getOrganizationProgress(user: UserEntity): Promise<OrganizationProgress> {
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

    const [organization, documents] = await Promise.all([
      this.organizationService.getOrganizationStatus(user.tenantId),
      this.organizationDocumentService.listByOrganization(user.tenantId),
    ]);

    return this.buildOnboardingState(organization, documents);
  }

  private buildOnboardingState(
    organization: OrganizationEntity,
    documents: OrganizationDocumentEntity[],
  ): OrganizationProgress {
    const onboardingStep = this.resolveOnboardingStep(organization, documents);

    if (organization.status === 'active') {
      return {
        onboardingStatus: 'completed',
        onboardingStep: 'submitted',
        nextStep: 'submitted',
        organization,
        documents,
      };
    }

    if (organization.status === 'pending' || organization.submittedAt) {
      return {
        onboardingStatus: 'submitted',
        onboardingStep: 'submitted',
        nextStep: 'submitted',
        organization,
        documents,
      };
    }

    return {
      onboardingStatus: 'incomplete',
      onboardingStep,
      nextStep: onboardingStep,
      organization,
      documents,
    };
  }

  private buildOrganizationResponse(
    organization: OrganizationEntity,
    documents: OrganizationDocumentEntity[],
  ) {
    const state = this.buildOnboardingState(organization, documents);
    return {
      ...state,
      organization,
      documents,
      reviewData: this.buildReviewData(organization, documents),
    };
  }

  private hasCompanyDetails(organization: OrganizationEntity): boolean {
    return Boolean(
      organization.companyLegalName &&
      organization.orgAdminName &&
      organization.operationalCity &&
      organization.hasOwnFleet !== null &&
      (organization.hasOwnFleet ? organization.fleetSize !== null : true),
    );
  }

  private hasBusinessDetails(organization: OrganizationEntity): boolean {
    return Boolean(
      organization.registeredBusinessName &&
      organization.registrationDate &&
      organization.addressLine1 &&
      organization.city &&
      organization.district &&
      organization.state &&
      organization.pinCode,
    );
  }

  private assertCompanyDetailsComplete(organization: OrganizationEntity): void {
    if (!this.hasCompanyDetails(organization)) {
      throw new ValidationError('Company details are incomplete');
    }
  }

  private assertBusinessDetailsComplete(organization: OrganizationEntity): void {
    if (!this.hasBusinessDetails(organization)) {
      throw new ValidationError('Business details are incomplete');
    }
  }

  private assertDocumentsPresent(documents: OrganizationDocumentEntity[]): void {
    if (documents.length === 0) {
      throw new ValidationError('At least one document is required before submission');
    }
  }

  private assertDocumentsReady(documents: OrganizationDocumentEntity[]): void {
    this.assertDocumentsPresent(documents);
    const invalidDocuments = documents.filter(
      (document) => !document.documentNumber && !document.fileKey,
    );
    if (invalidDocuments.length > 0) {
      throw new ValidationError(
        'Each document must include either a document number or a document URL',
      );
    }
  }

  private resolveOnboardingStep(
    organization: OrganizationEntity,
    documents: OrganizationDocumentEntity[],
  ): OrganizationOnboardingStep {
    if (organization.onboardingStep) {
      return organization.onboardingStep;
    }
    if (organization.status === 'pending' || organization.submittedAt) {
      return 'submitted';
    }
    if (!this.hasCompanyDetails(organization)) {
      return 'company_details';
    }
    if (!this.hasBusinessDetails(organization)) {
      return 'business_details';
    }
    if (!documents.length) {
      return 'review_submit';
    }
    return 'review_submit';
  }

  private advanceStepAfterCompanyDetails(
    currentStep: OrganizationOnboardingStep | null,
  ): OrganizationOnboardingStep {
    if (currentStep === 'review_submit' || currentStep === 'submitted') {
      return currentStep;
    }
    return 'business_details';
  }

  private advanceStepAfterBusinessDetails(
    currentStep: OrganizationOnboardingStep | null,
  ): OrganizationOnboardingStep {
    if (currentStep === 'submitted') {
      return 'submitted';
    }
    return 'review_submit';
  }

  private buildReviewData(
    organization: OrganizationEntity,
    documents: OrganizationDocumentEntity[],
  ): OrganizationReviewData {
    return {
      companyLegalName: organization.companyLegalName,
      contactPersonName: organization.orgAdminName,
      operatingCity: organization.operationalCity,
      ownsFleet: organization.hasOwnFleet,
      fleetSize: organization.fleetSize,
      registeredBusinessName: organization.registeredBusinessName,
      registrationDate: organization.registrationDate,
      address: {
        addressLine1: organization.addressLine1,
        addressLine2: organization.addressLine2,
        city: organization.city,
        district: organization.district,
        state: organization.state,
        pinCode: organization.pinCode,
      },
      referralCode: organization.referralCode?.code ?? null,
      documents: documents.map((document) => ({
        documentType: document.documentType,
        documentNumber: document.documentNumber,
        documentUrl: document.fileKey,
        isVaild: document.isVaild,
      })),
    };
  }

  private normalizePhone(phoneNumber: string): string {
    const normalized = normalizePhoneNumber(phoneNumber);
    if (!normalized) {
      throw new ValidationError('phoneNumber is invalid');
    }
    return normalized;
  }

  private otpRedisKey(phoneNumber: string): string {
    return `signup:${phoneNumber}`;
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
