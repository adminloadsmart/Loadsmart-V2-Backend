import { describe, expect, it, vi, beforeEach } from 'vitest';
import bcrypt from 'bcryptjs';
import express, { ErrorRequestHandler } from 'express';
import request from 'supertest';

vi.mock('../../shared/utils/permissions-version-cache', () => ({
  getCachedPermissionsVersion: vi.fn(async () => null),
  setCachedPermissionsVersion: vi.fn(async () => undefined),
}));
vi.mock('../../shared/utils/user-existence-cache', () => ({
  invalidateUserExistsCache: vi.fn(async () => undefined),
}));
vi.mock('../../shared/utils/token-blocklist', () => ({ blockToken: vi.fn(async () => undefined) }));

import { AuthService } from '../auth/auth.service';
import { AdminService } from './admin.service';
import { RoleService } from '../roles/role.service';
import { ADMIN_TEAM_BUNDLE, OPS_TEAM_BUNDLES, ROLES } from '../../db/role-catalog';
import {
  ADMIN_ORGANIZATIONS_MANAGE,
  KYC_ONLINE_VERIFY,
  KYC_OVERSEE,
  LS_MARGIN_MANAGE,
  LS_MARGIN_VIEW,
  LS_MASTERS_MANAGE,
  LS_MONEY_APPROVE,
  LS_SETTINGS_MANAGE,
  SALES_LEADS_MANAGE,
} from '../../shared/constants/permissions';
import { STAFF_TEAMS, TEAM_ROLES } from '../../shared/constants/roles';
import {
  AppError,
  AuthenticationError,
  AuthorizationError,
  ConflictError,
  ValidationError,
} from '../../shared/errors';
import { createLoadsmartOpsRoutes } from '../loadsmart-ops/loadsmart.routes';
import { LoadsmartOpsController } from '../loadsmart-ops/loadsmart.controller';
import { redactMargin } from '../loadsmart-ops/redact-margin';
import { LsSourcingService } from '../loadsmart-ops/ls-sourcing.service';
import type { AuthenticatedUser } from '../../shared/middleware/request.types';
import type { CreateStaffInput } from '../auth/auth.types';

const actor = (role: string, permissions: string[] = [], id = 'actor-1'): AuthenticatedUser => ({
  id,
  tenantId: null,
  role,
  permissions,
  permissionsVersion: 1,
  portal: 'platform',
});
const owner = actor('platform_admin', [], 'owner-1');
const bundleOf = (team: string) => ROLES.find((role) => role.name === team)!.permissionKeys;

// ── Catalog ────────────────────────────────────────────────────────────────────────────────────

describe('team catalog (db/role-catalog.ts)', () => {
  it('seeds exactly one role per team, and none of the retired staff roles', () => {
    for (const team of STAFF_TEAMS) expect(ROLES.some((role) => role.name === team)).toBe(true);
    for (const retired of [
      'online_kyc_desk',
      'offline_kyc_desk',
      'load_console',
      'ls_verification',
      'ls_pod',
    ]) {
      expect(ROLES.some((role) => role.name === retired)).toBe(false);
    }
    expect(Object.keys(TEAM_ROLES).sort()).toEqual([...STAFF_TEAMS].sort());
  });

  it('gives the Admin team every ops key plus masters and margin', () => {
    const admin = bundleOf('ls_admin');
    for (const key of Object.values(OPS_TEAM_BUNDLES).flat()) expect(admin).toContain(key);
    expect(admin).toEqual(
      expect.arrayContaining([LS_MASTERS_MANAGE, LS_MARGIN_VIEW, LS_MARGIN_MANAGE]),
    );
    expect(ADMIN_TEAM_BUNDLE.every((key) => admin.includes(key))).toBe(true);
  });

  it('makes the Admin team the Super Admin: only it approves money and holds settings', () => {
    expect(bundleOf('ls_admin')).toEqual(
      expect.arrayContaining([LS_MONEY_APPROVE, LS_SETTINGS_MANAGE]),
    );
    for (const team of STAFF_TEAMS.filter((t) => t !== 'ls_admin')) {
      expect(bundleOf(team)).not.toContain(LS_MONEY_APPROVE);
      expect(bundleOf(team)).not.toContain(LS_SETTINGS_MANAGE);
    }
  });

  it('never makes the Admin team a platform admin or a salesperson', () => {
    expect(bundleOf('ls_admin')).not.toContain(ADMIN_ORGANIZATIONS_MANAGE);
    expect(bundleOf('ls_admin')).not.toContain(SALES_LEADS_MANAGE);
  });

  it('keeps masters with Admin only, and margin with Admin and Placement only', () => {
    for (const team of STAFF_TEAMS.filter((t) => t !== 'ls_admin')) {
      expect(bundleOf(team)).not.toContain(LS_MASTERS_MANAGE);
      expect(bundleOf(team)).not.toContain(LS_MARGIN_MANAGE);
      expect(bundleOf(team)).not.toContain(KYC_OVERSEE);
    }
    for (const team of STAFF_TEAMS.filter((t) => t !== 'ls_admin' && t !== 'ls_placement')) {
      expect(bundleOf(team)).not.toContain(LS_MARGIN_VIEW);
    }
  });

  it('only allows ASM on the sales team', () => {
    for (const team of STAFF_TEAMS.filter((t) => t !== 'sales')) {
      expect(TEAM_ROLES[team]).not.toContain('asm');
    }
  });
});

