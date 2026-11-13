import { describe, expect, it, vi } from 'vitest';

vi.mock('../../shared/utils/permissions-version-cache', () => ({
  getCachedPermissionsVersion: vi.fn(async () => null),
  setCachedPermissionsVersion: vi.fn(async () => undefined),
}));

import { RoleService } from '../roles/role.service';
import { AuthService } from '../auth/auth.service';
import { AdminService } from './admin.service';
import { AuthorizationError, NotFoundError } from '../../shared/errors';
import { ADMIN_ORGANIZATIONS_MANAGE, KYC_ONLINE_VERIFY } from '../../shared/constants/permissions';
import type { AuthenticatedUser } from '../../shared/middleware/request.types';

const actor = (role: string, permissions: string[] = [], id = 'actor-1'): AuthenticatedUser => ({
  id,
  tenantId: null,
  role,
  permissions,
  permissionsVersion: 1,
  portal: 'platform',
});
const platformAdmin = actor('platform_admin');
const adminKeyHolder = actor('load_console', [ADMIN_ORGANIZATIONS_MANAGE]);

const roleRow = (name: string, scope: 'platform' | 'organization') => ({
  id: `role-${name}`,
  name,
  scope,
});
const user = (
  id: string,
  roleName: string,
  scope: 'platform' | 'organization',
  tenantId: string | null,
) => ({
  id,
  tenantId,
  role: roleRow(roleName, scope),
});

function roleServiceWith(
  target: ReturnType<typeof user>,
  roleToAssign: ReturnType<typeof roleRow>,
) {
  const roleRepository = {
    findUserWithRole: vi.fn(async () => ({ ...target, role: { ...target.role, permissions: [] } })),
    findRoleById: vi.fn(async () => roleToAssign),
    updateUserRole: vi.fn(async () => undefined),
    bumpPermissionsVersion: vi.fn(async () => 2),
    findUserPermissionGrants: vi.fn(async () => []),
  };
  const service = new RoleService(
    roleRepository as never,
    { log: vi.fn(async () => undefined) } as never,
    vi.fn(async () => undefined),
  );
  return { service, roleRepository };
}

