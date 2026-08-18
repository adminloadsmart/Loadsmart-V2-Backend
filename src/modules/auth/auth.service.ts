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
import { StorageService } from '../storage/storage.service';
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
import {
  ORG_ADMIN_ROLE,
  STAFF_ASSIGNABLE_ROLES,
  ORG_ASSIGNABLE_ROLES,
} from '../../shared/constants/roles';
import {
  SignupInput,
  RequestLoginOtpInput,
  VerifyOtpInput,
  VerifyLoginOtpInput,
  CreateStaffInput,
  UpdateStaffInput,
  InviteOrganizationUserInput,
  ListOrganizationUsersInput,
  LoginInput,
  RefreshInput,
  LogoutInput,
  CreatePasswordInput,
  SaveUserDetailsInput,
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
    private readonly storageService: StorageService,
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
    const { phoneNumber, otp, password: requestedPassword } = input;

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
      const password = requestedPassword ?? this.generatePassword();
      const passwordHash = await bcrypt.hash(password, 10);
      user = await this.authRepository.createUser({
        phoneNumber,
        tenantId: null,
        roleId,
        passwordHash,
      });

      if (env.nodeEnv === 'development') {
        console.log(`[development] Generated signup password for ${phoneNumber}: ${password}`);
      }
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

  async saveUserDetails(user: AuthenticatedUser, input: SaveUserDetailsInput) {
    const updated = await this.authRepository.updateUser(user.id, {
      fullName: input.name,
      email: input.email ?? null,
      designation: input.designation ?? null,
      manualDesignation: input.manualDesignation ?? null,
      department: input.department ?? null,
    });

    await this.auditService.log({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'ORGANIZATION_USER_DETAILS_SAVED',
      resourceType: 'user',
      newData: {
        userId: updated.id,
        fullName: updated.fullName,
        email: updated.email,
        designation: updated.designation,
        department: updated.department,
      },
    });

    return {
      id: updated.id,
      name: updated.fullName,
      email: updated.email,
      designation: updated.designation,
      manualDesignation: updated.manualDesignation,
      department: updated.department,
    };
  }

  async getProfile(userId: string) {
    const user = await this.getUserById(userId);
    return {
      id: user.id,
      tenantId: user.tenantId,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      email: user.email,
      designation: user.designation,
      manualDesignation: user.manualDesignation,
      department: user.department,
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
      // findUserByEmail's `where` drops undefined values entirely, so it must be skipped rather
      // than called with an undefined email — otherwise it'd match any active user.
      email ? this.authRepository.findUserByEmail(email) : Promise.resolve(null),
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

  /** Org admin invites a teammate into their own org (Settings → Users & Roles) — the
   *  organization-scope counterpart to createStaffUser above. Phone only, no email. Unlike staff
   *  creation there's no separate delivery channel (SMS/email) yet for the generated password, so
   *  it's returned once in the response for the admin to share manually — a gap worth closing
   *  once notifications wiring exists, same as staff creation already has.
   *
   *  organization.routes.ts already gates the caller via requirePermission(ORGANIZATION_PROFILE_MANAGE),
   *  which only org_admin holds — the role check here is belt-and-suspenders for any future caller
   *  of this service method that bypasses the route; the tenantId check is load-bearing, since
   *  requirePermission has no notion of tenant context and platform_admin's bypass would otherwise
   *  reach here with a null tenantId. */
  async inviteOrganizationUser(actingUser: AuthenticatedUser, input: InviteOrganizationUserInput) {
    if (actingUser.role !== ORG_ADMIN_ROLE || !actingUser.tenantId) {
      throw new AuthorizationError('Only an org admin can invite teammates');
    }
    const { fullName, phoneNumber, roleId } = input;

    const role = await this.roleService.getRoleById(roleId);
    if (!ORG_ASSIGNABLE_ROLES.includes(role.name)) {
      throw new ValidationError(
        `Role "${role.name}" cannot be assigned through an org invite — must be one of: ${ORG_ASSIGNABLE_ROLES.join(', ')}`,
      );
    }

    const normalizedPhone = this.normalizePhone(phoneNumber);
    const existingByPhone = await this.authRepository.findUserByPhone(normalizedPhone);
    if (existingByPhone) throw new ConflictError('A user with this phone number already exists');

    const password = this.generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.authRepository.createUser({
      phoneNumber: normalizedPhone,
      tenantId: actingUser.tenantId,
      roleId,
      email: null,
      passwordHash,
      fullName,
      coverage: null,
    });

    await this.auditService.log({
      tenantId: actingUser.tenantId,
      userId: actingUser.id,
      action: 'ORG_USER_INVITED',
      resourceType: 'user',
      newData: { id: user.id, fullName, phoneNumber: user.phoneNumber, role: role.name },
    });

    return {
      id: user.id,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      role: user.role.name,
      temporaryPassword: password,
      permissions: await this.roleService.getEffectivePermissions(user.id),
      createdAt: user.createdAt,
    };
  }

  async listOrganizationUsers(actingUser: AuthenticatedUser, input: ListOrganizationUsersInput) {
    if (!actingUser.tenantId) {
      throw new AuthorizationError('This resource requires an organization context');
    }
    const { items, total } = await this.authRepository.listOrganizationUsers(
      actingUser.tenantId,
      input,
    );
    return {
      items: items.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        role: user.role.name,
        createdAt: user.createdAt,
      })),
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    };
  }

  /** Backs the "Invite a teammate" role dropdown — see role.service.ts's
   *  listAssignableOrganizationRoles for why this is a fixed allow-list, not a scope filter. */
  async listAssignableOrganizationRoles() {
    const roles = await this.roleService.listAssignableOrganizationRoles();
    return roles.map((role) => ({ id: role.id, name: role.name }));
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
    const staffIds = items.map((user) => user.id);
    // Batched, not per-row — fixed number of extra queries for the whole page, keyed by
    // owner/staff id, run concurrently.
    const [codesByOwner, signupCountByOwner, workloadByStaff] = await Promise.all([
      this.referralCodeService.listByOwnerIds(staffIds),
      this.organizationService.countActiveByReferralCodeOwnerIds(staffIds),
      this.organizationService.countPendingKycAssignmentsByStaffIds(staffIds),
    ]);
    return {
      items: items.map((user) => ({
        id: user.id,
        fullName: user.fullName,
        phoneNumber: user.phoneNumber,
        email: user.email,
        role: user.role.name,
        coverage: user.coverage,
        referralCodes: codesByOwner.get(user.id) ?? [],
        // Organizations that onboarded (status 'active') via any of this staff member's referral codes.
        signupCount: signupCountByOwner.get(user.id) ?? 0,
        // Orgs assigned to this staff member for KYC review (online or physical) not yet completed —
        // the only "current work" concept this schema has; non-KYC roles are always 0.
        workload: workloadByStaff.get(user.id) ?? 0,
        createdAt: user.createdAt,
      })),
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    };
  }

  /** Platform admin edits an existing staff account (PATCH /admin/staff/:staffId) — profile
   *  fields, role, and direct permission grants (replace semantics: the new permissionIds list
   *  becomes the full set of direct grants, missing ones get revoked). Role and permission changes
   *  are delegated to RoleService.assignRole/grantPermission/revokePermission, which each already
   *  reject a self-targeting caller (assertCanManage) and write their own audit entries — handled
   *  first, before the profile-field write below, so a self-target rejection can't leave a partial
   *  update behind (profile fields saved, permissions half-applied). Profile fields
   *  (fullName/phoneNumber/email/coverage) aren't scoped by assertCanManage and stay self-editable. */
  async updateStaff(actingUser: AuthenticatedUser, staffId: string, input: UpdateStaffInput) {
    const { fullName, phoneNumber, email, roleId, coverage, permissionIds } = input;

    const existing = await this.authRepository.findUserById(staffId);
    if (!existing) throw new NotFoundError(`Staff member ${staffId} not found`);

    if (roleId !== undefined) {
      const role = await this.roleService.getRoleById(roleId);
      if (!STAFF_ASSIGNABLE_ROLES.includes(role.name)) {
        throw new ValidationError(
          `Role "${role.name}" cannot be assigned through staff update — must be one of: ${STAFF_ASSIGNABLE_ROLES.join(', ')}`,
        );
      }
      await this.roleService.assignRole(actingUser, staffId, roleId);
    }

    if (permissionIds !== undefined) {
      const current = await this.roleService.getUserPermissions(actingUser, staffId);
      const currentIds = new Set(current.directPermissions.map((p) => p.id));
      const nextIds = new Set(permissionIds);
      for (const id of nextIds) {
        if (!currentIds.has(id)) await this.roleService.grantPermission(actingUser, staffId, id);
      }
      for (const id of currentIds) {
        if (!nextIds.has(id)) await this.roleService.revokePermission(actingUser, staffId, id);
      }
    }

    const normalizedPhone = phoneNumber ? this.normalizePhone(phoneNumber) : undefined;
    const [existingByPhone, existingByEmail] = await Promise.all([
      normalizedPhone
        ? this.authRepository.findUserByPhone(normalizedPhone)
        : Promise.resolve(null),
      // Same undefined-drops-the-where gotcha as createStaffUser — only call when email is set.
      email ? this.authRepository.findUserByEmail(email) : Promise.resolve(null),
    ]);
    if (existingByPhone && existingByPhone.id !== staffId) {
      throw new ConflictError('A user with this phone number already exists');
    }
    if (existingByEmail && existingByEmail.id !== staffId) {
      throw new ConflictError('A user with this email already exists');
    }

    const profileFields: Partial<{
      fullName: string;
      phoneNumber: string;
      email: string;
      coverage: string;
    }> = {};
    if (fullName !== undefined) profileFields.fullName = fullName;
    if (normalizedPhone !== undefined) profileFields.phoneNumber = normalizedPhone;
    if (email !== undefined) profileFields.email = email;
    if (coverage !== undefined) profileFields.coverage = coverage;

    if (Object.keys(profileFields).length > 0) {
      await this.authRepository.updateUser(staffId, profileFields);
      await this.auditService.log({
        tenantId: null,
        userId: actingUser.id,
        action: 'STAFF_UPDATED',
        resourceType: 'user',
        oldData: {
          fullName: existing.fullName,
          phoneNumber: existing.phoneNumber,
          email: existing.email,
          coverage: existing.coverage,
        },
        newData: profileFields,
      });
    }

    const updated = await this.authRepository.findUserById(staffId);
    if (!updated) throw new NotFoundError(`Staff member ${staffId} not found`);

    return {
      id: updated.id,
      fullName: updated.fullName,
      phoneNumber: updated.phoneNumber,
      email: updated.email,
      role: updated.role.name,
      coverage: updated.coverage,
      permissions: await this.roleService.getEffectivePermissions(updated.id),
      createdAt: updated.createdAt,
    };
  }

  /** Platform admin deactivates a staff account (DELETE /admin/staff/:staffId) — soft delete via
   *  AuthRepository.softDeleteUser, the same mechanism the self-service deleteAccount flow below
   *  uses, plus revoking their refresh tokens so a currently-live session can't silently keep
   *  renewing (their still-live access token expires naturally — same limitation deleteAccount
   *  has for the caller's own current token, there worked around with an explicit blockToken call
   *  we can't make here since we don't hold the target's jti). role.service.ts's
   *  assignRole/grantPermission/revokePermission close this exact gap for permission changes via
   *  a permissions_version check every request goes through (see auth.middleware.ts) — deletion
   *  doesn't need that same mechanism since invalidateUserExistsCache below already forces the
   *  equivalent "user no longer exists" rejection on this user's very next request, on the same
   *  cache-TTL bound. Restricted to accounts actually provisioned through this surface
   *  (STAFF_ASSIGNABLE_ROLES) — platform_admin/org_admin aren't deprovisioned this way, same
   *  boundary createStaffUser/updateStaff already enforce for role assignment. Blocked while the
   *  staff member still has unfinished KYC review work assigned
   *  (OrganizationService.countPendingKycAssignmentsByStaffIds) — reassign those organizations
   *  first, mirroring deleteReferralCode's block-while-in-use rule. */
  async deleteStaff(actingUser: AuthenticatedUser, staffId: string) {
    const existing = await this.authRepository.findUserById(staffId);
    if (!existing) throw new NotFoundError(`Staff member ${staffId} not found`);

    if (staffId === actingUser.id) {
      throw new AuthorizationError('Cannot delete your own account');
    }
    if (!STAFF_ASSIGNABLE_ROLES.includes(existing.role.name)) {
      throw new ValidationError(
        `Role "${existing.role.name}" cannot be deleted through staff management — must be one of: ${STAFF_ASSIGNABLE_ROLES.join(', ')}`,
      );
    }

    const workloadByStaff = await this.organizationService.countPendingKycAssignmentsByStaffIds([
      staffId,
    ]);
    const workload = workloadByStaff.get(staffId) ?? 0;
    if (workload > 0) {
      throw new ConflictError(
        `Staff member has ${workload} unfinished KYC review assignment(s) — reassign them before deleting`,
      );
    }

    await this.authRepository.softDeleteUser(staffId);
    await this.authRepository.revokeAllRefreshTokensForUser(staffId);
    await invalidateUserExistsCache(staffId);

    await this.auditService.log({
      tenantId: null,
      userId: actingUser.id,
      action: 'STAFF_DELETED',
      resourceType: 'user',
      oldData: {
        id: existing.id,
        fullName: existing.fullName,
        phoneNumber: existing.phoneNumber,
        email: existing.email,
        role: existing.role.name,
      },
    });
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

  async getOrganizationForUser(user: AuthenticatedUser) {
    const currentUser = await this.getUserById(user.id);
    const progress = await this.getOnboardingProgress(currentUser);
    const userDetails = {
      id: currentUser.id,
      phoneNumber: currentUser.phoneNumber,
      name: currentUser.fullName,
      email: currentUser.email,
      designation: currentUser.designation,
      manualDesignation: currentUser.manualDesignation,
      department: currentUser.department,
    };

    if (!user.tenantId) {
      return { ...progress, user: userDetails };
    }

    const organization = await this.getOrganization(user.tenantId);
    return { ...organization, user: userDetails };
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
      hasOwnFleet: input.ownsFleet,
      addressLine1: input.address.addressLine1,
      addressLine2: input.address.addressLine2 ?? null,
      landmark: input.address.landmark ?? null,
      areaLocality: input.address.areaLocality,
      city: input.address.city,
      state: input.address.state,
      pinCode: input.address.pinCode,
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
      await this.auditService.log({
        tenantId,
        userId,
        action: 'ORGANIZATION_COMPANY_DETAILS_SAVED',
        resourceType: 'organization',
        newData: {
          organizationId: organization.id,
          companyLegalName: organization.companyLegalName,
          ownsFleet: organization.hasOwnFleet,
          onboardingStep: organization.onboardingStep,
        },
      });
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
      const user = await this.authRepository.findUserById(userId);
      if (!user) throw new NotFoundError(`User ${userId} not found`);
      const tokens = await this.issueTokenPair(
        userId,
        organization.id,
        ORG_ADMIN_ROLE,
        permissions,
        user.permissionsVersion,
      );
      await this.auditService.log({
        tenantId: organization.id,
        userId,
        action: 'ORGANIZATION_COMPANY_DETAILS_SAVED',
        resourceType: 'organization',
        newData: {
          organizationId: organization.id,
          companyLegalName: updated.companyLegalName,
          ownsFleet: updated.hasOwnFleet,
          onboardingStep: updated.onboardingStep,
        },
      });
      return {
        ...this.organizationOnboardingService.buildOrganizationResponse(updated, []),
        ...tokens,
      };
    });
  }

  async saveBusinessDetails(
    user: AuthenticatedUser,
    input: SaveBusinessDetailsInput,
    files: {
      documentFront: Express.Multer.File;
      documentBack?: Express.Multer.File;
      shopPremisesPhoto?: Express.Multer.File;
    },
  ) {
    if (!user.tenantId) {
      throw new AuthorizationError('Missing organization context');
    }

    const current = await this.organizationService.getOrganizationStatus(user.tenantId);
    if (!isTenantAccessible(current.status)) {
      throw new AuthorizationError(`Organization is ${current.status} and cannot be updated`);
    }
    if (current.status === 'active' || (current.submittedAt && current.status !== 'pending')) {
      throw new AuthorizationError('Organization has already been submitted');
    }

    if (current.status === 'pending') {
      const existingDocuments = await this.organizationDocumentService.listByOrganization(
        user.tenantId,
      );
      const hasInvalidDocument = existingDocuments.some(
        (document) => document.verificationStatus === 'invalid',
      );
      // An invalid document takes precedence over other documents still awaiting review: the
      // admin must be able to log in and replace every invalid document. Once the invalid rows
      // are replaced, they become pending and the normal pending-review block applies again.
      if (!hasInvalidDocument) {
        throw new AuthorizationError('Organization verification is pending. Please wait.');
      }
    }

    if (!files.shopPremisesPhoto && !current.shopboardPremisesPhotoKey) {
      throw new ValidationError('Shop-board premises photo is required');
    }

    const [documentFront, documentBack, shopPremisesPhoto] = await Promise.all([
      this.storageService.uploadTenantFile(
        user.tenantId,
        user.id,
        {
          purpose: 'kyc',
          fileName: files.documentFront.originalname,
          mimeType: files.documentFront.mimetype,
          sizeBytes: files.documentFront.size,
        },
        files.documentFront.buffer,
      ),
      files.documentBack
        ? this.storageService.uploadTenantFile(
            user.tenantId,
            user.id,
            {
              purpose: 'kyc',
              fileName: files.documentBack.originalname,
              mimeType: files.documentBack.mimetype,
              sizeBytes: files.documentBack.size,
            },
            files.documentBack.buffer,
          )
        : Promise.resolve(null),
      files.shopPremisesPhoto
        ? this.storageService.uploadTenantFile(
            user.tenantId,
            user.id,
            {
              purpose: 'organizations/shopboard-premises',
              fileName: files.shopPremisesPhoto.originalname,
              mimeType: files.shopPremisesPhoto.mimetype,
              sizeBytes: files.shopPremisesPhoto.size,
            },
            files.shopPremisesPhoto.buffer,
          )
        : Promise.resolve(null),
    ]);

    return this.dataSource.transaction(async (manager) => {
      if (input.replaceDocumentType && input.replaceDocumentType !== input.documentType) {
        await this.organizationDocumentService.removeActiveDocumentType(
          user.tenantId!,
          input.replaceDocumentType,
          user.id,
          manager,
        );
      }

      const organization = await this.organizationService.updateOrganization(
        user.tenantId!,
        {
          ...(shopPremisesPhoto ? { shopboardPremisesPhotoKey: shopPremisesPhoto.key } : {}),
          status: current.status === 'draft' ? 'partial_pending' : current.status,
          onboardingStep: current.status === 'pending' ? 'business_details' : 'review_submit',
        },
        manager,
      );

      const documents = await this.organizationDocumentService.upsertDocuments(
        user.tenantId!,
        user.id,
        [
          {
            documentType: input.documentType,
            documentNumber: input.documentNo,
            documentUrl: documentFront.key,
            ...(documentBack ? { backFileKey: documentBack.key } : {}),
          },
          ...(shopPremisesPhoto
            ? [
                {
                  documentType: 'shopboard_premises_photo' as const,
                  documentUrl: shopPremisesPhoto.key,
                },
              ]
            : []),
        ],
        manager,
      );

      await this.auditService.log({
        tenantId: user.tenantId!,
        userId: user.id,
        action: 'ORGANIZATION_BUSINESS_DETAILS_SAVED',
        resourceType: 'organization',
        newData: {
          organizationId: user.tenantId,
          documentTypes: documents.map((document) => document.documentType),
          documentIds: documents.map((document) => document.id),
          replacedDocumentType: input.replaceDocumentType ?? null,
          onboardingStep: organization.onboardingStep,
        },
      });

      return this.organizationOnboardingService.buildOrganizationResponse(organization, documents);
    });
  }

  async submitOrganization(user: AuthenticatedUser, input: SubmitOrganizationInput) {
    if (!user.tenantId) {
      throw new AuthorizationError('Missing organization context');
    }

    const current = await this.organizationService.getOrganizationStatus(user.tenantId);
    if (!isTenantAccessible(current.status)) {
      throw new AuthorizationError(`Organization is ${current.status} and cannot be updated`);
    }
    const currentDocuments = await this.organizationDocumentService.listByOrganization(
      user.tenantId,
    );
    const hasInvalidDocument = currentDocuments.some(
      (document) => document.verificationStatus === 'invalid',
    );
    const isCorrectionResubmission =
      current.status === 'pending' &&
      (current.onboardingStep === 'business_details' || hasInvalidDocument);
    if (
      current.status === 'active' ||
      (current.status === 'pending' && !isCorrectionResubmission) ||
      (current.submittedAt && !isCorrectionResubmission)
    ) {
      throw new AuthorizationError('Organization has already been submitted');
    }

    const referralCodeId = input.referralCode
      ? (await this.referralCodeService.validateAndResolve(input.referralCode)).id
      : undefined;

    return this.dataSource.transaction(async (manager) => {
      const organization = await this.organizationService.updateOrganization(
        user.tenantId!,
        {
          ...(referralCodeId !== undefined ? { referralCodeId } : {}),
          status: current.status === 'draft' ? 'partial_pending' : current.status,
          onboardingStep: 'review_submit',
        },
        manager,
      );

      const documents = await this.organizationDocumentService.listByOrganization(user.tenantId!);

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

      await this.auditService.log({
        tenantId: user.tenantId!,
        userId: user.id,
        action: isCorrectionResubmission ? 'ORGANIZATION_RESUBMITTED' : 'ORGANIZATION_SUBMITTED',
        resourceType: 'organization',
        oldData: {
          status: current.status,
          onboardingStep: current.onboardingStep,
          submittedAt: current.submittedAt,
        },
        newData: {
          status: 'pending',
          onboardingStep: 'submitted',
          submittedAt,
          documentIds: documents.map((document) => document.id),
        },
      });

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
    await this.assertOrganizationActiveForLogin(user);

    const permissions = await this.roleService.getEffectivePermissions(user.id);
    const tokens = await this.issueTokenPair(
      user.id,
      user.tenantId,
      user.role.name,
      permissions,
      user.permissionsVersion,
    );
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

  private async assertOrganizationActiveForLogin(user: UserEntity): Promise<void> {
    // A new org admin has no organization yet and must be allowed to log in to complete
    // onboarding. Existing org admins may log in while their organization is still in draft or
    // after it has been approved and marked active.
    if (user.role.name !== ORG_ADMIN_ROLE || !user.tenantId) return;

    const organization = await this.organizationService.getOrganizationStatus(user.tenantId);

    // A pending organization can be reopened only when the reviewer has marked one or more
    // documents invalid. In that case the org admin must be able to log in and replace the bad
    // document. Any pending document still means the review is in progress and must block login.
    if (organization.status === 'pending') {
      const documents = await this.organizationDocumentService.listByOrganization(user.tenantId);
      const hasInvalidDocument = documents.some(
        (document) => document.verificationStatus === 'invalid',
      );

      // Invalid documents are actionable even when another document is still pending. The login
      // response will carry the incomplete/business_details onboarding state and all invalid rows.
      if (hasInvalidDocument) return;

      throw new AuthorizationError('Organization verification is pending. Please wait.');
    }

    if (organization.status !== 'active' && organization.status !== 'draft') {
      const messages = {
        pending: 'Organization verification is pending. Please wait.',
        partial_pending: 'Organization verification is pending. Please wait.',
        draft: 'Please complete your organization verification to continue.',
        rejected: 'Organization verification was rejected.',
        suspended: 'Organization access is suspended.',
      } as const;

      throw new AuthorizationError(messages[organization.status]);
    }
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
    permissionsVersion: number;
  }) {
    const permissions = await this.roleService.getEffectivePermissions(user.id);
    return this.issueTokenPair(
      user.id,
      user.tenantId,
      user.role.name,
      permissions,
      user.permissionsVersion,
    );
  }

  private async issueTokenPair(
    userId: string,
    tenantId: string | null,
    role: string,
    permissions: string[],
    permissionsVersion: number,
  ) {
    const jti = randomUUID();
    const accessToken = signToken(
      { id: userId, tenantId, role, permissions, permissionsVersion, jti, purpose: 'access' },
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
