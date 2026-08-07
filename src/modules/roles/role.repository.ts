import { DataSource, Repository } from 'typeorm';
import { RoleEntity, RoleScope } from './entities/role.entity';
import { PermissionEntity, PermissionScope } from './entities/permission.entity';
import { UserPermissionEntity } from './entities/user-permission.entity';
import { UserEntity } from '../auth/entities/user.entity';

// Covers RoleEntity, PermissionEntity, and UserPermissionEntity in one repository class — same
// grouping auth.repository.ts already uses for UserEntity+RefreshTokenEntity+LoginAttemptEntity.
export class RoleRepository {
  private readonly roles: Repository<RoleEntity>;
  private readonly permissions: Repository<PermissionEntity>;
  private readonly userPermissions: Repository<UserPermissionEntity>;
  private readonly users: Repository<UserEntity>;

  constructor(dataSource: DataSource) {
    this.roles = dataSource.getRepository(RoleEntity);
    this.permissions = dataSource.getRepository(PermissionEntity);
    this.userPermissions = dataSource.getRepository(UserPermissionEntity);
    this.users = dataSource.getRepository(UserEntity);
  }

  findRoleById(id: string): Promise<RoleEntity | null> {
    return this.roles.findOne({ where: { id }, relations: { permissions: true } });
  }

  findRoleByName(name: string): Promise<RoleEntity | null> {
    return this.roles.findOneBy({ name });
  }

  listRoles(filters: { scope?: RoleScope }): Promise<RoleEntity[]> {
    return this.roles.find({
      where: filters.scope ? { scope: filters.scope } : {},
      order: { name: 'ASC' },
    });
  }

  findPermissionById(id: string): Promise<PermissionEntity | null> {
    return this.permissions.findOneBy({ id });
  }

  listPermissions(filters: { scope?: PermissionScope }): Promise<PermissionEntity[]> {
    return this.permissions.find({
      where: filters.scope ? { scope: filters.scope } : {},
      order: { key: 'ASC' },
    });
  }

  // Used both to resolve a target user for assertCanManage (needs tenantId) and to compute
  // effective permissions (needs role + role.permissions).
  findUserWithRole(userId: string): Promise<UserEntity | null> {
    return this.users.findOne({
      where: { id: userId },
      relations: { role: { permissions: true } },
    });
  }

  async updateUserRole(userId: string, roleId: string): Promise<void> {
    await this.users.update({ id: userId }, { roleId });
  }

  findUserPermissionGrants(userId: string): Promise<UserPermissionEntity[]> {
    return this.userPermissions.find({ where: { userId }, relations: { permission: true } });
  }

  findUserPermissionGrant(
    userId: string,
    permissionId: string,
  ): Promise<UserPermissionEntity | null> {
    return this.userPermissions.findOneBy({ userId, permissionId });
  }

  async grantPermission(
    userId: string,
    permissionId: string,
    grantedBy: string,
  ): Promise<UserPermissionEntity> {
    const grant = this.userPermissions.create({ userId, permissionId, grantedBy });
    return this.userPermissions.save(grant);
  }

  async revokePermission(userId: string, permissionId: string): Promise<void> {
    await this.userPermissions.delete({ userId, permissionId });
  }
}
