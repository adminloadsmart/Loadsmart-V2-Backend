// One-off seed script for the fixed roles/permissions catalog (the data lives in
// db/role-catalog.ts; entities in modules/roles/entities/). Schema is created by TypeORM migrations (see
// db/migrations/) on any deployed server — `synchronize` is dev-only now (data-source.ts). This
// script just seeds data into the auth.permissions/roles/role_permissions/user_permissions
// tables once they exist. Safe to re-run: every permission/role is upserted by its unique
// key/name, and each role's permission set is fully replaced (not appended to) on every run.
// Auto-run on every deploy — see .github/workflows/deploy.yml.
//
// IMPORTANT — run this before anyone signs up: verifyOtp resolves the org_admin role by name at
// signup time and fails if it isn't seeded yet.
//
// If auth.users already has rows from before this change, roleId is a NOT NULL column with no
// backfill path here (see RBAC plan's "remove all data" decision) — clear auth.users (and its
// dependents: refresh_tokens, login_attempts) manually first.
//
// Usage: npm run seed:roles (or, since ts-node is currently broken against this repo's
// typescript version — see docs/rbac.md §8 — `npm run build && node -r reflect-metadata
// dist/db/seed-roles.js`)

import 'reflect-metadata';
import { AppDataSource } from './data-source';
import { PermissionEntity } from '../modules/roles/entities/permission.entity';
import { RoleEntity } from '../modules/roles/entities/role.entity';
import { PERMISSIONS, ROLES } from './role-catalog';

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