describe('assigning roles from the platform side (/roles)', () => {
  it.each([
    ['platform_admin', platformAdmin],
    ['a holder of the admin key', adminKeyHolder],
  ])('%s cannot give an org user a platform role', async (_label, acting) => {
    const { service, roleRepository } = roleServiceWith(
      user('org-user', 'dispatch', 'organization', 'tenant-1'),
      roleRow('sales', 'platform'),
    );
    await expect(service.assignRole(acting, 'org-user', 'role-sales')).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(roleRepository.updateUserRole).not.toHaveBeenCalled();
  });

  it('cannot make anyone a platform_admin (seed script only)', async () => {
    const { service, roleRepository } = roleServiceWith(
      user('staff-1', 'sales', 'platform', null),
      roleRow('platform_admin', 'platform'),
    );
    await expect(
      service.assignRole(platformAdmin, 'staff-1', 'role-platform_admin'),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(roleRepository.updateUserRole).not.toHaveBeenCalled();
  });

  it('cannot change another platform_admin', async () => {
    const { service } = roleServiceWith(
      user('admin-2', 'platform_admin', 'platform', null),
      roleRow('sales', 'platform'),
    );
    await expect(service.assignRole(platformAdmin, 'admin-2', 'role-sales')).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });

  it.each([
    ['platform_admin', platformAdmin],
    ['a holder of the admin key', adminKeyHolder],
  ])('%s can move staff between staff roles', async (_label, acting) => {
    const { service, roleRepository } = roleServiceWith(
      user('staff-1', 'sales', 'platform', null),
      roleRow('ls_tracking', 'platform'),
    );
    await service.assignRole(acting, 'staff-1', 'role-ls_tracking');
    expect(roleRepository.updateUserRole).toHaveBeenCalledWith('staff-1', 'role-ls_tracking');
  });
});

describe('editing staff (PATCH /admin/staff/:id)', () => {
  it('refuses anyone who is not a staff account, before changing anything', async () => {
    const authService = Object.create(AuthService.prototype) as AuthService;
    const authRepository = {
      findStaffUserById: vi.fn(async () => null),
      findUserById: vi.fn(async () => user('org-user', 'org_admin', 'organization', 'tenant-1')),
      updateUser: vi.fn(),
    };
    Object.assign(authService, { authRepository });
    await expect(
      authService.updateStaff(platformAdmin, 'org-user', { phoneNumber: '9000000000' } as never),
    ).rejects.toBeInstanceOf(NotFoundError);
    expect(authRepository.updateUser).not.toHaveBeenCalled();
  });
});

describe('creating staff with direct grants', () => {
  it('writes no user when a requested grant is organization-scope', async () => {
    const authService = Object.create(AuthService.prototype) as AuthService;
    const authRepository = { createUser: vi.fn(), findUserByPhone: vi.fn(async () => null) };
    const roleService = {
      getRoleById: vi.fn(async () => roleRow('sales', 'platform')),
      assertPlatformPermissionIds: vi.fn(async () => {
        throw new AuthorizationError('organization-scope');
      }),
    };
    Object.assign(authService, { authRepository, roleService });
    await expect(
      authService.createStaffUser(platformAdmin, {
        fullName: 'New Hire',
        phoneNumber: '9000000001',
        roleId: 'role-sales',
        permissionIds: ['perm-masters-write'],
      } as never),
    ).rejects.toBeInstanceOf(AuthorizationError);
    expect(authRepository.createUser).not.toHaveBeenCalled();
  });
});

describe('KYC review scoping in the admin console', () => {
  function adminServiceWith(organization: Record<string, unknown>) {
    const service = Object.create(AdminService.prototype) as AdminService;
    const organizationService = {
      getOrganizationStatus: vi.fn(async () => organization),
      summarizeOrganizations: vi.fn(async () => ({})),
    };
    Object.assign(service, {
      organizationService,
      organizationDocumentService: { listByOrganization: vi.fn(async () => []) },
      organizationJourneyStageService: { getTrail: vi.fn(async () => []) },
      dataSource: { getRepository: () => ({ findOne: vi.fn(async () => null) }) },
    });
    return { service, organizationService };
  }
  const unassignedOrg = {
    id: 'org-1',
    onlineKycVerifierId: 'someone-else',
    physicalKycAgentId: null,
    onlineKycCompletedAt: null,
  };

  it('treats a holder of the admin key like platform_admin', async () => {
    const { service, organizationService } = adminServiceWith(unassignedOrg);
    await expect(service.getOrganization(adminKeyHolder, 'org-1')).resolves.toMatchObject({
      id: 'org-1',
    });
    await service.getOrganizationsSummary(adminKeyHolder, {} as never);
    expect(organizationService.summarizeOrganizations).toHaveBeenCalledWith({});
  });

  it('never gives a non-desk staff member with a KYC grant an unscoped view', async () => {
    const grantedSales = actor('sales', [KYC_ONLINE_VERIFY], 'sales-1');
    const { service, organizationService } = adminServiceWith(unassignedOrg);
    await expect(service.getOrganization(grantedSales, 'org-1')).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await service.getOrganizationsSummary(grantedSales, {} as never);
    expect(organizationService.summarizeOrganizations).toHaveBeenCalledWith({
      onlineKycVerifierId: 'sales-1',
    });
  });

  it('keeps an online desk scoped to its own assignments', async () => {
    const desk = actor('online_kyc_desk', [KYC_ONLINE_VERIFY], 'desk-1');
    const { service } = adminServiceWith({ ...unassignedOrg, onlineKycVerifierId: 'desk-1' });
    await expect(service.getOrganization(desk, 'org-1')).resolves.toMatchObject({ id: 'org-1' });
  });
});

describe('listing staff for a KYC reviewer', () => {
  it('returns names, roles and workload only', async () => {
    const service = Object.create(AdminService.prototype) as AdminService;
    const full = {
      id: 's-1',
      fullName: 'Field Agent',
      phoneNumber: '9000000002',
      email: 'agent@example.com',
      role: 'offline_kyc_desk',
      coverage: 'Pune',
      referralCodes: [],
      workload: 2,
    };
    Object.assign(service, {
      authService: {
        listStaffUsers: vi.fn(async () => ({
          items: [full],
          page: 1,
          limit: 20,
          total: 1,
          totalPages: 1,
        })),
      },
    });
    const desk = actor('online_kyc_desk', [KYC_ONLINE_VERIFY]);
    const page = await service.listStaff(desk, { page: 1, limit: 20 } as never);
    expect(page.items[0]).toEqual({
      id: 's-1',
      fullName: 'Field Agent',
      role: 'offline_kyc_desk',
      coverage: 'Pune',
      workload: 2,
    });
    const adminPage = await service.listStaff(platformAdmin, { page: 1, limit: 20 } as never);
    expect(adminPage.items[0]).toHaveProperty('phoneNumber');
  });
});
