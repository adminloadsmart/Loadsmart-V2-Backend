import { randomBytes, randomUUID } from 'crypto';
import { DataSource, IsNull } from 'typeorm';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env';
import {
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
  ValidationError,
  rethrow,
} from '../../shared/errors';
import { AuthenticatedUser } from '../../shared/middleware/request.types';
import { signToken, hashToken } from '../../shared/utils/token';
import { blockToken } from '../../shared/utils/token-blocklist';
import { invalidateUserExistsCache } from '../../shared/utils/user-existence-cache';
import { normalizePhoneNumber } from '../../shared/utils/phone-number';
import { humanizeStatus } from '../../shared/utils/humanize';
import { OrganizationService } from '../organization/organization.service';
import { OrganizationDocumentService } from '../organization/organization-document.service';
import { OrganizationDocumentVerificationService } from '../organization/organization-document-verification.service';
import { OrganizationOnboardingService } from '../organization/organization-onboarding.service';
import { OrganizationJourneyStageService } from '../organization/organization-journey-stage.service';
import { StorageService } from '../storage/storage.service';
import { OtpService } from '../../shared/services/otp.service';
import {
  isTenantAccessible,
  isTenantWriteAccessible,
  organizationDisplayName,
} from '../organization/organization.constants';
import { AuthRepository } from './auth.repository';
import { ReferralCodeService } from '../organization/referral-code.service';
import { RoleService } from '../roles/role.service';
import { AuditService } from '../audit/audit.service';
import {
  LOGIN_ATTEMPT_WINDOW_MS,
  MAX_FAILED_ATTEMPTS,
  SIGNUP_RESEND_COOLDOWN_SECONDS,
  DUMMY_PASSWORD_HASH,
} from './auth.constants';
import {
  DISPATCH_ROLE,
  ORG_ADMIN_ROLE,
  SALES_ROLE,
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
  ChangeOrganizationUserSeatInput,
  LoginInput,
  RefreshInput,
  LogoutInput,
  CreatePasswordInput,
  SaveUserDetailsInput,
  LoginPortal,
  DevicePlatform,
  StaffRoleSummary,
} from './auth.types';
import {
  SaveCompanyDetailsInput,
  SaveBusinessDetailsInput,
  SubmitOrganizationInput,
  OnboardingStatus,
  OnboardingStep,
  OrganizationOnboardingProgress,
  ReferralCodeOwner,
} from '../organization/organization.types';
import { ReferralCodeEntity } from '../organization/entities/referral-code.entity';
import { UserEntity } from './entities/user.entity';
import { LoadingPointEntity } from '../masters/loading-point/entities/loading-point.entity';
import {
  DEFAULT_ORG_SEAT_LIMIT,
  SEAT_SCREEN_CATALOG,
  seatLabel,
} from '../../shared/constants/seat-screens';
import { buildCsv, CSV_EXPORT_MAX_ROWS } from '../../shared/utils/csv';
import { OrganizationEntity } from '../organization/entities/organization.entity';
import { joinCapabilities } from '../notifications/capability-wording';
import type { AccessRemovedContext } from '../notifications/catalog/notification-catalog';
import { traceNotification, warnNotification } from '../notifications/utils/notification-trace';
import { NotificationTriggers } from '../notifications/notifications.interface';

// Threaded through issueTokenPairForUser/buildAuthSession/issueTokenPair.
type DeviceContext = {
  fcmToken?: string | null;
  deviceType?: DevicePlatform | null;
  deviceInfo?: string | null;
  ipAddress?: string | null;
};

type AuthSession = {
  accessToken: string;
  refreshToken: string;
  role: string;
  permissions: string[];
  user: {
    id: string;
    phoneNumber: string;
    hasPassword: boolean;
    whatsappOptIn: boolean | null;
  };
  onboardingStatus: OnboardingStatus;
  onboardingStep: OnboardingStep;
  nextStep: OnboardingStep;
  portal: LoginPortal;
};