// ── Team member create / update / delete ───────────────────────────────────────────────────────

type Row = Record<string, unknown> & { id: string; role: { id: string; name: string } };
const roleRow = (name: string) => ({ id: `role-${name}`, name, scope: 'platform' as const });
const member = (id: string, team: string, extra: Record<string, unknown> = {}): Row => ({
  id,
  tenantId: null,
  phoneNumber: '919000000000',
  email: `${id}@loadsmart.in`,
  fullName: `Member ${id}`,
  roleId: `role-${team}`,
  role: roleRow(team),
  employeeId: `EMP-${id}`,
  teamRole: team === 'sales' ? 'salesperson' : 'team_member',
  region: 'Pune',
  reportsToUserId: null,
  reportsTo: null,
  salesType: null,
  state: null,
  asmUserId: null,
  asm: null,
  lastSignedInAt: null,
  deletedAt: null,
  createdAt: new Date(),
  ...extra,
});

function staffServiceWith(people: Row[] = []) {
  const byId = new Map(people.map((person) => [person.id, person]));
  const authRepository = {
    findUserByPhone: vi.fn(async () => null),
    findUserByEmail: vi.fn(async () => null),
    findUserById: vi.fn(async (id: string) => byId.get(id) ?? null),
    findStaffUserById: vi.fn(async (id: string) => byId.get(id) ?? null),
    findActivePlatformUsersByIds: vi.fn(async (ids: string[]) =>
      ids.map((id) => byId.get(id)).filter(Boolean),
    ),
    nextEmployeeId: vi.fn(async () => 'LS0042'),
    reportsToChain: vi.fn(async () => [] as string[]),
    countDirectReports: vi.fn(async () => 0),
    countAsmReports: vi.fn(async () => 0),
    createUser: vi.fn(async (data: Record<string, unknown>) => {
      const created = member('new-1', 'ls_tracking', { ...data, id: 'new-1' });
      created.role = roleRow(String(data.roleId).replace('role-', ''));
      byId.set('new-1', created);
      return created;
    }),
    updateUser: vi.fn(async () => undefined),
    softDeleteUser: vi.fn(async () => undefined),
    revokeAllRefreshTokensForUser: vi.fn(async () => undefined),
  };
  const roleService = {
    getRoleById: vi.fn(async (id: string) => roleRow(id.replace('role-', ''))),
    assignRole: vi.fn(async () => undefined),
    invalidateUserSession: vi.fn(async () => undefined),
    getEffectivePermissions: vi.fn(async () => ['loadsmart.tracking']),
    describePermissions: vi.fn(async (keys: string[]) => keys),
  };
  const organizationService = {
    countPendingKycAssignmentsByStaffIds: vi.fn(async () => new Map<string, number>()),
    countSignupsByReferralCodeOwnerIds: vi.fn(async () => new Map()),
  };
  const referralCodeService = {
    listByOwnerIds: vi.fn(async () => new Map()),
    createForSalesperson: vi.fn(async () => ({ id: 'code-1', code: 'RAVI-P42' })),
  };
  const staffInviteSender = { send: vi.fn(async () => undefined) };
  const auditService = { log: vi.fn(async () => undefined) };
  const service = Object.create(AuthService.prototype) as AuthService;
  Object.assign(service, {
    authRepository,
    roleService,
    organizationService,
    referralCodeService,
    staffInviteSender,
    auditService,
  });
  return { service, authRepository, roleService, organizationService, staffInviteSender };
}

