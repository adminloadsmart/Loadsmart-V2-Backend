import { randomBytes, randomInt, randomUUID, createHash } from 'crypto';
import { DataSource, EntityManager } from 'typeorm';
import bcrypt from 'bcryptjs';
import { env } from '../../config/env';
import { AuthenticationError, AuthorizationError, ConflictError, NotFoundError, RateLimitError, ValidationError } from '../../shared/errors';
import { AuthenticatedUser } from '../../shared/middleware/request.types';
import { signToken, hashToken } from '../../shared/utils/token';
import { blockToken } from '../../shared/utils/token-blocklist';
import { invalidateUserExistsCache } from '../../shared/utils/user-existence-cache';
import { OrganizationService } from './organization.service';
import { OrganizationDocumentService } from './organization-document.service';
import { OrganizationStatus } from './entities/organization.entity';
import { OrganizationDocumentInput } from './entities/organization-document.entity';
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
  CompleteCompanyProfileInput,
} from './auth.types';

export class AuthService {
  constructor(
    private readonly authRepository: AuthRepository,
    private readonly organizationService: OrganizationService,
    private readonly organizationDocumentService: OrganizationDocumentService,
    private readonly referralCodeService: ReferralCodeService,
    private readonly roleService: RoleService,
    private readonly auditService: AuditService,
    private readonly dataSource: DataSource,
  ) { }

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


  /** Platform admin provisions an internal staff account directly (POST /admin/staff) — the only
   *  user-creation path that isn't self-service. Unlike self-signup, phone ownership is never
   *  proven via OTP here, so both phone and email get pre-checked for collisions. The admin sets
   *  an initial password; the staff member logs in themselves via the existing POST /auth/login —
   *  this method never issues a token pair, since the admin isn't the one logging in.
   *
   *  Takes the full acting AuthenticatedUser, not just an id — permissionIds grants below reuse
   *  roleService.grantPermission, which needs the actor's own role/tenantId to run its
   *  assertCanManage scope check (this is also what correctly rejects granting an
   *  organization-scope permission here, since staff are always platform-scope). Not wrapped in a
   *  DB transaction with the user creation: the account stays valid even if one permissionId in
   *  the list is bad (wrong scope, or doesn't exist) — that grant just fails and the admin retries
   *  it alone via POST /roles/users/:id/permissions, same endpoint this reuses internally. */
  async createStaffUser(actingUser: AuthenticatedUser, input: CreateStaffInput) {
    const { fullName, phoneNumber, email, roleId, coverage, permissionIds } = input;

    const role = await this.roleService.getRoleById(roleId);
    if (!STAFF_ASSIGNABLE_ROLES.includes(role.name)) {
      throw new ValidationError(
        `Role "${role.name}" cannot be assigned through staff creation — must be one of: ${STAFF_ASSIGNABLE_ROLES.join(', ')}`,
      );
    }

    const [existingByPhone, existingByEmail] = await Promise.all([
      this.authRepository.findUserByPhone(phoneNumber),
      this.authRepository.findUserByEmail(email),
    ]);
    if (existingByPhone) throw new ConflictError('A user with this phone number already exists');
    if (existingByEmail) throw new ConflictError('A user with this email already exists');
    let password = this.generatePassword();
    const passwordHash = await bcrypt.hash(password, 10);
    const user = await this.authRepository.createUser({
      phoneNumber,
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
      newData: { id: user.id, fullName, phoneNumber, email, role: role.name, coverage },
    });

    // Dedupe defensively so an accidental repeat in the request doesn't 409 against itself on
    // its second occurrence — each grant below audits its own PERMISSION_GRANTED entry.
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
    const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const lower = "abcdefghijklmnopqrstuvwxyz";
    const number = "0123456789";
    const special = "!@#$%^&*";

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
    const codesByOwner = await this.referralCodeService.listByOwnerIds(items.map((user) => user.id));
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
    const { email, password } = input;

    const recentFailures = await this.authRepository.countRecentFailedAttempts(email, ipAddress, LOGIN_ATTEMPT_WINDOW_MS);
    if (recentFailures >= MAX_FAILED_ATTEMPTS) {
      throw new AuthenticationError('Too many failed login attempts, try again later');
    }

    const user = await this.authRepository.findUserByEmail(email);
    // Always run a bcrypt.compare of comparable cost, even when there's no user/hash to check
    // against — otherwise a nonexistent email returns near-instantly while a real one takes the
    // usual tens-of-ms bcrypt round trip, letting an attacker enumerate valid emails purely from
    // response timing.
    const passwordMatches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_PASSWORD_HASH);

    await this.authRepository.recordLoginAttempt({ email, success: passwordMatches, ipAddress });

    if (!user || !passwordMatches) {
      throw new AuthenticationError('Invalid credentials');
    }

    const permissions = await this.roleService.getEffectivePermissions(user.id);
    const tokens = await this.issueTokenPair(user.id, user.tenantId, user.role.name, permissions);

