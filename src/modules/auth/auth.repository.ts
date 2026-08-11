import {
  DataSource,
  EntityManager,
  FindOptionsWhere,
  ILike,
  IsNull,
  MoreThan,
  Repository,
} from 'typeorm';
import { UserEntity } from './entities/user.entity';
import { RefreshTokenEntity } from './entities/refresh-token.entity';
import { LoginAttemptEntity } from './entities/login-attempt.entity';
import { normalizePhoneNumber } from '../../shared/utils/phone-number';

export class AuthRepository {
  private readonly users: Repository<UserEntity>;
  private readonly refreshTokens: Repository<RefreshTokenEntity>;
  private readonly loginAttempts: Repository<LoginAttemptEntity>;

  constructor(dataSource: DataSource) {
    this.users = dataSource.getRepository(UserEntity);
    this.refreshTokens = dataSource.getRepository(RefreshTokenEntity);
    this.loginAttempts = dataSource.getRepository(LoginAttemptEntity);
  }

  // relations: { role: true } so callers always get a populated RoleEntity, never just a bare roleId.
  findUserByPhone(phoneNumber: string): Promise<UserEntity | null> {
    return this.users.findOne({
      where: { phoneNumber: normalizePhoneNumber(phoneNumber), deletedAt: IsNull() },
      relations: { role: true },
    });
  }

