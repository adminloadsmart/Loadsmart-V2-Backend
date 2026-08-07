// One-off bootstrap script: creates the very first platform_admin. There's no other way to get
// one — self-signup only ever produces org_admin, and POST /admin/staff (which creates staff)
// itself requires an existing platform_admin to call it. Run this once per environment, after
// db/seed-roles.ts has seeded the role catalog (platform_admin must already exist as a row in
// auth.roles).
//
// Requires: BOOTSTRAP_ADMIN_PHONE, BOOTSTRAP_ADMIN_EMAIL, BOOTSTRAP_ADMIN_PASSWORD
// Optional: BOOTSTRAP_ADMIN_NAME (defaults to "Platform Admin")
//
// Idempotent: if a user with that phone or email already exists, this exits without changing
// anything (does NOT reset their password) — safe to re-run, e.g. from a deploy script.
//
// Usage:
//   BOOTSTRAP_ADMIN_PHONE=9999999999 BOOTSTRAP_ADMIN_EMAIL=admin@loadsmart.internal \
//   BOOTSTRAP_ADMIN_PASSWORD='...' npm run seed:platform-admin

import 'reflect-metadata';
import bcrypt from 'bcryptjs';
import { AppDataSource } from './data-source';
import { UserEntity } from '../modules/auth/entities/user.entity';
import { RoleEntity } from '../modules/roles/entities/role.entity';
import { PLATFORM_ADMIN_ROLE } from '../shared/constants/roles';
import { normalizePhoneNumber } from '../shared/utils/phone-number';

function requiredEnv(key: string): string {
  const value = process.env[key];
  if (!value) throw new Error(`Missing required env var: ${key} (see db/seed-platform-admin.ts)`);
  return value;
}

async function bootstrap(): Promise<void> {
  const phoneNumber = normalizePhoneNumber(requiredEnv('BOOTSTRAP_ADMIN_PHONE'));
  const email = requiredEnv('BOOTSTRAP_ADMIN_EMAIL');
  const password = requiredEnv('BOOTSTRAP_ADMIN_PASSWORD');
  const fullName = process.env.BOOTSTRAP_ADMIN_NAME ?? 'Platform Admin';

  const dataSource = await AppDataSource.initialize();

  try {
    const users = dataSource.getRepository(UserEntity);
    const roles = dataSource.getRepository(RoleEntity);

    const existing = await users.findOne({ where: [{ phoneNumber }, { email }] });
    if (existing) {
      console.log(
        `A user with this phone or email already exists (id: ${existing.id}) — nothing to do.`,
      );
      return;
    }

    const role = await roles.findOneBy({ name: PLATFORM_ADMIN_ROLE });
    if (!role) {
      throw new Error(
        `Seeded role "${PLATFORM_ADMIN_ROLE}" is missing — run "npm run seed:roles" first.`,
      );
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = users.create({
      phoneNumber,
      email,
      passwordHash,
      fullName,
      roleId: role.id,
      tenantId: null,
      coverage: null,
      deletedAt: null,
    });
    const saved = await users.save(user);

    console.log(`Created platform_admin user ${saved.id} (${email}).`);
  } finally {
    await dataSource.destroy();
  }
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