    return {
      user: {
        id: user.id,
        fullName: user.fullName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        role: user.role.name,
        tenantId: user.tenantId,
        coverage: user.coverage,
      },
      permissions,
      ...tokens,
    };
  }

  async refresh(input: RefreshInput) {
    const { refreshToken } = input;

    const tokenHash = hashToken(refreshToken);
    // Atomically finds-and-revokes — see claimRefreshToken's comment — so the same refresh token
    // can't be used twice by concurrent requests racing the old separate find-then-revoke steps.
    const stored = await this.authRepository.claimRefreshToken(tokenHash);
    if (!stored) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    const user = await this.authRepository.findUserById(stored.userId);
    if (!user) {
      throw new AuthenticationError('Invalid or expired refresh token');
    }

    return this.issueTokenPairForUser(user);
  }

  async logout(input: LogoutInput) {
    const { refreshToken, userId, jti, exp } = input;

    const tokenHash = hashToken(refreshToken);
    const stored = await this.authRepository.findActiveRefreshTokenByHash(tokenHash);
    // Ownership check: without it, an authenticated caller who happens to be holding someone
    // else's raw refresh token could revoke that other user's session. Treated identically to
    // "not found" on a mismatch — no distinct error, no oracle for whether the token exists.
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
    return { ...organization, documents };
  }

  async createOrganization(userId: string, tenantId: string | null, input: CompleteCompanyProfileInput) {
    const {
      email,
      password,
      name,
      companyLegalName,
      orgAdminName,
      operationalCity,
      addressLine1,
      addressLine2,
      city,
      district,
      state,
      hasOwnFleet,
      fleetSize,
      documents,
      referralCode,
    } = input;

    const profileData = {
      name,
      status: 'pending' as OrganizationStatus,
      companyLegalName,
      orgAdminName,
      operationalCity,
      addressLine1,
      addressLine2: addressLine2 ?? null,
      city,
      district,
      state,
      hasOwnFleet,
      fleetSize: hasOwnFleet ? fleetSize ?? null : null,
    };

    if (tenantId) {
      // This route sits ahead of createTenantScope in the middleware chain (see app.ts), so
      // assertTenantActive never runs for it — check directly, or a rejected/suspended org could
      // keep resubmitting its profile indefinitely.
      const current = await this.organizationService.getOrganizationStatus(tenantId);
      if (!isTenantAccessible(current.status)) {
        throw new AuthorizationError(`Organization is ${current.status} and cannot be updated`);
      }

      const organization = await this.dataSource.transaction(async (manager) => {
        const updated = await this.organizationService.updateOrganization(tenantId, profileData, manager);
        await this.syncOrganizationDocuments(tenantId, userId, hasOwnFleet, documents, manager);
        return updated;
      });
      return { organization };
    }

    // First time only: this is also the org_admin's one chance to set login credentials — they
    // were created by verifyOtp with email/passwordHash both null, and there's no other route
    // that can ever set them (self-signup only proves phone ownership, never email).
    if (!email || !password) {
      throw new ValidationError('email and password are required to complete your company profile');
    }
    const existing = await this.authRepository.findUserByEmail(email);
    if (existing) {
      throw new ConflictError('A user with this email already exists');
    }

    // Resolved before hashing the password (and before opening the transaction) so a bad code
    // fails fast without the wasted bcrypt round trip. Attribution is set once, here, and never
    // re-editable — the tenantId-present branch above never touches referralCodeId.
    let referralCodeId: string | null = null;
    if (referralCode) {
      const resolved = await this.referralCodeService.validateAndResolve(referralCode);
      referralCodeId = resolved.id;
    }

    const passwordHash = await bcrypt.hash(password, 10);

    // First time: create the org, attach it to the user, set their credentials, and re-issue
    // tokens — all atomically, since the access token the caller is using right now still
    // carries tenantId: null.
    return this.dataSource.transaction(async (manager) => {
      const organization = await this.organizationService.createOrganization(
        { name: null, status: 'pending' },
        manager,
      );
      const updated = await this.organizationService.updateOrganization(
        organization.id,
        { ...profileData, referralCodeId },
        manager,
      );
      await this.syncOrganizationDocuments(organization.id, userId, hasOwnFleet, documents, manager);
      await this.authRepository.updateUserTenant(userId, organization.id, manager);
      await this.authRepository.setUserCredentials(userId, { email, passwordHash }, manager);
      const permissions = await this.roleService.getEffectivePermissions(userId);
      const tokens = await this.issueTokenPair(userId, organization.id, ORG_ADMIN_ROLE, permissions);
      return { organization: updated, ...tokens };
    });
  }

  // hasOwnFleet true → fleet-owning orgs don't need these documents tracked, so any existing ones
  // are cleared (mirrors the old behavior of nulling out gstin/documentUrl in that case).
  // hasOwnFleet false → replaces each submitted document type's active row (see
  // OrganizationDocumentRepository.replace for the soft-delete-then-insert semantics).
  private async syncOrganizationDocuments(
    organizationId: string,
    actingUserId: string,
    hasOwnFleet: boolean,
    documents: OrganizationDocumentInput[] | undefined,
    manager: EntityManager,
  ) {
    if (hasOwnFleet) {
      await this.organizationDocumentService.clearDocuments(organizationId, actingUserId, manager);
    } else if (documents?.length) {
      await this.organizationDocumentService.replaceDocuments(organizationId, actingUserId, documents, manager);
    }
  }

  /** Computes effective permissions for a user fresh (never trusts old token claims) and issues
   *  a token pair for them — the common path used by verifyOtp/login/refresh. */
  private async issueTokenPairForUser(user: { id: string; tenantId: string | null; role: { name: string } }) {
    const permissions = await this.roleService.getEffectivePermissions(user.id);
    return this.issueTokenPair(user.id, user.tenantId, user.role.name, permissions);
  }

  private async issueTokenPair(userId: string, tenantId: string | null, role: string, permissions: string[]) {
    const jti = randomUUID();
    const accessToken = signToken({ id: userId, tenantId, role, permissions, jti, purpose: 'access' }, env.accessTokenTtlSeconds);

    const rawRefreshToken = randomBytes(40).toString('hex');
    await this.authRepository.createRefreshToken({
      userId,
      tokenHash: hashToken(rawRefreshToken),
      expiresAt: new Date(Date.now() + env.refreshTokenTtlMs),
    });

    return { accessToken, refreshToken: rawRefreshToken };
  }
}