  findUserByEmail(email: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { email, deletedAt: IsNull() }, relations: { role: true } });
  }

  findUserById(id: string): Promise<UserEntity | null> {
    return this.users.findOne({ where: { id, deletedAt: IsNull() }, relations: { role: true } });
  }

  async createUser(
    data: {
      phoneNumber: string;
      tenantId: string | null;
      roleId: string;
      email?: string | null;
      passwordHash?: string | null;
      fullName?: string | null;
      coverage?: string | null;
    },
    manager?: EntityManager,
  ): Promise<UserEntity> {
    const users = manager ? manager.getRepository(UserEntity) : this.users;
    const user = users.create({
      phoneNumber: normalizePhoneNumber(data.phoneNumber),
      tenantId: data.tenantId,
      roleId: data.roleId,
      email: data.email ?? null,
      passwordHash: data.passwordHash ?? null,
      fullName: data.fullName ?? null,
      coverage: data.coverage ?? null,
      deletedAt: null,
    });
    const saved = await users.save(user);
    // save() only populates roleId, not the `role` relation — re-fetch so this return value
    // is consistent with the find methods above.
    return (await users.findOne({ where: { id: saved.id }, relations: { role: true } }))!;
  }

  // Platform-scope staff (sales/KYC desk/load console/platform_admin) specifically — not just
  // "tenantId IS NULL", since an org_admin mid-self-signup (hasn't completed their company
  // profile yet) also has a null tenantId at that point without being staff. role.scope is the
  // real distinguishing field.
  async listStaffUsers(filters: {
    search?: string;
    role?: string;
    page: number;
    limit: number;
  }): Promise<{ items: UserEntity[]; total: number }> {
    const { search, role, page, limit } = filters;
    const qb = this.users
      .createQueryBuilder('user')
      .innerJoinAndSelect('user.role', 'role')
      .where('user.tenant_id IS NULL')
      .andWhere('user.deleted_at IS NULL')
      .andWhere('role.scope = :scope', { scope: 'platform' })
      .orderBy('user.created_at', 'DESC')
      .skip((page - 1) * limit)
      .take(limit);

    if (search) {
      qb.andWhere('(user.full_name ILIKE :search OR user.email ILIKE :search)', {
        search: `%${search}%`,
      });
    }
    // Narrows to a specific role (e.g. 'online_kyc_desk') — used by the admin UI to populate
    // the KYC verifier/agent assignment dropdowns with only eligible staff.
    if (role) {
      qb.andWhere('role.name = :role', { role });
    }

    const [items, total] = await qb.getManyAndCount();
    return { items, total };
  }

  // Organization-scope counterpart to listStaffUsers above — every user (org_admin plus invited
  // teammates) belonging to one tenant, for Settings → Users & Roles.
  async listOrganizationUsers(
    tenantId: string,
    filters: { search?: string; role?: string; page: number; limit: number },
  ): Promise<{ items: UserEntity[]; total: number }> {
    const { search, role, page, limit } = filters;

    const base: FindOptionsWhere<UserEntity> = {
      tenantId,
      deletedAt: IsNull(),
      role: { scope: 'organization', ...(role ? { name: role } : {}) },
    };

    // Search spans two columns, so it becomes two OR'd where-clauses rather than one — same
    // approach driver.repository.ts's list() uses.
    const where: FindOptionsWhere<UserEntity>[] = search
      ? [
          { ...base, fullName: ILike(`%${search}%`) },
          { ...base, phoneNumber: ILike(`%${search}%`) },
        ]
      : [base];

    const [items, total] = await this.users.findAndCount({
      where,
      relations: { role: true },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total };
  }

  async softDeleteUser(userId: string): Promise<void> {
    await this.users.update({ id: userId }, { deletedAt: new Date() });
  }

  async updateUserTenant(userId: string, tenantId: string, manager?: EntityManager): Promise<void> {
    const users = manager ? manager.getRepository(UserEntity) : this.users;
    await users.update({ id: userId }, { tenantId });
  }

  async setUserCredentials(
    userId: string,
    data: { email: string; passwordHash: string },
    manager?: EntityManager,
  ): Promise<void> {
    const users = manager ? manager.getRepository(UserEntity) : this.users;
    await users.update({ id: userId }, { email: data.email, passwordHash: data.passwordHash });
  }

  async setUserPassword(
    userId: string,
    passwordHash: string,
    manager?: EntityManager,
  ): Promise<void> {
    const users = manager ? manager.getRepository(UserEntity) : this.users;
    await users.update({ id: userId }, { passwordHash });
  }

  async createRefreshToken(data: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<RefreshTokenEntity> {
    const token = this.refreshTokens.create({ ...data, revokedAt: null });
    return this.refreshTokens.save(token);
  }

  findActiveRefreshTokenByHash(tokenHash: string): Promise<RefreshTokenEntity | null> {
    return this.refreshTokens.findOneBy({
      tokenHash,
      revokedAt: IsNull(),
      expiresAt: MoreThan(new Date()),
    });
  }

  // Atomically finds-and-revokes in one UPDATE, unlike findActiveRefreshTokenByHash +
  // revokeRefreshToken as two separate calls — that gap let the same refresh token be used
  // twice by concurrent requests both passing the read check before either revoked it. Only the
  // request whose UPDATE actually matched a still-active row (affected === 1) wins the claim.
  async claimRefreshToken(tokenHash: string): Promise<RefreshTokenEntity | null> {
    const result = await this.refreshTokens
      .createQueryBuilder()
      .update(RefreshTokenEntity)
      .set({ revokedAt: () => 'now()' })
      .where('token_hash = :tokenHash', { tokenHash })
      .andWhere('revoked_at IS NULL')
      .andWhere('expires_at > :now', { now: new Date() })
      .execute();

    if (result.affected !== 1) return null;
    return this.refreshTokens.findOneBy({ tokenHash });
  }

  async revokeRefreshToken(id: string): Promise<void> {
    await this.refreshTokens.update({ id }, { revokedAt: new Date() });
  }

  async revokeAllRefreshTokensForUser(userId: string): Promise<void> {
    await this.refreshTokens.update({ userId, revokedAt: IsNull() }, { revokedAt: new Date() });
  }

  async recordLoginAttempt(data: {
    email: string;
    success: boolean;
    ipAddress: string | null;
  }): Promise<void> {
    const attempt = this.loginAttempts.create(data);
    await this.loginAttempts.save(attempt);
  }

  // Scoped by (email, ipAddress), not email alone — otherwise anyone who knows a victim's email
  // can lock them out indefinitely from any IP, unauthenticated, with no way for the victim to
  // clear it. Scoping this way means an attacker can still only exhaust their own IP's budget
  // against a given email.
  countRecentFailedAttempts(
    email: string,
    ipAddress: string | null,
    sinceMs: number,
  ): Promise<number> {
    return this.loginAttempts.count({
      where: {
        email,
        ipAddress: ipAddress === null ? IsNull() : ipAddress,
        success: false,
        createdAt: MoreThan(new Date(Date.now() - sinceMs)),
      },
    });
  }
}