export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly organizationService: OrganizationService,
    private readonly organizationDocumentService: OrganizationDocumentService,
    private readonly documentVerificationService: OrganizationDocumentVerificationService,
    private readonly organizationOnboardingService: OrganizationOnboardingService,
    private readonly organizationJourneyStageService: OrganizationJourneyStageService,
    private readonly storageService: StorageService,
    private readonly referralCodeService: ReferralCodeService,
    private readonly roleService: RoleService,
    private readonly auditService: AuditService,
    private readonly otpService: OtpService,
    private readonly dataSource: DataSource,
    private readonly notificationTriggers: NotificationTriggers,
  ) {}

  async signup(input: SignupInput) {
    const { phoneNumber } = input;

    const existing = await this.authRepository.findUserByPhone(phoneNumber);
    if (existing) {
      throw new ConflictError('A user with this phone number already exists');
    }

    await this.otpService.requestOtpCode({
      phoneNumber,
      purpose: 'signup',
      cooldownSeconds: SIGNUP_RESEND_COOLDOWN_SECONDS,
      ipAddress: input.ipAddress,
    });
    const signupToken = signToken({ phoneNumber, purpose: 'signup' }, env.signupOtpTtlSeconds);

    return {
      signupToken,
      expiresIn: env.signupOtpTtlSeconds,
      message: `OTP sent to ${phoneNumber}`,
    };
  }

  async verifyOtp(input: VerifyOtpInput) {
    const { phoneNumber, otp } = input;

    // Keyed by phone (not by which signup token presents it), since an attacker can self-mint
    // unlimited signup tokens for a victim's phone via public POST /auth/signup — the OTP itself
    // is the only real proof of ownership.
    await this.otpService.verifyOtpCode({
      phoneNumber,
      otp,
      purpose: 'signup',
      ttlSeconds: env.signupOtpTtlSeconds,
      invalidOtpMessage: 'Invalid OTP',
      tooManyAttemptsMessage: 'Too many incorrect attempts, please sign up again',
    });

    let user = await this.authRepository.findUserByPhone(phoneNumber);
    if (!user) {
      const roleId = await this.roleService.findRoleIdByName(ORG_ADMIN_ROLE);
      user = await this.authRepository.createUser({
        phoneNumber,
        tenantId: null,
        roleId,
        whatsappOptIn: input.whatsappOptIn ?? true,
      });
    }

    await this.authRepository.touchLastSignedIn(user.id);
    return this.issueTokenPairForUser(user, 'organization', {
      fcmToken: input.fcmToken,
      deviceType: input.deviceType,
      deviceInfo: input.deviceInfo,
      ipAddress: input.ipAddress,
    });
  }

  async requestLoginOtp(input: RequestLoginOtpInput) {
    const phoneNumber = this.normalizePhone(input.phoneNumber);
    const user = await this.authRepository.findUserByPhone(phoneNumber);
    if (!user) {
      throw new AuthenticationError('User is not registered');
    }

    this.assertPortalAccess(user, input.portal);

    await this.otpService.requestOtpCode({
      phoneNumber,
      purpose: 'login',
      cooldownSeconds: env.loginOtpResendCooldownSeconds,
      ipAddress: input.ipAddress,
    });
    const loginToken = signToken(
      { phoneNumber, purpose: 'login', portal: input.portal },
      env.loginOtpTtlSeconds,
    );

    return {
      loginToken,
      expiresIn: env.loginOtpTtlSeconds,
      message: `OTP sent to ${phoneNumber}`,
    };
  }

  async verifyLoginOtp(input: VerifyLoginOtpInput) {
    const { phoneNumber, otp } = input;

    await this.otpService.verifyOtpCode({
      phoneNumber,
      otp,
      purpose: 'login',
      ttlSeconds: env.loginOtpTtlSeconds,
      invalidOtpMessage: 'Invalid OTP',
      tooManyAttemptsMessage: 'Too many incorrect attempts, please request a new login OTP',
    });

    const user = await this.authRepository.findUserByPhone(phoneNumber);
    if (!user) {
      throw new AuthenticationError('Invalid or expired login OTP');
    }

    return this.buildAuthSession(user, input.portal, {
      fcmToken: input.fcmToken,
      deviceType: input.deviceType,
      deviceInfo: input.deviceInfo,
      ipAddress: input.ipAddress,
    });
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
    try {
      const existingByEmail = input.email
        ? await this.authRepository.findUserByEmail(input.email)
        : null;
      if (existingByEmail && existingByEmail.id !== user.id) {
        throw new ConflictError('A user with this email already exists');
      }

      const updated = await this.dataSource.transaction(async (manager) => {
        const current = await manager.getRepository(UserEntity).findOne({
          where: { id: user.id, deletedAt: IsNull() },
          relations: { role: true },
        });
        if (!current) {
          throw new NotFoundError(`User ${user.id} not found`);
        }

        if (input.password && current.passwordHash) {
          throw new ConflictError('Password already exists');
        }

        const nextUser = await this.authRepository.updateUser(
          user.id,
          {
            fullName: input.name,
            email: input.email ?? null,
            designation: input.designation ?? null,
            manualDesignation: input.manualDesignation ?? null,
            department: input.department ?? null,
          },
          manager,
        );

        if (input.password) {
          const passwordHash = await bcrypt.hash(input.password, 10);
          await this.authRepository.setUserPassword(nextUser.id, passwordHash, manager);
        }

        return nextUser;
      });

      if (!updated) {
        throw new NotFoundError(`User ${user.id} not found`);
      }

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
    } catch (error) {
      rethrow(error, 'Failed to save user details');
    }
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
      whatsappOptIn: user.whatsappOptIn,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  /** WhatsApp notification consent (see user.entity.ts) — the "collect opt-in at first login"
   *  path for users who didn't give it at signup, and the way to opt out later. */
  async updateWhatsappOptIn(user: AuthenticatedUser, optIn: boolean) {
    try {
      const current = await this.getUserById(user.id);
      await this.authRepository.setWhatsappOptIn(user.id, optIn);

      await this.auditService.log({
        tenantId: user.tenantId,
        userId: user.id,
        action: 'USER_WHATSAPP_OPT_IN_UPDATED',
        resourceType: 'user',
        oldData: { whatsappOptIn: current.whatsappOptIn },
        newData: { whatsappOptIn: optIn },
      });

      return { whatsappOptIn: optIn };
    } catch (error) {
      rethrow(error, 'Failed to update WhatsApp opt-in');
    }
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

    // Every salesperson needs their own code to attribute signups — made here so hiring and code
    // creation are one action.
    const referralCode =
      role.name === SALES_ROLE ? await this.createHireReferralCode(actingUser, user) : null;

    return {
      id: user.id,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      email: user.email,
      role: user.role.name,
      coverage: user.coverage,
      permissions: await this.roleService.getEffectivePermissions(user.id),
      // The salesperson's code, made at hire — null for other roles, or if it couldn't be made
      // (the hire still stands; the admin can generate one from Referral Codes).
      referralCode: referralCode ? { id: referralCode.id, code: referralCode.code } : null,
      createdAt: user.createdAt,
    };
  }

  private async createHireReferralCode(
    actingUser: AuthenticatedUser,
    user: ReferralCodeOwner,
  ): Promise<ReferralCodeEntity | null> {
    try {
      const referralCode = await this.referralCodeService.createForSalesperson(user, actingUser.id);
      await this.auditService.log({
        tenantId: null,
        userId: actingUser.id,
        action: 'REFERRAL_CODE_CREATED',
        resourceType: 'referral_code',
        newData: {
          id: referralCode.id,
          code: referralCode.code,
          ownerUserId: referralCode.ownerUserId,
          validUntil: referralCode.validUntil,
          createdAtHire: true,
        },
      });
      return referralCode;
    } catch (error) {
      console.error(`Failed to create a referral code for new salesperson ${user.id}`, error);
      return null;
    }
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

    const organization = await this.organizationService.getOrganizationStatus(actingUser.tenantId);
    if (!isTenantWriteAccessible(organization.status)) {
      throw new AuthorizationError(
        `Organization is ${humanizeStatus(organization.status)} and cannot invite teammates until it is approved`,
      );
    }

    const { fullName, phoneNumber, roleId } = input;
    const email = input.email.trim().toLowerCase();

    const role = await this.roleService.getRoleById(roleId);
    if (!ORG_ASSIGNABLE_ROLES.includes(role.name)) {
      throw new ValidationError(
        `Role "${role.name}" cannot be assigned through an org invite — must be one of: ${ORG_ASSIGNABLE_ROLES.join(', ')}`,
      );
    }

    const normalizedPhone = this.normalizePhone(phoneNumber);
    const existingByPhone = await this.authRepository.findUserByPhone(normalizedPhone);
    if (existingByPhone) throw new ConflictError('A user with this phone number already exists');
    if (await this.authRepository.findUserByEmail(email))
      throw new ConflictError('A user with this email already exists');

    const { active, invited } = await this.authRepository.countOrganizationUsersByState(
      actingUser.tenantId,
    );
    const seatsOnPlan = organization.seatLimit ?? DEFAULT_ORG_SEAT_LIMIT;
    if (active + invited >= seatsOnPlan)
      throw new ConflictError('No seats free on your plan', { seatsOnPlan });
    const basedAtLoadingPointId = await this.resolveBasedAt(
      actingUser.tenantId,
      input.basedAtLoadingPointId,
    );

    const password = this.generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);
    const created = await this.authRepository.createUser({
      phoneNumber: normalizedPhone,
      tenantId: actingUser.tenantId,
      roleId,
      email,
      passwordHash,
      fullName,
      coverage: null,
    });
    if (basedAtLoadingPointId)
      await this.authRepository.setBasedAt(created.id, basedAtLoadingPointId);
    const user = (await this.authRepository.findOrganizationUser(actingUser.tenantId, created.id))!;

    await this.auditService.log({
      tenantId: actingUser.tenantId,
      userId: actingUser.id,
      action: 'ORG_USER_INVITED',
      resourceType: 'user',
      newData: {
        id: user.id,
        fullName,
        email,
        phoneNumber: user.phoneNumber,
        role: role.name,
        basedAtLoadingPointId,
      },
    });

    await this.notifyTeamMemberInvited(actingUser, organization, user.id);

    return {
      ...this.toOrganizationUserRow(user),
      role: user.role.name,
      temporaryPassword: password,
      permissions: await this.roleService.getEffectivePermissions(user.id),
      createdAt: user.createdAt,
    };
  }

  /** Best-effort LS_N_0005 "team member invited" to the invitee — says what they can do (their
   *  effective capabilities, described), never their role or password. Only the enqueue happens
   *  here (see notification-triggers.ts); even that failing must never fail the invite, so it's
   *  logged, not rethrown. */
  private async notifyTeamMemberInvited(
    actingUser: AuthenticatedUser,
    organization: OrganizationEntity,
    invitedUserId: string,
  ): Promise<void> {
    try {
      const [inviter, capabilityKeys] = await Promise.all([
        this.authRepository.findUserById(actingUser.id),
        this.roleService.getEffectivePermissions(invitedUserId),
      ]);
      const capabilities = await this.roleService.describePermissions([...capabilityKeys].sort());
      await this.notificationTriggers.enqueue('organization.team_member_invited', organization.id, {
        userId: invitedUserId,
        inviterName: inviter?.fullName || 'Your admin',
        orgName: organizationDisplayName(organization),
        capabilitySummary: joinCapabilities(capabilities),
      });
    } catch (error) {
      console.warn(`Failed to queue team-invite notification for user ${invitedUserId}`, error);
    }
  }

  async listOrganizationUsers(actingUser: AuthenticatedUser, input: ListOrganizationUsersInput) {
    const tenantId = this.requireOrgContext(actingUser);
    const { items, total } = await this.authRepository.listOrganizationUsers(tenantId, input);
    return {
      items: items.map((user) => ({
        ...this.toOrganizationUserRow(user),
        // Kept for older clients of this endpoint.
        role: user.role.name,
      })),
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    };
  }

  /** Settings → Users & Roles row: seat, "Based at", Active/Invited and last sign-in. */
  private toOrganizationUserRow(user: UserEntity) {
    return {
      id: user.id,
      fullName: user.fullName,
      email: user.email,
      phoneNumber: user.phoneNumber,
      seat: { roleId: user.role.id, name: user.role.name, label: seatLabel(user.role.name) },
      basedAt: user.basedAtLoadingPoint
        ? {
            loadingPointId: user.basedAtLoadingPoint.id,
            title: user.basedAtLoadingPoint.title,
            city: user.basedAtLoadingPoint.city,
          }
        : null,
      state: (user.lastSignedInAt ? 'active' : 'invited') as 'active' | 'invited',
      lastSignedInAt: user.lastSignedInAt,
      createdAt: user.createdAt,
    };
  }

  private requireOrgContext(actingUser: AuthenticatedUser): string {
    if (!actingUser.tenantId) {
      throw new AuthorizationError('This resource requires an organization context');
    }
    return actingUser.tenantId;
  }

  /** "Based at" must be a live, non-rejected loading point of the same tenant (or cleared). */
  private async resolveBasedAt(
    tenantId: string,
    loadingPointId: string | null | undefined,
  ): Promise<string | null> {
    if (!loadingPointId) return null;
    const point = await this.dataSource.getRepository(LoadingPointEntity).findOneBy({
      id: loadingPointId,
      tenantId,
      deletedAt: IsNull(),
    });
    if (!point || point.status === 'rejected' || point.status === 'inactive')
      throw new ValidationError(`Loading point ${loadingPointId} is not an active site`);
    return point.id;
  }

  /** KPI tiles: active users, invited, seats on the plan, seats free. */
  async organizationUsersSummary(actingUser: AuthenticatedUser) {
    const tenantId = this.requireOrgContext(actingUser);
    const [{ active, invited }, organization] = await Promise.all([
      this.authRepository.countOrganizationUsersByState(tenantId),
      this.organizationService.getOrganizationStatus(tenantId),
    ]);
    const seatsOnPlan = organization.seatLimit ?? DEFAULT_ORG_SEAT_LIMIT;
    return {
      activeUsers: active,
      invitedUsers: invited,
      seatsOnPlan,
      seatsFree: Math.max(0, seatsOnPlan - active - invited),
    };
  }

  /** "What each seat opens" — every organization seat (org_admin included) with its user count,
   *  screen count, groups and summary line (SEAT_SCREEN_CATALOG). */
  async listOrganizationSeats(actingUser: AuthenticatedUser) {
    const tenantId = this.requireOrgContext(actingUser);
    const [roles, counts] = await Promise.all([
      this.roleService.listRoles(actingUser, { scope: 'organization' }),
      this.authRepository.countOrganizationUsersByRole(tenantId),
    ]);
    return roles
      .filter((role) => SEAT_SCREEN_CATALOG[role.name])
      .map((role) => {
        const seat = SEAT_SCREEN_CATALOG[role.name];
        return {
          roleId: role.id,
          name: role.name,
          label: seat.label,
          assignable: ORG_ASSIGNABLE_ROLES.includes(role.name),
          userCount: counts.get(role.name) ?? 0,
          screenCount: seat.screens.length,
          screens: seat.screens,
          groups: seat.groups,
          summary: seat.summary,
        };
      });
  }

  /** "Change Seat": new seat (an ORG_ASSIGNABLE_ROLES role) and/or "Based at". An org_admin's
   *  seat itself is never changed here — only their Based at. Role changes go through
   *  RoleService.assignRole, which bumps permissionsVersion and forces re-auth. */
  async changeOrganizationUserSeat(
    actingUser: AuthenticatedUser,
    userId: string,
    input: ChangeOrganizationUserSeatInput,
  ) {
    if (actingUser.role !== ORG_ADMIN_ROLE) {
      throw new AuthorizationError('Only an org admin can change seats');
    }
    const tenantId = this.requireOrgContext(actingUser);
    const target = await this.authRepository.findOrganizationUser(tenantId, userId);
    if (!target) throw new NotFoundError(`User ${userId} not found`);

    const oldData = {
      role: target.role.name,
      basedAtLoadingPointId: target.basedAtLoadingPointId,
    };
    if (input.roleId && input.roleId !== target.roleId) {
      if (target.role.name === ORG_ADMIN_ROLE)
        throw new ValidationError("An org admin's seat cannot be changed");
      const role = await this.roleService.getRoleById(input.roleId);
      if (!ORG_ASSIGNABLE_ROLES.includes(role.name))
        throw new ValidationError(
          `Seat "${role.name}" cannot be assigned — must be one of: ${ORG_ASSIGNABLE_ROLES.join(', ')}`,
        );
      await this.roleService.assignRole(actingUser, userId, input.roleId);
    }
    if (input.basedAtLoadingPointId !== undefined) {
      await this.authRepository.setBasedAt(
        userId,
        await this.resolveBasedAt(tenantId, input.basedAtLoadingPointId),
      );
    }
    const updated = (await this.authRepository.findOrganizationUser(tenantId, userId))!;
    await this.auditService.log({
      tenantId,
      userId: actingUser.id,
      action: 'ORG_USER_SEAT_CHANGED',
      resourceType: 'user',
      oldData: { id: userId, ...oldData },
      newData: {
        id: userId,
        role: updated.role.name,
        basedAtLoadingPointId: updated.basedAtLoadingPointId,
      },
    });
    return this.toOrganizationUserRow(updated);
  }

  /** "Remove User — access ends at once. Everything they recorded keeps their name on it."
   *  Soft-deletes the user and revokes every session (same mechanics as deleteStaff). */
  async removeOrganizationUser(actingUser: AuthenticatedUser, userId: string) {
    if (actingUser.role !== ORG_ADMIN_ROLE) {
      throw new AuthorizationError('Only an org admin can remove teammates');
    }
    const tenantId = this.requireOrgContext(actingUser);
    if (userId === actingUser.id) throw new AuthorizationError('You cannot remove yourself');
    const target = await this.authRepository.findOrganizationUser(tenantId, userId);
    if (!target) throw new NotFoundError(`User ${userId} not found`);
    if (target.role.name === ORG_ADMIN_ROLE)
      throw new ValidationError('An org admin cannot be removed here');

    await this.authRepository.softDeleteUser(userId);
    await this.authRepository.revokeAllRefreshTokensForUser(userId);
    await invalidateUserExistsCache(userId);

    await this.auditService.log({
      tenantId,
      userId: actingUser.id,
      action: 'ORG_USER_REMOVED',
      resourceType: 'user',
      oldData: {
        id: target.id,
        fullName: target.fullName,
        email: target.email,
        phoneNumber: target.phoneNumber,
        role: target.role.name,
      },
    });
    await this.notifyAccessRemoved(actingUser, tenantId, target);
  }

  /** Best-effort LS_N_0007 "access removed": an email to the removed user and an in-app
   *  confirmation to the admin. Only the enqueue happens here; even that failing must never fail
   *  the removal, so it's logged, not rethrown. Org users hold no loads of their own yet, so
   *  "where the open work went" is the removing admin. */
  private async notifyAccessRemoved(
    actingUser: AuthenticatedUser,
    tenantId: string,
    target: UserEntity,
  ): Promise<void> {
    try {
      const [admin, organization] = await Promise.all([
        this.authRepository.findUserById(actingUser.id),
        this.organizationService.getOrganizationStatus(tenantId),
      ]);
      const adminName = admin?.fullName || 'Your admin';
      const context: AccessRemovedContext = {
        userId: target.id,
        userName: target.fullName || target.phoneNumber,
        adminUserId: actingUser.id,
        adminName,
        orgName: organizationDisplayName(organization),
        reassignedTo: adminName,
      };
      await Promise.all([
        this.notificationTriggers.enqueue('user.access_removed', tenantId, context),
        this.notificationTriggers.enqueue('user.access_removed_confirmation', tenantId, context),
      ]);
      traceNotification(
        'user.access_removed',
        `queued for removed user ${target.id} (email${target.email ? '' : ' — no email on file, nothing will go out'}) and admin ${actingUser.id} (in-app)`,
      );
    } catch (error) {
      warnNotification(
        'user.access_removed',
        `Failed to queue access-removed notification for user ${target.id}`,
        error,
      );
    }
  }

  /** Users table "Export CSV". */
  async exportOrganizationUsers(
    actingUser: AuthenticatedUser,
    filters: Omit<ListOrganizationUsersInput, 'page' | 'limit'>,
  ): Promise<string> {
    const tenantId = this.requireOrgContext(actingUser);
    const { items } = await this.authRepository.listOrganizationUsers(tenantId, {
      ...filters,
      page: 1,
      limit: CSV_EXPORT_MAX_ROWS,
    });
    return buildCsv(
      [
        { header: 'Name', value: (row) => row.fullName },
        { header: 'Email', value: (row) => row.email },
        { header: 'Phone', value: (row) => row.phoneNumber },
        { header: 'Seat', value: (row) => row.seat.label },
        { header: 'Based At', value: (row) => row.basedAt?.title },
        { header: 'State', value: (row) => row.state },
        { header: 'Last Signed In', value: (row) => row.lastSignedInAt?.toISOString() },
        { header: 'Added On', value: (row) => row.createdAt.toISOString().slice(0, 10) },
      ],
      items.map((user) => this.toOrganizationUserRow(user)),
    );
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

  // Same "thin wrapper, external callers depend on AuthService not AuthRepository" rule as
  // getUserById above, batched variant — for the loads module's audit-trail actor names.
  async getUsersByIds(userIds: string[]) {
    return this.authRepository.findByIds(userIds);
  }

  /** Contact numbers used by the driver trip-detail call actions. */
  async getOrganizationContactPhones(tenantId: string): Promise<{
    ownerPhoneNumber: string | null;
    dispatchPhoneNumber: string | null;
  }> {
    const users = await this.authRepository.listUsersByRole(tenantId, [
      ORG_ADMIN_ROLE,
      DISPATCH_ROLE,
    ]);

    return {
      ownerPhoneNumber:
        users.find((user) => user.role.name === ORG_ADMIN_ROLE)?.phoneNumber ?? null,
      dispatchPhoneNumber:
        users.find((user) => user.role.name === DISPATCH_ROLE)?.phoneNumber ?? null,
    };
  }

  // Called any time the client's FCM token changes independent of login (Firebase's own
  // onNewToken/didReceiveRegistrationToken callback) — keyed by the calling access token's `sid`
  // claim (the underlying refresh-token row's own id), so no refreshToken needs to be sent, just
  // the new value. A stale sid (session since revoked/expired, access token not yet expired)
  // 404s rather than silently no-op-ing.
  async updateDeviceToken(sid: string, fcmToken: string, deviceType: DevicePlatform) {
    const updated = await this.authRepository.updateSessionDeviceInfo(sid, {
      fcmToken,
      deviceType,
    });
    if (!updated) throw new NotFoundError('No active session found');
  }

  // Future producers (e.g. a maintenance/loads module wanting to push to a user) call this
  // directly — same "consumer takes producer service directly" pattern as getUserById above. Not
  // wired to anything yet.
  async getActiveDeviceTokensForUser(userId: string) {
    return this.authRepository.findActiveByUserId(userId);
  }

  async listStaffUsers(input: { search?: string; role?: string; page: number; limit: number }) {
    const { items, total } = await this.authRepository.listStaffUsers(input);
    return {
      items: await this.toStaffListItems(items),
      page: input.page,
      limit: input.limit,
      total,
      totalPages: Math.ceil(total / input.limit),
    };
  }

  /** One staff member in the same shape as a listStaffUsers item — the admin edit screen. */
  async getStaffUser(staffId: string) {
    const user = await this.authRepository.findStaffUserById(staffId);
    if (!user) throw new NotFoundError(`Staff member ${staffId} not found`);
    const [item] = await this.toStaffListItems([user]);
    return item;
  }

  private async toStaffListItems(users: UserEntity[]) {
    const staffIds = users.map((user) => user.id);
    // Batched, not per-row — fixed number of extra queries for the whole page, keyed by
    // owner/staff id, run concurrently.
    const [codesByOwner, signupsByOwner, workloadByStaff] = await Promise.all([
      this.referralCodeService.listByOwnerIds(staffIds),
      this.organizationService.countSignupsByReferralCodeOwnerIds(staffIds),
      this.organizationService.countPendingKycAssignmentsByStaffIds(staffIds),
    ]);
    return users.map((user) => ({
      id: user.id,
      fullName: user.fullName,
      phoneNumber: user.phoneNumber,
      email: user.email,
      role: user.role.name,
      coverage: user.coverage,
      referralCodes: codesByOwner.get(user.id) ?? [],
      // Submitted orgs that used any of this staff member's referral codes, and how many of
      // those are approved — same numbers as the Referral Codes list.
      signupCount: signupsByOwner.get(user.id)?.total ?? 0,
      approvedSignupCount: signupsByOwner.get(user.id)?.approved ?? 0,
      // Orgs assigned to this staff member for KYC review (online or physical) not yet completed —
      // the only "current work" concept this schema has; non-KYC roles are always 0.
      workload: workloadByStaff.get(user.id) ?? 0,
      createdAt: user.createdAt,
    }));
  }

  /** Per-role cards on the admin Employees screen: headcount, open KYC assignments (KYC roles)
   *  and referral signups (sales) — across all staff, not just the loaded page. */
  async getStaffSummary(): Promise<Record<string, StaffRoleSummary>> {
    const staff = await this.authRepository.listAllStaffRoles();
    const staffIds = staff.map((member) => member.id);
    const [signupsByOwner, workloadByStaff] = await Promise.all([
      this.organizationService.countSignupsByReferralCodeOwnerIds(staffIds),
      this.organizationService.countPendingKycAssignmentsByStaffIds(staffIds),
    ]);
    const summary: Record<string, StaffRoleSummary> = {};
    for (const role of STAFF_ASSIGNABLE_ROLES) {
      summary[role] = { count: 0, workload: 0, signups: 0, approvedSignups: 0 };
    }
    for (const member of staff) {
      const roleSummary = summary[member.role];
      if (!roleSummary) continue; // e.g. platform_admin
      roleSummary.count += 1;
      roleSummary.workload += workloadByStaff.get(member.id) ?? 0;
      roleSummary.signups += signupsByOwner.get(member.id)?.total ?? 0;
      roleSummary.approvedSignups += signupsByOwner.get(member.id)?.approved ?? 0;
    }
    return summary;
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

    // Checked before any mutation below: role assignment and permission grants/revokes each
    // commit immediately and force-invalidate the target's session (a permissions_version bump),
    // so a phone/email conflict discovered afterward would otherwise leave that already
    // committed while the caller sees this whole request reported as failed.
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
    return this.loginWithPhone(input.phoneNumber, input.password, input.portal, ipAddress, {
      fcmToken: input.fcmToken,
      deviceType: input.deviceType,
      deviceInfo: input.deviceInfo,
    });
  }

  async refresh(input: RefreshInput) {
    const { refreshToken } = input;

    const tokenHash = hashToken(refreshToken);
    const stored = await this.authRepository.claimRefreshToken(tokenHash, input.portal);
    if (!stored) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    const user = await this.authRepository.findUserById(stored.userId);
    if (!user) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    if (stored.portal !== input.portal) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    // Carries the old row's device/push data forward onto the new row this creates — the new
    // row's own id becomes the new access token's `sid` automatically (see issueTokenPair), no
    // separate session identifier needs to be preserved across rotation.
    return this.buildAuthSession(user, input.portal, {
      fcmToken: stored.fcmToken,
      deviceType: stored.deviceType,
      deviceInfo: stored.deviceInfo,
      ipAddress: stored.ipAddress,
    });
  }

  // Keyed by the caller's own `sid` claim — a verified JWT claim, never client-suppliable, so
  // (unlike the old refreshToken-lookup approach) there's no separate ownership check needed:
  // sid can only ever be a value the server itself signed into that exact user's own session.
  async logout(input: LogoutInput) {
    const { sid, jti, exp } = input;

    if (sid) {
      await this.authRepository.revokeRefreshToken(sid);
    }

    await blockToken(jti, exp);
  }

  async deleteAccount(user: AuthenticatedUser) {
    await this.authRepository.softDeleteUser(user.id);
    await this.authRepository.revokeAllRefreshTokensForUser(user.id);
    await blockToken(user.jti, user.exp);
    await invalidateUserExistsCache(user.id);
  }

  // Called by admin.service.ts whenever an org's status becomes rejected/suspended, so every
  // member's stored refresh token stops working immediately instead of waiting for it to expire
  // naturally. Unlike deleteAccount above, this acts on other users' sessions (not the caller's
  // own), so there's no single jti to blocklist here — see assertOrganizationActiveForLogin for
  // the complementary check that also blocks a rejected/suspended org's login/refresh outright.
  async revokeAllSessionsForTenant(tenantId: string): Promise<void> {
    await this.authRepository.revokeAllRefreshTokensForTenant(tenantId);
  }

  async getOrganization(tenantId: string) {
    const [organization, documents] = await Promise.all([
      this.organizationService.getOrganizationStatus(tenantId),
      this.organizationDocumentService.listByOrganization(tenantId),
    ]);
    return this.organizationOnboardingService.buildOrganizationResponse(organization, documents);
  }

  async getBusinessDetails(tenantId: string) {
    return this.getOrganization(tenantId);
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
        throw new AuthorizationError(
          `Organization is ${humanizeStatus(current.status)} and cannot be updated`,
        );
      }
      if (current.status === 'pending' || current.status === 'active' || current.submittedAt) {
        // Already past this step (e.g. the user navigated back after submitting). Rather than
        // hard-blocking, return the organization as-is so the caller can redirect forward to
        // wherever onboarding actually is instead of dead-ending on a resubmit error.
        const documents = await this.organizationDocumentService.listByOrganization(tenantId);
        return this.organizationOnboardingService.buildOrganizationResponse(current, documents);
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
        'organization',
      );
      await this.auditService.log(
        {
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
        },
        manager,
      );
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
      documentFront: Express.Multer.File[];
      shopPremisesPhoto?: Express.Multer.File;
      documentFrontKeys?: string[];
      shopPremisesPhotoKey?: string;
    },
  ) {
    if (!user.tenantId) {
      throw new AuthorizationError('Missing organization context');
    }

    const current = await this.organizationService.getOrganizationStatus(user.tenantId);
    if (!isTenantAccessible(current.status)) {
      throw new AuthorizationError(
        `Organization is ${humanizeStatus(current.status)} and cannot be updated`,
      );
    }
    if (current.status === 'active' || (current.submittedAt && current.status !== 'pending')) {
      // Already past this step (e.g. the user navigated back after submitting). Rather than
      // hard-blocking, return the organization as-is so the caller can redirect forward to
      // wherever onboarding actually is instead of dead-ending on a resubmit error.
      const documents = await this.organizationDocumentService.listByOrganization(user.tenantId);
      return this.organizationOnboardingService.buildOrganizationResponse(current, documents);
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
        // Same as above: verification genuinely pending with nothing to correct, so return
        // current state instead of an error the UI has no good way to recover from.
        return this.organizationOnboardingService.buildOrganizationResponse(
          current,
          existingDocuments,
        );
      }
    }

    const tenantId = user.tenantId;
    if (!tenantId) {
      throw new AuthorizationError('Missing organization context');
    }

    const pdfFiles = files.documentFront.filter((file) => file.mimetype === 'application/pdf');
    const imageFiles = files.documentFront.filter((file) =>
      ['image/jpeg', 'image/jpg', 'image/png'].includes(file.mimetype),
    );
    if (pdfFiles.length > 0 && imageFiles.length > 0) {
      throw new ValidationError('Upload either one PDF or multiple images for the document');
    }
    if (pdfFiles.length > 0 && files.documentFront.length > 1) {
      throw new ValidationError('Only one PDF file can be uploaded for the document');
    }

    // The Verify click saves just the document number (no files, no photo) so the registry check
    // can start before the photo is uploaded. Every other save — the final "Continue", which
    // attaches the document files — must carry the shop-board premises photo, and submission
    // enforces it again (OrganizationOnboardingService.assertShopboardPremisesPhotoPresent).
    const isNumberOnlyVerification =
      Boolean(input.documentNo) &&
      files.documentFront.length === 0 &&
      (files.documentFrontKeys?.length ?? 0) === 0 &&
      !files.shopPremisesPhoto &&
      !files.shopPremisesPhotoKey;
    if (
      !isNumberOnlyVerification &&
      !files.shopPremisesPhoto &&
      !files.shopPremisesPhotoKey &&
      !current.shopboardPremisesPhotoKey
    ) {
      throw new ValidationError('Shop-board premises photo is required');
    }

    const [documentFrontFiles, shopPremisesPhoto] = await Promise.all([
      Promise.all(
        files.documentFront.map((file) =>
          this.storageService.uploadTenantFile(
            tenantId,
            user.id,
            {
              purpose: 'kyc',
              fileName: file.originalname,
              mimeType: file.mimetype,
              sizeBytes: file.size,
            },
            file.buffer,
          ),
        ),
      ),
      files.shopPremisesPhoto
        ? this.storageService.uploadTenantFile(
            tenantId,
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
    const documentFrontKeys = files.documentFrontKeys ?? [];
    const shopPremisesPhotoKey = files.shopPremisesPhotoKey;
    const uploadedDocumentKeys = documentFrontFiles.map((file) => file.key);

    await Promise.all(
      documentFrontKeys.map(async (key) => {
        const { file } = await this.storageService.getByKey({ tenantId, role: user.role }, key);
        if (file.purpose !== 'kyc') {
          throw new ValidationError(`File ${key} was not uploaded for KYC`);
        }
        if (file.status !== 'confirmed') {
          throw new ValidationError(`File ${key} must be confirmed before it can be attached`);
        }
      }),
    );
    if (shopPremisesPhotoKey) {
      const { file } = await this.storageService.getByKey(
        { tenantId, role: user.role },
        shopPremisesPhotoKey,
      );
      if (!['kyc', 'organizations/shopboard-premises'].includes(file.purpose)) {
        throw new ValidationError(
          `File ${shopPremisesPhotoKey} was not uploaded for a supported organization document`,
        );
      }
      if (file.status !== 'confirmed') {
        throw new ValidationError(
          `File ${shopPremisesPhotoKey} must be confirmed before it can be attached`,
        );
      }
    }
    const documentUrls = [...documentFrontKeys, ...uploadedDocumentKeys];
    const shopPremisesKey = shopPremisesPhoto?.key ?? shopPremisesPhotoKey;

    let savedDocuments: Awaited<ReturnType<OrganizationDocumentService['upsertDocuments']>> = [];
    const response = await this.dataSource.transaction(async (manager) => {
      if (input.replaceDocumentType && input.replaceDocumentType !== input.documentType) {
        await this.organizationDocumentService.removeActiveDocumentType(
          tenantId,
          input.replaceDocumentType,
          user.id,
          manager,
        );
      }

      const organization = await this.organizationService.updateOrganization(
        tenantId,
        {
          ...(shopPremisesKey ? { shopboardPremisesPhotoKey: shopPremisesKey } : {}),
          status: current.status === 'draft' ? 'partial_pending' : current.status,
          onboardingStep: current.status === 'pending' ? 'business_details' : 'review_submit',
        },
        manager,
      );

      const documents = await this.organizationDocumentService.upsertDocuments(
        tenantId,
        user.id,
        [
          {
            documentType: input.documentType,
            documentNumber: input.documentNo,
            documentUrls,
            registeredAddress: input.registeredAddress,
          },
          ...(shopPremisesKey
            ? [
                {
                  documentType: 'shopboard_premises_photo' as const,
                  documentUrl: shopPremisesKey,
                },
              ]
            : []),
        ],
        manager,
      );
      savedDocuments = documents;

      await this.auditService.log(
        {
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
        },
        manager,
      );

      return this.organizationOnboardingService.buildOrganizationResponse(organization, documents);
    });

    // After commit so the worker can see the rows; GST/Udyam/CIN are verified via IDfy in the
    // background and flip to 'verified' on their own.
    await this.documentVerificationService.enqueueVerification(savedDocuments);
    return response;
  }

  async submitOrganization(user: AuthenticatedUser, input: SubmitOrganizationInput) {
    if (!user.tenantId) {
      throw new AuthorizationError('Missing organization context');
    }

    const current = await this.organizationService.getOrganizationStatus(user.tenantId);
    if (!isTenantAccessible(current.status)) {
      throw new AuthorizationError(
        `Organization is ${humanizeStatus(current.status)} and cannot be updated`,
      );
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
      // Already past this step (e.g. the user navigated back after submitting). Rather than
      // hard-blocking, return the organization as-is so the caller can redirect forward to
      // wherever onboarding actually is instead of dead-ending on a resubmit error.
      return this.organizationOnboardingService.buildOrganizationResponse(
        current,
        currentDocuments,
      );
    }

    const referralCodeId = input.referralCode
      ? (await this.referralCodeService.validateAndResolve(input.referralCode)).id
      : undefined;

    const { submitted, response } = await this.dataSource.transaction(async (manager) => {
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

      await this.auditService.log(
        {
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
        },
        manager,
      );

      const withStage = await this.organizationJourneyStageService.recordTransition(
        user.tenantId!,
        'application_submitted',
        user.id,
        manager,
      );

      return {
        submitted: withStage,
        response: this.organizationOnboardingService.buildOrganizationResponse(
          withStage,
          documents,
        ),
      };
    });

    // After commit, so the notification never references a submission that rolled back. First
    // submission only — a correction resubmission isn't a new signup (the catalog entry's
    // once_per_tenant frequency also guards against repeats).
    if (!isCorrectionResubmission) {
      await this.notifySignupReceived(submitted);
    }

    return response;
  }

  /** Best-effort LS_N_0002 "signup received, under review" to the signup contact — only the
   *  enqueue happens here (see notification-triggers.ts; the trigger worker retries the rest), and
   *  even that failing must never fail the submission, so it's logged, not rethrown. */
  private async notifySignupReceived(organization: OrganizationEntity): Promise<void> {
    try {
      await this.notificationTriggers.enqueue('organization.signup_received', organization.id, {
        orgName: organizationDisplayName(organization),
      });
    } catch (error) {
      console.warn(
        `Failed to queue signup-received notification for org ${organization.id}`,
        error,
      );
    }
  }

  private async loginWithPhone(
    phoneNumber: string,
    password: string,
    portal: LoginPortal,
    ipAddress: string | null,
    device?: Omit<DeviceContext, 'ipAddress'>,
  ) {
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

    return this.buildAuthSession(user, portal, { ...device, ipAddress });
  }

  private async buildAuthSession(
    user: UserEntity,
    portal: LoginPortal,
    device?: DeviceContext,
  ): Promise<AuthSession> {
    this.assertPortalAccess(user, portal);
    await this.assertOrganizationActiveForLogin(user);
    await this.authRepository.touchLastSignedIn(user.id);

    const permissions = await this.roleService.getEffectivePermissions(user.id);
    const tokens = await this.issueTokenPair(
      user.id,
      user.tenantId,
      user.role.name,
      permissions,
      user.permissionsVersion,
      portal,
      device,
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
        // null → consent never captured: the client shows the WhatsApp opt-in prompt now.
        whatsappOptIn: user.whatsappOptIn,
      },
      onboardingStatus: progress.onboardingStatus,
      onboardingStep: progress.onboardingStep,
      nextStep: progress.nextStep,
      portal,
    };
  }

  private assertPortalAccess(user: UserEntity, portal: LoginPortal): void {
    if (user.role.scope !== portal) {
      throw new AuthorizationError('This account cannot access this portal');
    }
  }

  private async assertOrganizationActiveForLogin(user: UserEntity): Promise<void> {
    // A new org admin has no organization yet and must be allowed to log in to complete
    // onboarding; platform-scope roles never have a tenantId either — both skip this check
    // entirely. Every other tenant-scoped user (org_admin or an invited teammate) is gated the
    // same way createTenantScope gates their per-request access — rejected/suspended orgs can't
    // log in or refresh at all; draft/pending/partial_pending orgs log in fine and get read-only
    // access instead (see isTenantWriteAccessible / TenancyGatewayLocal.assertTenantActive),
    // rather than being locked out of the app entirely while awaiting approval.
    if (!user.tenantId) return;

    const organization = await this.organizationService.getOrganizationStatus(user.tenantId);
    if (!isTenantAccessible(organization.status)) {
      const messages: Record<'rejected' | 'suspended', string> = {
        rejected: 'Organization verification was rejected.',
        suspended: 'Organization access is suspended.',
      };

      throw new AuthorizationError(messages[organization.status as 'rejected' | 'suspended']);
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

  /** Computes effective permissions for a user fresh (never trusts old token claims) and issues
   *  a token pair for them — the common path used by verifyOtp/login/refresh. */
  private async issueTokenPairForUser(
    user: {
      id: string;
      tenantId: string | null;
      role: { name: string };
      permissionsVersion: number;
    },
    portal: LoginPortal,
    device?: DeviceContext,
  ) {
    const permissions = await this.roleService.getEffectivePermissions(user.id);
    return this.issueTokenPair(
      user.id,
      user.tenantId,
      user.role.name,
      permissions,
      user.permissionsVersion,
      portal,
      device,
    );
  }

  private async issueTokenPair(
    userId: string,
    tenantId: string | null,
    role: string,
    permissions: string[],
    permissionsVersion: number,
    portal: LoginPortal,
    device?: DeviceContext,
  ) {
    // Created before the access token is signed, deliberately — issuing it needs this row's own
    // id for the access token's `sid` claim.
    const rawRefreshToken = randomBytes(40).toString('hex');
    const refreshTokenRow = await this.authRepository.createRefreshToken({
      userId,
      tokenHash: hashToken(rawRefreshToken),
      expiresAt: new Date(Date.now() + env.refreshTokenTtlMs),
      portal,
      fcmToken: device?.fcmToken,
      deviceType: device?.deviceType,
      deviceInfo: device?.deviceInfo,
      ipAddress: device?.ipAddress,
    });

    const jti = randomUUID();
    const accessToken = signToken(
      {
        id: userId,
        tenantId,
        role,
        permissions,
        permissionsVersion,
        jti,
        sid: refreshTokenRow.id,
        purpose: 'access',
        portal,
      },
      env.accessTokenTtlSeconds,
    );

    return { accessToken, refreshToken: rawRefreshToken };
  }
}