const newMember = (overrides: Partial<CreateStaffInput> = {}): CreateStaffInput => ({
  fullName: 'Asha Rao',
  phoneNumber: '9000000101',
  email: 'asha@loadsmart.in',
  roleId: 'role-ls_tracking',
  teamRole: 'team_member',
  region: 'Pune',
  ...overrides,
});

describe('adding a team member (POST /admin/staff)', () => {
  it('turns a racing duplicate employee ID into a 409', async () => {
    const { service, authRepository } = staffServiceWith();
    authRepository.createUser.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), {
        driverError: { code: '23505', constraint: 'users_employee_id_team_active_unique' },
      }),
    );
    await expect(service.createStaffUser(owner, newMember())).rejects.toThrow(/employee ID/);
  });

  it('passes other database errors through untouched', async () => {
    const { service, authRepository } = staffServiceWith();
    authRepository.createUser.mockRejectedValueOnce(new Error('connection lost'));
    await expect(service.createStaffUser(owner, newMember())).rejects.toThrow('connection lost');
  });

  it('creates an OTP-only account (no password) and sends the invite', async () => {
    const { service, authRepository, staffInviteSender } = staffServiceWith([
      member('mgr', 'ls_tracking'),
    ]);
    const created = await service.createStaffUser(owner, newMember({ reportsToUserId: 'mgr' }));
    expect(authRepository.createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        passwordHash: null,
        tenantId: null,
        employeeId: 'LS0042',
        teamRole: 'team_member',
        reportsToUserId: 'mgr',
        region: 'Pune',
        salesType: null,
        asmUserId: null,
      }),
    );
    expect(staffInviteSender.send).toHaveBeenCalledWith(
      expect.objectContaining({ email: 'asha@loadsmart.in' }),
    );
    expect(created).toMatchObject({ team: 'ls_tracking', status: 'invited' });
  });

  it.each([
    ['ASM on Tracking (ASM is a sales role)', newMember({ teamRole: 'asm' })],
    [
      'sales fields on a non-sales team',
      newMember({ sales: { salesType: 'shipper_sales', state: 'MH' } }),
    ],
    ['the sales team without sales fields', newMember({ roleId: 'role-sales', teamRole: 'asm' })],
    [
      'a salesperson without an ASM',
      newMember({
        roleId: 'role-sales',
        teamRole: 'salesperson',
        sales: { salesType: 'tracker_sales', state: 'MH' },
      }),
    ],
    ['platform_admin as a team', newMember({ roleId: 'role-platform_admin' })],
    ['an org role as a team', newMember({ roleId: 'role-dispatch' })],
  ])('refuses %s, writing nothing', async (_label, input) => {
    const { service, authRepository } = staffServiceWith();
    await expect(service.createStaffUser(owner, input)).rejects.toBeInstanceOf(ValidationError);
    expect(authRepository.createUser).not.toHaveBeenCalled();
  });

  it('requires the ASM to really be a sales-team ASM', async () => {
    const { service, authRepository } = staffServiceWith([
      member('not-asm', 'sales', { teamRole: 'salesperson' }),
      member('tracker-lead', 'ls_tracking', { teamRole: 'team_member' }),
    ]);
    for (const asmUserId of ['not-asm', 'tracker-lead', 'missing']) {
      await expect(
        service.createStaffUser(
          owner,
          newMember({
            roleId: 'role-sales',
            teamRole: 'salesperson',
            sales: { salesType: 'shipper_sales', state: 'MH', asmUserId },
          }),
        ),
      ).rejects.toBeInstanceOf(ValidationError);
    }
    expect(authRepository.createUser).not.toHaveBeenCalled();
  });

  it('hires a salesperson under a real ASM and gives them a referral code', async () => {
    const { service, authRepository } = staffServiceWith([
      member('asm-1', 'sales', { teamRole: 'asm' }),
    ]);
    const created = await service.createStaffUser(
      owner,
      newMember({
        roleId: 'role-sales',
        teamRole: 'salesperson',
        sales: { salesType: 'shipper_sales', state: 'MH', asmUserId: 'asm-1' },
      }),
    );
    expect(authRepository.createUser).toHaveBeenCalledWith(
      expect.objectContaining({ salesType: 'shipper_sales', state: 'MH', asmUserId: 'asm-1' }),
    );
    expect(created.referralCode).toEqual({ id: 'code-1', code: 'RAVI-P42' });
  });

  it('refuses a reports-to who is not an active team member', async () => {
    const { service } = staffServiceWith([
      { ...member('org-user', 'dispatch'), tenantId: 'tenant-1' },
    ]);
    for (const reportsToUserId of ['missing', 'org-user']) {
      await expect(
        service.createStaffUser(owner, newMember({ reportsToUserId })),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('issues the employee ID only once every check has passed', async () => {
    const { service, authRepository } = staffServiceWith();
    await expect(
      service.createStaffUser(owner, newMember({ teamRole: 'asm' })),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(authRepository.nextEmployeeId).not.toHaveBeenCalled();
  });

  it('still hires when the invite fails', async () => {
    const { service, staffInviteSender } = staffServiceWith();
    staffInviteSender.send.mockRejectedValueOnce(new Error('MSG91 down'));
    await expect(service.createStaffUser(owner, newMember())).resolves.toMatchObject({
      id: 'new-1',
    });
  });
});

describe('editing a team member (PATCH /admin/staff/:id)', () => {
  it('refuses a reports-to cycle', async () => {
    const { service, authRepository } = staffServiceWith([
      member('boss', 'ls_tracking'),
      member('report', 'ls_tracking', { reportsToUserId: 'boss' }),
    ]);
    authRepository.reportsToChain.mockResolvedValueOnce(['boss']);
    await expect(
      service.updateStaff(owner, 'boss', { reportsToUserId: 'report' }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(authRepository.updateUser).not.toHaveBeenCalled();
  });

  it('refuses reporting to yourself', async () => {
    const { service } = staffServiceWith([member('m-1', 'ls_tracking')]);
    await expect(
      service.updateStaff(owner, 'm-1', { reportsToUserId: 'm-1' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('refuses moving a reviewer with open KYC work off Approval', async () => {
    const { service, organizationService, roleService } = staffServiceWith([
      member('rev', 'ls_approval'),
    ]);
    organizationService.countPendingKycAssignmentsByStaffIds.mockResolvedValue(
      new Map([['rev', 3]]),
    );
    await expect(
      service.updateStaff(owner, 'rev', { roleId: 'role-ls_tracking' }),
    ).rejects.toBeInstanceOf(ConflictError);
    expect(roleService.assignRole).not.toHaveBeenCalled();
  });

  it('refuses moving a salesperson who still owns an active referral code off sales', async () => {
    const { service } = staffServiceWith([
      member('rep', 'sales', { teamRole: 'asm', salesType: 'shipper_sales', state: 'MH' }),
    ]);
    Object.assign(service, {
      referralCodeService: {
        listByOwnerIds: vi.fn(async () => new Map([['rep', [{ status: 'active' }]]])),
      },
    });
    await expect(
      service.updateStaff(owner, 'rep', { roleId: 'role-ls_tracking', teamRole: 'team_member' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('refuses an ASM step-down while salespeople still report to them', async () => {
    const { service, authRepository } = staffServiceWith([
      member('asm-1', 'sales', { teamRole: 'asm', salesType: 'shipper_sales', state: 'MH' }),
      member('asm-2', 'sales', { teamRole: 'asm', salesType: 'shipper_sales', state: 'MH' }),
    ]);
    authRepository.countAsmReports.mockResolvedValue(2);
    await expect(
      service.updateStaff(owner, 'asm-1', {
        teamRole: 'salesperson',
        sales: { salesType: 'shipper_sales', state: 'MH', asmUserId: 'asm-2' },
      }),
    ).rejects.toBeInstanceOf(ConflictError);
  });

  it('needs a new job title when the old one is not valid on the new team', async () => {
    const { service } = staffServiceWith([member('m-1', 'ls_tracking')]);
    await expect(
      service.updateStaff(owner, 'm-1', { roleId: 'role-ls_admin' }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('moves a member to another team and clears their sales details', async () => {
    const { service, roleService, authRepository } = staffServiceWith([
      member('rep', 'sales', { teamRole: 'asm', salesType: 'tracker_sales', state: 'GJ' }),
    ]);
    await service.updateStaff(owner, 'rep', {
      roleId: 'role-ls_tracking',
      teamRole: 'team_member',
    });
    expect(roleService.assignRole).toHaveBeenCalledWith(owner, 'rep', 'role-ls_tracking');
    expect(authRepository.updateUser).toHaveBeenCalledWith(
      'rep',
      expect.objectContaining({ teamRole: 'team_member', salesType: null, state: null }),
    );
  });

  it('ends every session (live access token too) when their phone (OTP identity) changes', async () => {
    const { service, roleService } = staffServiceWith([member('m-1', 'ls_tracking')]);
    await service.updateStaff(owner, 'm-1', { phoneNumber: '9111111111' });
    expect(roleService.invalidateUserSession).toHaveBeenCalledWith('m-1');
  });

  it('keeps the employee ID on edit', async () => {
    const { service, authRepository } = staffServiceWith([member('m-1', 'ls_tracking')]);
    await service.updateStaff(owner, 'm-1', { region: 'Mumbai' });
    expect(authRepository.nextEmployeeId).not.toHaveBeenCalled();
    expect(authRepository.updateUser).toHaveBeenCalledWith(
      'm-1',
      expect.not.objectContaining({ employeeId: expect.anything() }),
    );
  });

  it('issues an employee ID to a member hired before IDs were generated', async () => {
    const { service, authRepository } = staffServiceWith([
      member('m-1', 'ls_tracking', { employeeId: null }),
    ]);
    await service.updateStaff(owner, 'm-1', { region: 'Mumbai' });
    expect(authRepository.updateUser).toHaveBeenCalledWith(
      'm-1',
      expect.objectContaining({ employeeId: 'LS0042' }),
    );
  });

  it('does not end sessions for other edits', async () => {
    const { service, roleService } = staffServiceWith([member('m-1', 'ls_tracking')]);
    await service.updateStaff(owner, 'm-1', { region: 'Mumbai' });
    expect(roleService.invalidateUserSession).not.toHaveBeenCalled();
  });

  it('gives no second referral code to someone moved back onto sales who still has one', async () => {
    const { service } = staffServiceWith([member('m-1', 'ls_tracking')]);
    const createForSalesperson = vi.fn();
    Object.assign(service, {
      referralCodeService: {
        listByOwnerIds: vi.fn(async () => new Map([['m-1', [{ status: 'active' }]]])),
        createForSalesperson,
      },
    });
    await service.updateStaff(owner, 'm-1', {
      roleId: 'role-sales',
      teamRole: 'asm',
      sales: { salesType: 'shipper_sales', state: 'MH' },
    });
    expect(createForSalesperson).not.toHaveBeenCalled();
  });

  it('turns a racing duplicate (unique index) into a 409, not a 500', async () => {
    const { service, authRepository } = staffServiceWith([member('m-1', 'ls_tracking')]);
    authRepository.updateUser.mockRejectedValueOnce(
      Object.assign(new Error('duplicate key'), {
        driverError: { code: '23505', constraint: 'users_phone_active_unique' },
      }),
    );
    await expect(
      service.updateStaff(owner, 'm-1', { phoneNumber: '9111111111' }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});

describe('removing a team member (DELETE /admin/staff/:id)', () => {
  it.each([
    ['people still report to them', 'countDirectReports'],
    ['salespeople still have them as ASM', 'countAsmReports'],
  ] as const)('refuses while %s', async (_label, counter) => {
    const { service, authRepository } = staffServiceWith([member('m-1', 'ls_tracking')]);
    authRepository[counter].mockResolvedValue(1);
    await expect(service.deleteStaff(owner, 'm-1')).rejects.toBeInstanceOf(ConflictError);
    expect(authRepository.softDeleteUser).not.toHaveBeenCalled();
  });

  it('refuses anyone who is not a team member', async () => {
    const { service } = staffServiceWith();
    await expect(service.deleteStaff(owner, 'platform-admin-2')).rejects.toBeInstanceOf(AppError);
  });

  it('removes a member with nothing pointing at them', async () => {
    const { service, authRepository } = staffServiceWith([member('m-1', 'ls_tracking')]);
    await service.deleteStaff(owner, 'm-1');
    expect(authRepository.softDeleteUser).toHaveBeenCalledWith('m-1');
    expect(authRepository.revokeAllRefreshTokensForUser).toHaveBeenCalledWith('m-1');
  });
});

// ── OTP-only login and self-service guards ─────────────────────────────────────────────────────

describe('team members sign in with OTP only', () => {
  let hash: string;
  beforeEach(async () => {
    hash = await bcrypt.hash('secret-pass', 4);
  });

  function loginServiceWith(person: Row) {
    const authRepository = {
      countRecentFailedAttempts: vi.fn(async () => 0),
      findUserByPhone: vi.fn(async () => person),
      recordLoginAttempt: vi.fn(async () => undefined),
      findUserById: vi.fn(async () => person),
    };
    const service = Object.create(AuthService.prototype) as AuthService;
    Object.assign(service, { authRepository });
    return { service, authRepository };
  }

  it('refuses a password login even with the right password', async () => {
    const { service, authRepository } = loginServiceWith(
      member('m-1', 'ls_tracking', { passwordHash: hash }),
    );
    await expect(
      service.login(
        { phoneNumber: '9000000000', password: 'secret-pass', portal: 'platform' } as never,
        null,
      ),
    ).rejects.toBeInstanceOf(AuthenticationError);
    expect(authRepository.recordLoginAttempt).toHaveBeenCalledWith(
      expect.objectContaining({ success: false }),
    );
  });

  it('refuses setting a password', async () => {
    const { service } = loginServiceWith(member('m-1', 'ls_tracking', { passwordHash: null }));
    await expect(
      service.createPassword(actor('ls_tracking', [], 'm-1'), { password: 'secret-pass' } as never),
    ).rejects.toBeInstanceOf(AuthorizationError);
  });

  it.each(['ls_tracking', 'sales', 'platform_admin'])(
    'refuses self-deleting a %s account',
    async (role) => {
      const { service } = loginServiceWith(member('m-1', role));
      const softDeleteUser = vi.fn();
      Object.assign(service, { authRepository: { softDeleteUser } });
      await expect(
        service.deleteAccount({ ...actor(role, [], 'm-1'), jti: 'j', exp: 1 } as never),
      ).rejects.toBeInstanceOf(AuthorizationError);
      expect(softDeleteUser).not.toHaveBeenCalled();
    },
  );
});

// ── KYC reviewers: assignment and capacity ─────────────────────────────────────────────────────

describe('KYC reviewers are Approval/Admin team members acting in their assigned capacity', () => {
  function adminServiceWith(organization: Record<string, unknown>, target?: Row) {
    const service = Object.create(AdminService.prototype) as AdminService;
    Object.assign(service, {
      organizationService: {
        getOrganizationStatus: vi.fn(async () => organization),
        updateOrganization: vi.fn(async () => undefined),
      },
      authService: { getUserById: vi.fn(async () => target) },
      organizationDocumentService: { listByOrganization: vi.fn(async () => []) },
    });
    return service;
  }
  const org = {
    id: 'org-1',
    onlineKycVerifierId: 'online-1',
    physicalKycAgentId: 'agent-1',
    onlineKycCompletedAt: new Date(),
    physicalKycApprovedAt: null,
  };

  it('only lets an Approval or Admin member be assigned as a reviewer', async () => {
    for (const team of ['ls_tracking', 'sales', 'ls_placement']) {
      const service = adminServiceWith(org, member('cand', team));
      await expect(
        service.assignOnlineVerifier(owner, 'org-1', { userId: 'cand' }),
      ).rejects.toBeInstanceOf(ValidationError);
    }
  });

  it('stops the physical agent doing an online-verifier action', async () => {
    const agent = actor('ls_approval', [KYC_ONLINE_VERIFY], 'agent-1');
    await expect(adminServiceWith(org).approveOrganization(agent, 'org-1')).rejects.toThrow(
      /Only the online verifier/,
    );
    await expect(
      adminServiceWith(org).denyOrganization(agent, 'org-1', { reason: 'x' }),
    ).rejects.toThrow(/Only the online verifier/);
  });

  it('stops the online verifier doing the physical approval', async () => {
    const online = actor('ls_approval', [KYC_ONLINE_VERIFY], 'online-1');
    await expect(adminServiceWith(org).approvePhysicalKyc(online, 'org-1')).rejects.toThrow(
      /Only the physical agent/,
    );
  });

  it('lets the Admin team see the whole queue and act on any org (kyc.oversee)', async () => {
    const adminMember = actor('ls_admin', bundleOf('ls_admin'), 'admin-1');
    const unassigned = { ...org, onlineKycVerifierId: 'someone', physicalKycAgentId: null };
    const service = adminServiceWith(unassigned);
    const summarizeOrganizations = vi.fn(async () => ({}));
    Object.assign(service, {
      organizationService: {
        getOrganizationStatus: vi.fn(async () => unassigned),
        summarizeOrganizations,
      },
      organizationJourneyStageService: { getTrail: vi.fn(async () => []) },
      dataSource: { getRepository: () => ({ findOne: vi.fn(async () => null) }) },
    });
    await service.getOrganizationsSummary(adminMember, {} as never);
    expect(summarizeOrganizations).toHaveBeenCalledWith({});
    await expect(service.getOrganization(adminMember, 'org-1')).resolves.toMatchObject({
      id: 'org-1',
    });
  });

  it('lets the Admin team assign reviewers', async () => {
    const adminMember = actor('ls_admin', bundleOf('ls_admin'), 'admin-1');
    const service = adminServiceWith(org, member('rev', 'ls_approval'));
    const recordTransition = vi.fn(async () => ({ id: 'org-1', journeyStage: 'x' }));
    Object.assign(service, {
      organizationJourneyStageService: { recordTransition },
      auditService: { log: vi.fn(async () => undefined) },
    });
    await expect(
      service.assignOnlineVerifier(adminMember, 'org-1', { userId: 'rev' }),
    ).resolves.toMatchObject({ id: 'org-1' });
  });
});

// ── Direct grants ──────────────────────────────────────────────────────────────────────────────

describe('direct permission grants keep one team per person', () => {
  function roleServiceFor(targetRole: string, key: string) {
    const roleRepository = {
      findUserWithRole: vi.fn(async () => ({
        id: 'm-1',
        tenantId: null,
        role: { name: targetRole, scope: 'platform', permissions: [] },
      })),
      findPermissionById: vi.fn(async () => ({ id: 'p-1', key, scope: 'platform' })),
      grantPermission: vi.fn(),
      findUserPermissionGrant: vi.fn(async () => null),
    };
    const service = new RoleService(
      roleRepository as never,
      { log: vi.fn() } as never,
      vi.fn(async () => undefined),
    );
    return { service, roleRepository };
  }

  it("refuses granting another team's key to a team member", async () => {
    const { service, roleRepository } = roleServiceFor('ls_placement', 'loadsmart.tracking');
    await expect(service.grantPermission(owner, 'm-1', 'p-1')).rejects.toBeInstanceOf(
      AuthorizationError,
    );
    expect(roleRepository.grantPermission).not.toHaveBeenCalled();
  });

  it('refuses granting the platform-admin key to anyone', async () => {
    const { service } = roleServiceFor('ls_admin', ADMIN_ORGANIZATIONS_MANAGE);
    await expect(service.grantPermission(owner, 'm-1', 'p-1')).rejects.toBeInstanceOf(
      AuthorizationError,
    );
  });
});

// ── Ops console: masters and margin ────────────────────────────────────────────────────────────

describe('ops console access by team', () => {
  const errors: ErrorRequestHandler = (err, _req, res, _next) => {
    res.status(err instanceof AppError ? err.statusCode : 500).json({ message: err.message });
  };
  const sourcing = {
    listPartners: vi.fn(async () => [{ id: 'p-1' }]),
    savePartner: vi.fn(async () => ({ id: 'p-1' })),
    getTerms: vi.fn(async () => ({ tenantId: 't-1', marginPercent: 8, advancePercent: 80 })),
    saveTerms: vi.fn(async () => ({ tenantId: 't-1' })),
    approve: vi.fn(async () => ({ id: 's-1' })),
  };
  const settlement = {
    loadDetail: vi.fn(async () => ({
      sourcing: {
        id: 's-1',
        marginPercent: '8.00',
        effectiveMarginPercent: '7.50',
        shipperPrice: '1000',
      },
      partnerBids: [{ id: 'b-1', rate: '900' }],
    })),
  };
  function appFor(team: string) {
    const app = express();
    app.use(express.json());
    app.use((req, _res, next) => {
      req.user = { ...actor(team, bundleOf(team)), id: `${team}-1` };
      next();
    });
    app.use(
      createLoadsmartOpsRoutes(
        new LoadsmartOpsController(
          sourcing as never,
          settlement as never,
          // placement, approval, tracking, cs, receivables, payables, console, staff inbox, call log,
          // placement board, shipper directory — unused here
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
          {} as never,
        ),
      ),
    );
    app.use(errors);
    return app;
  }

  it('lets only the Admin team create or edit partners (a master)', async () => {
    const body = { name: 'Broker', partnerType: 'broker', phone: '9000000000' };
    expect((await request(appFor('ls_admin')).post('/partners').send(body)).status).not.toBe(403);
    for (const team of ['ls_placement', 'ls_tracking', 'ls_payables', 'ls_approval']) {
      expect((await request(appFor(team)).post('/partners').send(body)).status).toBe(403);
    }
  });

  it('lets Placement and Admin list partners, nobody else', async () => {
    for (const team of ['ls_placement', 'ls_admin']) {
      expect((await request(appFor(team)).get('/partners')).status).toBe(200);
    }
    for (const team of ['ls_tracking', 'ls_payables', 'ls_receivables', 'ls_approval', 'ls_cs']) {
      expect((await request(appFor(team)).get('/partners')).status).toBe(403);
    }
  });

  it('hides margin from teams other than Placement and Admin', async () => {
    const loadId = '00000000-0000-4000-8000-000000000001';
    const tracking = await request(appFor('ls_tracking')).get(`/loads/${loadId}`);
    expect(tracking.status).toBe(200);
    // Tracking sees carrier money only: the shipper's price is gone too, so margin can't be worked out.
    expect(tracking.body.data.sourcing).toEqual({ id: 's-1' });
    const placement = await request(appFor('ls_placement')).get(`/loads/${loadId}`);
    expect(placement.body.data.sourcing.marginPercent).toBe('8.00');
    const admin = await request(appFor('ls_admin')).get(`/loads/${loadId}`);
    expect(admin.body.data.sourcing.effectiveMarginPercent).toBe('7.50');
  });

  it('lets only the Admin team change margin on terms or on approval', async () => {
    const tenant = '00000000-0000-4000-8000-0000000000aa';
    const sourcingId = '00000000-0000-4000-8000-0000000000bb';
    const approval = appFor('ls_approval');
    expect(
      (await request(approval).put(`/terms/${tenant}`).send({ truckerAdvancePercent: 80 })).status,
    ).toBe(200);
    expect(
      (
        await request(approval)
          .put(`/terms/${tenant}`)
          .send({ truckerAdvancePercent: 80, marginPercent: 5 })
      ).status,
    ).toBe(403);
    expect(
      (await request(approval).post(`/sourcings/${sourcingId}/approve`).send({ marginPercent: 5 }))
        .status,
    ).toBe(403);
    expect((await request(approval).post(`/sourcings/${sourcingId}/approve`).send({})).status).toBe(
      200,
    );
    expect(
      (
        await request(appFor('ls_admin'))
          .put(`/terms/${tenant}`)
          .send({ truckerAdvancePercent: 80, marginPercent: 5 })
      ).status,
    ).toBe(200);
  });

  it('keeps the current margin when terms are saved without one', async () => {
    const service = Object.create(LsSourcingService.prototype) as LsSourcingService;
    const save = vi.fn(async () => undefined);
    Object.assign(service, {
      repository: { terms: { findOneBy: vi.fn(async () => ({ marginPercent: '9.50' })), save } },
      auditService: { log: vi.fn(async () => undefined) },
      settings: {
        current: vi.fn(async () => ({
          values: {
            centralMarginPercent: 8,
            defaultCarrierAdvancePercent: 80,
            defaultShipperCreditDays: 30,
            maxShipperCreditDays: 90,
          },
        })),
      },
    });
    await service.saveTerms('approver-1', 't-1', { truckerAdvancePercent: 70 });
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ marginPercent: '9.5', truckerAdvancePercent: '70' }),
    );
  });

  it('redacts margin at any depth, leaving everything else', () => {
    const when = new Date('2026-11-16T00:00:00Z');
    expect(
      redactMargin({
        rows: [{ marginPercent: 1, sourcing: { effectiveMarginPercent: 2, at: when } }],
      }),
    ).toEqual({ rows: [{ sourcing: { at: when } }] });
  });
});

describe('the Team members form team picker (GET /admin/staff/teams)', () => {
  it('lists each team with its job titles and what it can do', async () => {
    const roleRepository = {
      listRolesWithPermissionsByNames: vi.fn(async () => [
        {
          id: 'role-sales',
          name: 'sales',
          permissions: [{ key: 'sales.leads.manage', description: 'Manage leads' }],
        },
      ]),
    };
    const service = new RoleService(roleRepository as never, { log: vi.fn() } as never, vi.fn());
    await expect(service.listStaffTeams()).resolves.toEqual([
      {
        id: 'role-sales',
        name: 'sales',
        teamRoles: ['salesperson', 'asm'],
        capabilities: ['Manage leads'],
      },
    ]);
    expect(roleRepository.listRolesWithPermissionsByNames).toHaveBeenCalledWith([...STAFF_TEAMS]);
  });
});
