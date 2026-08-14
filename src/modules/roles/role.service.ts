import { AuthorizationError, ConflictError, NotFoundError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../../shared/middleware/request.types';
import {
  PLATFORM_ADMIN_ROLE,
  ORG_ADMIN_ROLE,
  ORG_ASSIGNABLE_ROLES,
} from '../../shared/constants/roles';
import { RoleEntity, RoleScope } from './entities/role.entity';
import { PermissionEntity, PermissionScope } from './entities/permission.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { RoleRepository } from './role.repository';

type Scope = RoleScope | PermissionScope;

export interface EffectiveUserPermissions {
  role: { id: string; name: string };
  rolePermissions: string[];
  directPermissions: { id: string; key: string; grantedBy: string; createdAt: Date }[];
  effective: string[];
}

export class RoleService {
  constructor(
    private readonly roleRepository: RoleRepository,
    private readonly auditService: AuditService,
  ) {}

  /** Used by auth.service.ts's bootstrap flows (verifyOtp, createOrganization) to resolve a
   *  seeded system role's id by its well-known name. */
  async findRoleIdByName(name: string): Promise<string> {
    const role = await this.roleRepository.findRoleByName(name);
    if (!role) throw new NotFoundError(`Seeded role "${name}" is missing — run db/seed-roles.ts`);
    return role.id;
  }

  /** Used by auth.service.ts's createStaffUser to resolve + validate the role a platform admin
   *  is assigning to a new staff account. */
  async getRoleById(id: string): Promise<RoleEntity> {
    const role = await this.roleRepository.findRoleById(id);
    if (!role) throw new NotFoundError(`Role ${id} not found`);
    return role;
  }

  async listRoles(
    actingUser: AuthenticatedUser,
    filters: { scope?: RoleScope },
  ): Promise<RoleEntity[]> {
    this.assertCanViewCatalog(actingUser);
    try {
      return await this.roleRepository.listRoles(filters);
    } catch (error) {
      rethrow(error, 'Failed to list roles');
    }
  }

  /** Backs the "Invite a teammate" role dropdown (Settings → Users & Roles) — exactly
   *  ORG_ASSIGNABLE_ROLES, the same allow-list auth.service.ts's inviteOrganizationUser
   *  validates roleId against, so the dropdown can never offer a role the invite then rejects.
   *  Unlike listRoles above this isn't scope-filtered: org_admin (self-signup only) and any other
   *  organization-scope role added later that isn't meant to be invitable stay excluded by
   *  construction, not by remembering to filter them out. */
  async listAssignableOrganizationRoles(): Promise<RoleEntity[]> {
    try {
      return await this.roleRepository.listRolesByNames(ORG_ASSIGNABLE_ROLES);
    } catch (error) {
      rethrow(error, 'Failed to list assignable organization roles');
    }
  }

  async listPermissions(
    actingUser: AuthenticatedUser,
    filters: { scope?: PermissionScope },
  ): Promise<PermissionEntity[]> {
    this.assertCanViewCatalog(actingUser);
    try {
      return await this.roleRepository.listPermissions(filters);
    } catch (error) {
      rethrow(error, 'Failed to list permissions');
    }
  }

  /** Neither role names nor permission keys/descriptions are customer data, but they do reveal
   *  internal authorization structure (e.g. that ADMIN_ORGANIZATIONS_MANAGE exists) — no
   *  ordinary staff account (sales/KYC desk/load console) has a reason to enumerate this, only
   *  the two roles that actually manage roles/permissions elsewhere in this file. */
  private assertCanViewCatalog(actingUser: AuthenticatedUser): void {
    if (actingUser.role !== PLATFORM_ADMIN_ROLE && actingUser.role !== ORG_ADMIN_ROLE) {
      throw new AuthorizationError('Not authorized to view roles/permissions');
    }
  }

  /** A user's real authority = their role's permissions ∪ permissions granted directly to
   *  them. Called at token-issuance time (login/refresh/verifyOtp/createOrganization) to build
   *  the JWT's `permissions` claim. */
  async getEffectivePermissions(userId: string): Promise<string[]> {
    const user = await this.roleRepository.findUserWithRole(userId);
    if (!user) throw new NotFoundError(`User ${userId} not found`);
    const grants = await this.roleRepository.findUserPermissionGrants(userId);
    return [
      ...new Set([
        ...user.role.permissions.map((p) => p.key),
        ...grants.map((g) => g.permission.key),
      ]),
    ];
  }

  async getUserPermissions(
    actingUser: AuthenticatedUser,
    targetUserId: string,
  ): Promise<EffectiveUserPermissions> {
    try {
      const target = await this.roleRepository.findUserWithRole(targetUserId);
      if (!target) throw new NotFoundError(`User ${targetUserId} not found`);
      this.assertCanView(actingUser, target);

      const grants = await this.roleRepository.findUserPermissionGrants(targetUserId);
      const rolePermissions = target.role.permissions.map((p) => p.key);
      const directPermissions = grants.map((g) => ({
        id: g.permission.id,
        key: g.permission.key,
        grantedBy: g.grantedBy,
        createdAt: g.createdAt,
      }));

      return {
        role: { id: target.role.id, name: target.role.name },
        rolePermissions,
        directPermissions,
        effective: [...new Set([...rolePermissions, ...directPermissions.map((p) => p.key)])],
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch user permissions');
    }
  }

  /** Read-only counterpart to assertCanManage: platform_admin can view anyone, org_admin only
   *  their own org's users, and anyone can view their own permissions. */
  private assertCanView(actingUser: AuthenticatedUser, targetUser: UserEntity): void {
    if (actingUser.id === targetUser.id) return;
    if (actingUser.role === PLATFORM_ADMIN_ROLE) return;
    if (actingUser.role === ORG_ADMIN_ROLE && targetUser.tenantId === actingUser.tenantId) return;
    throw new AuthorizationError("Not authorized to view this user's permissions");
  }

  /** The single seam assignRole/grantPermission/revokePermission all share: platform_admin may
   *  only manage platform-scope things, org_admin only organization-scope things belonging to
   *  their own tenant. No one manages their own role/permissions through this path — role
   *  assignment already grants the right default permissions, and self-service escalation here
   *  would let e.g. an org_admin hand themselves any organization-scope permission that isn't
   *  already in their role's default set. */
  assertCanManage(actingUser: AuthenticatedUser, targetUser: UserEntity, thingScope: Scope): void {
    if (actingUser.id === targetUser.id) {
      throw new AuthorizationError('Cannot manage your own role or permissions');
    }
    if (actingUser.role === PLATFORM_ADMIN_ROLE) {
      if (thingScope !== 'platform') {
        throw new AuthorizationError(
          'Platform admin can only manage platform-scope roles/permissions',
        );
      }
      return;
    }
    if (actingUser.role === ORG_ADMIN_ROLE) {
      if (thingScope !== 'organization') {
        throw new AuthorizationError(
          'Org admin can only manage organization-scope roles/permissions',
        );
      }
      if (targetUser.tenantId !== actingUser.tenantId) {
        throw new AuthorizationError('Cannot manage users outside your organization');
      }
      return;
    }
    throw new AuthorizationError('Not authorized to manage roles or permissions');
  }

  /** Extra guard for grantPermission specifically (not assignRole — already scope-safe since
   *  actor authority alone confines it to same-tier role changes; not revokePermission — so a
   *  grant that predates this check can still be cleaned up through the API instead of needing
   *  direct DB access): the permission being handed to a user must match that user's own role
   *  scope, or a platform_admin could grant a platform-scope permission to an org_admin, giving
   *  them de facto cross-tenant platform-admin capability via that permission claim in their
   *  next JWT — the actor-authority check above only confirms the actor may hand out
   *  platform-scope permissions at all, not that this particular recipient should hold one. */
  private assertTargetScopeMatches(targetUser: UserEntity, thingScope: Scope): void {
    if (targetUser.role.scope !== thingScope) {
      throw new AuthorizationError(
        `Cannot grant a ${thingScope}-scope permission to a ${targetUser.role.scope}-scope user`,
      );
    }
  }

  async assignRole(
    actingUser: AuthenticatedUser,
    targetUserId: string,
    roleId: string,
  ): Promise<RoleEntity> {
    try {
      const targetUser = await this.roleRepository.findUserWithRole(targetUserId);
      if (!targetUser) throw new NotFoundError(`User ${targetUserId} not found`);
      const role = await this.roleRepository.findRoleById(roleId);
      if (!role) throw new NotFoundError(`Role ${roleId} not found`);

      this.assertCanManage(actingUser, targetUser, role.scope);

      const oldRole = { id: targetUser.role.id, name: targetUser.role.name };
      await this.roleRepository.updateUserRole(targetUserId, roleId);

      await this.auditService.log({
        tenantId: targetUser.tenantId,
        userId: actingUser.id,
        action: 'ROLE_ASSIGNED',
        resourceType: 'user',
        oldData: oldRole,
        newData: { id: role.id, name: role.name },
      });

      return role;
    } catch (error) {
      rethrow(error, 'Failed to assign role');
    }
  }

  async grantPermission(
    actingUser: AuthenticatedUser,
    targetUserId: string,
    permissionId: string,
  ): Promise<PermissionEntity> {
    try {
      const targetUser = await this.roleRepository.findUserWithRole(targetUserId);
      if (!targetUser) throw new NotFoundError(`User ${targetUserId} not found`);
      const permission = await this.roleRepository.findPermissionById(permissionId);
      if (!permission) throw new NotFoundError(`Permission ${permissionId} not found`);

      this.assertCanManage(actingUser, targetUser, permission.scope);
      this.assertTargetScopeMatches(targetUser, permission.scope);

      const existing = await this.roleRepository.findUserPermissionGrant(
        targetUserId,
        permissionId,
      );
      if (existing)
        throw new ConflictError(`User already has permission "${permission.key}" granted directly`);

      await this.roleRepository.grantPermission(targetUserId, permissionId, actingUser.id);

      await this.auditService.log({
        tenantId: targetUser.tenantId,
        userId: actingUser.id,
        action: 'PERMISSION_GRANTED',
        resourceType: 'user',
        newData: { permissionId: permission.id, key: permission.key },
      });

      return permission;
    } catch (error) {
      rethrow(error, 'Failed to grant permission');
    }
  }

  async revokePermission(
    actingUser: AuthenticatedUser,
    targetUserId: string,
    permissionId: string,
  ): Promise<void> {
    try {
      const targetUser = await this.roleRepository.findUserWithRole(targetUserId);
      if (!targetUser) throw new NotFoundError(`User ${targetUserId} not found`);
      const permission = await this.roleRepository.findPermissionById(permissionId);
      if (!permission) throw new NotFoundError(`Permission ${permissionId} not found`);

      this.assertCanManage(actingUser, targetUser, permission.scope);

      const existing = await this.roleRepository.findUserPermissionGrant(
        targetUserId,
        permissionId,
      );
      if (!existing)
        throw new NotFoundError(
          `User does not have permission "${permission.key}" granted directly`,
        );

      await this.roleRepository.revokePermission(targetUserId, permissionId);

      await this.auditService.log({
        tenantId: targetUser.tenantId,
        userId: actingUser.id,
        action: 'PERMISSION_REVOKED',
        resourceType: 'user',
        oldData: { permissionId: permission.id, key: permission.key },
      });
    } catch (error) {
      rethrow(error, 'Failed to revoke permission');
    }
  }
}
