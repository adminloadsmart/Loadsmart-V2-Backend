// One-off seed script for the fixed roles/permissions catalog (see
// modules/roles/entities/role.entity.ts). Run by hand after `synchronize: true` has created the
// auth.permissions/roles/role_permissions/user_permissions tables — there is no TypeORM
// migration for this (schema stays on synchronize per project decision). Safe to re-run: every
// permission/role is upserted by its unique key/name, and each role's permission set is fully
// replaced (not appended to) on every run.
//
// IMPORTANT — run this before anyone signs up: verifyOtp resolves the org_admin role by name at
// signup time and fails if it isn't seeded yet.
//
// If auth.users already has rows from before this change, roleId is a NOT NULL column with no
// backfill path here (see RBAC plan's "remove all data" decision) — clear auth.users (and its
// dependents: refresh_tokens, login_attempts) manually first, or `synchronize` will fail trying
// to add the column.
//
// Usage: npm run seed:roles

import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { PermissionEntity, PermissionScope } from '../modules/roles/entities/permission.entity';
import { RoleEntity, RoleScope } from '../modules/roles/entities/role.entity';
import {
  ADMIN_ORGANIZATIONS_MANAGE,
  ORGANIZATION_PROFILE_MANAGE,
  MASTERS_WRITE,
  KYC_ONLINE_VERIFY,
  KYC_ONLINE_REJECT,
  KYC_OFFLINE_VERIFY,
  KYC_OFFLINE_REJECT,
  LOADS_CONSOLE_ACCESS,
  SALES_LEADS_MANAGE,
} from '../shared/constants/permissions';
import {
  PLATFORM_ADMIN_ROLE,
  ORG_ADMIN_ROLE,
  SALES_CS_ROLE,
  DISPATCH_ROLE,
  DOCUMENTS_OPS_ROLE,
  FINANCE_ACCOUNTS_ROLE,
} from '../shared/constants/roles';

const PERMISSIONS: { key: string; module: string; scope: PermissionScope; description: string }[] =
  [
    {
      key: ADMIN_ORGANIZATIONS_MANAGE,
      module: 'admin',
      scope: 'platform',
      description: 'Manage organizations across all tenants',
    },
    {
      key: ORGANIZATION_PROFILE_MANAGE,
      module: 'auth',
      scope: 'organization',
      description: "Create/update the caller's own organization profile",
    },
    {
      key: MASTERS_WRITE,
      module: 'masters',
      scope: 'organization',
      description: 'Create/update/delete vehicles, drivers, and their documents',
    },
    {
      key: KYC_ONLINE_VERIFY,
      module: 'onboarding',
      scope: 'platform',
      description: 'Verify KYC submitted online',
    },
    {
      key: KYC_ONLINE_REJECT,
      module: 'onboarding',
      scope: 'platform',
      description: 'Reject KYC submitted online',
    },
    {
      key: KYC_OFFLINE_VERIFY,
      module: 'onboarding',
      scope: 'platform',
      description: 'Verify KYC submitted offline',
    },
    {
      key: KYC_OFFLINE_REJECT,
      module: 'onboarding',
      scope: 'platform',
      description: 'Reject KYC submitted offline',
    },
    {
      key: LOADS_CONSOLE_ACCESS,
      module: 'dispatch',
      scope: 'platform',
      description: 'Access the load console',
    },
    {
      key: SALES_LEADS_MANAGE,
      module: 'sales',
      scope: 'platform',
      description: 'Manage sales leads',
    },
  ];

// role name -> permission keys. platform_admin gets none: its bypass is code-level
// (require-permission.middleware.ts), not data, so this list never needs updating when a new
// permission key is added.
const ROLES: { name: string; scope: RoleScope; permissionKeys: string[] }[] = [
  { name: PLATFORM_ADMIN_ROLE, scope: 'platform', permissionKeys: [] },
  { name: 'sales', scope: 'platform', permissionKeys: [SALES_LEADS_MANAGE] },
  {
    name: 'online_kyc_desk',
    scope: 'platform',
    permissionKeys: [KYC_ONLINE_VERIFY, KYC_ONLINE_REJECT],
  },
  {
    name: 'offline_kyc_desk',
    scope: 'platform',
    permissionKeys: [KYC_OFFLINE_VERIFY, KYC_OFFLINE_REJECT],
  },
  { name: 'load_console', scope: 'platform', permissionKeys: [LOADS_CONSOLE_ACCESS] },
  {
    name: ORG_ADMIN_ROLE,
    scope: 'organization',
    permissionKeys: [ORGANIZATION_PROFILE_MANAGE, MASTERS_WRITE],
  },
  // Teammate roles an org admin can invite (POST /auth/organization/users) — Settings → Users &
  // Roles. No permissionKeys yet: their real access (requisition, dispatch/planning, loading
  // docs, advance/balance payments — PRD §6) belongs to the Load module, which doesn't exist yet.
  // Attach real permission keys here once those endpoints are built.
  { name: SALES_CS_ROLE, scope: 'organization', permissionKeys: [] },
  { name: DISPATCH_ROLE, scope: 'organization', permissionKeys: [] },
  { name: DOCUMENTS_OPS_ROLE, scope: 'organization', permissionKeys: [] },
  { name: FINANCE_ACCOUNTS_ROLE, scope: 'organization', permissionKeys: [] },
];

async function seed(): Promise<void> {
  const dataSource = await AppDataSource.initialize();

  try {
    const permissionRepo = dataSource.getRepository(PermissionEntity);
    const roleRepo = dataSource.getRepository(RoleEntity);

    const permissionByKey = new Map<string, PermissionEntity>();
    for (const p of PERMISSIONS) {
      let permission = await permissionRepo.findOneBy({ key: p.key });
      if (!permission) {
        permission = await permissionRepo.save(permissionRepo.create(p));
        console.log(`created permission ${p.key}`);
      } else {
        await permissionRepo.save({
          ...permission,
          module: p.module,
          scope: p.scope,
          description: p.description,
        });
      }
      permissionByKey.set(p.key, permission);
    }

    for (const r of ROLES) {
      // relations: { permissions: true } so TypeORM has the current join-table rows loaded to diff
      // against — without it, re-assigning `.permissions` on save() would try to re-insert rows
      // that already exist and fail the composite PK on role_permissions on a second run.
      const existing = await roleRepo.findOne({
        where: { name: r.name },
        relations: { permissions: true },
      });
      const permissions = r.permissionKeys.map((key) => {
        const permission = permissionByKey.get(key);
        if (!permission)
          throw new Error(`Role "${r.name}" references unknown permission key "${key}"`);
        return permission;
      });

      if (!existing) {
        await roleRepo.save(roleRepo.create({ name: r.name, scope: r.scope, permissions }));
        console.log(`created role ${r.name}`);
      } else {
        existing.scope = r.scope;
        existing.permissions = permissions;
        await roleRepo.save(existing);
        console.log(`updated role ${r.name}`);
      }
    }

    console.log('Seed complete.');
  } finally {
    await dataSource.destroy();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
