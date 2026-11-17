import { MigrationInterface, QueryRunner } from 'typeorm';

// Platform staff become "team members" (16 Nov Figma notes §4/§11):
//  - new profile columns: employee ID, job title within the team, reports-to, sales type/state/ASM;
//    `coverage` is renamed to `region`.
//  - the old staff roles are retired. Their holders move to the team that now does that work —
//    online/offline KYC desks → Approval (verifies onboarding), ls_verification → Placement
//    (truck/DL check before the memo), ls_pod → Payables (original POD). load_console has no
//    equivalent team, so the migration refuses to guess: reassign those users first.
//  - the new Admin team role (ls_admin) is created so the seed can fill its bundle.
//  - staff direct grants of team keys (loadsmart.*, kyc.*) are removed — one team per person —
//    and so is any direct grant of admin.organizations.manage (only the seeded owner is admin).
//  - staff passwords are cleared (OTP-only login) and their sessions revoked.
// Every moved or changed user gets a permissions_version bump, so a live token re-authenticates.
const ROLE_MOVES: [from: string, to: string][] = [
  ['online_kyc_desk', 'ls_approval'],
  ['offline_kyc_desk', 'ls_approval'],
  ['ls_verification', 'ls_placement'],
  ['ls_pod', 'ls_payables'],
];
const RETIRED_ROLES = [
  'online_kyc_desk',
  'offline_kyc_desk',
  'load_console',
  'ls_verification',
  'ls_pod',
];
const STAFF_TEAMS = [
  'ls_admin',
  'ls_approval',
  'ls_placement',
  'ls_tracking',
  'ls_cs',
  'ls_receivables',
  'ls_payables',
  'sales',
];

export class StaffTeamMembers1794200000000 implements MigrationInterface {
  name = 'StaffTeamMembers1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // (auth.users' phone column is literally "phoneNumber" — schema drift from InitialSchema.)
    // 1. Refuse to run while an active user still holds load_console — there's no correct team to
    // guess for the console lead. Reassign via PATCH /v1/admin/staff/:id before deploying.
    const consoleUsers: { id: string; full_name: string | null; phone_number: string }[] =
      await queryRunner.query(
        `SELECT u."id", u."full_name", u."phoneNumber" AS "phone_number" FROM "auth"."users" u
           JOIN "auth"."roles" r ON r."id" = u."role_id"
          WHERE r."name" = 'load_console' AND u."deleted_at" IS NULL`,
      );
    if (consoleUsers.length > 0) {
      const names = consoleUsers
        .map((user) => `${user.full_name ?? '(no name)'} ${user.phone_number} [${user.id}]`)
        .join('; ');
      throw new Error(
        `StaffTeamMembers: ${consoleUsers.length} active user(s) still hold the retired ` +
          `load_console role — move them to a team first: ${names}`,
      );
    }

    // 2. Profile columns.
    await queryRunner.query(`ALTER TABLE "auth"."users" RENAME COLUMN "coverage" TO "region"`);
    await queryRunner.query(
      `ALTER TABLE "auth"."users"
         ADD COLUMN "employee_id" character varying,
         ADD COLUMN "team_role" character varying,
         ADD COLUMN "reports_to_user_id" uuid,
         ADD COLUMN "state" character varying,
         ADD COLUMN "sales_type" character varying,
         ADD COLUMN "asm_user_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."users" ADD CONSTRAINT "FK_users_reports_to_user"
         FOREIGN KEY ("reports_to_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."users" ADD CONSTRAINT "FK_users_asm_user"
         FOREIGN KEY ("asm_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL`,
    );
    // Unique per team, not globally: the notes' one exception (a person doing CS + Tracking) gets a
    // second account on the other team, carrying the same employee ID.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "users_employee_id_team_active_unique" ON "auth"."users"
         ("employee_id", "role_id") WHERE "deleted_at" IS NULL AND "employee_id" IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE INDEX "users_reports_to_user_id_idx" ON "auth"."users" ("reports_to_user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "users_asm_user_id_idx" ON "auth"."users" ("asm_user_id")`,
    );

    // 3. The Admin team role — its permission bundle is filled by seed:roles right after.
    await queryRunner.query(
      `INSERT INTO "auth"."roles" ("name", "scope") VALUES ('ls_admin', 'platform')
         ON CONFLICT ("name") DO NOTHING`,
    );
    // The other teams normally exist already; make sure the move targets do.
    for (const team of ['ls_approval', 'ls_placement', 'ls_payables']) {
      await queryRunner.query(
        `INSERT INTO "auth"."roles" ("name", "scope") VALUES ($1, 'platform')
           ON CONFLICT ("name") DO NOTHING`,
        [team],
      );
    }

    // 4. Move holders of retired roles (active and soft-deleted alike — the FK needs every row
    // off the role before it can be deleted).
    for (const [from, to] of ROLE_MOVES) {
      await queryRunner.query(
        `UPDATE "auth"."users" u
            SET "role_id" = (SELECT "id" FROM "auth"."roles" WHERE "name" = $2),
                "permissions_version" = u."permissions_version" + 1
          WHERE u."role_id" = (SELECT "id" FROM "auth"."roles" WHERE "name" = $1)`,
        [from, to],
      );
    }
    // Soft-deleted load_console users (active ones aborted above) — parked on ls_admin; they're
    // deleted, so this grants nothing.
    await queryRunner.query(
      `UPDATE "auth"."users"
          SET "role_id" = (SELECT "id" FROM "auth"."roles" WHERE "name" = 'ls_admin')
        WHERE "role_id" = (SELECT "id" FROM "auth"."roles" WHERE "name" = 'load_console')`,
    );

    // 5. Staff direct grants of team keys — one team per person; a Placement member directly
    // granted loadsmart.tracking would effectively be on two teams.
    await queryRunner.query(
      `UPDATE "auth"."users" u SET "permissions_version" = u."permissions_version" + 1
        WHERE u."tenant_id" IS NULL AND EXISTS (
          SELECT 1 FROM "auth"."user_permissions" up
            JOIN "auth"."permissions" p ON p."id" = up."permission_id"
           WHERE up."user_id" = u."id" AND (p."key" LIKE 'loadsmart.%' OR p."key" LIKE 'kyc.%'))`,
    );
    await queryRunner.query(
      `DELETE FROM "auth"."user_permissions" up
        USING "auth"."permissions" p, "auth"."users" u
        WHERE p."id" = up."permission_id" AND u."id" = up."user_id" AND u."tenant_id" IS NULL
          AND (p."key" LIKE 'loadsmart.%' OR p."key" LIKE 'kyc.%')`,
    );

    // admin.organizations.manage makes its holder a platform admin (isPlatformAdministrator);
    // there is exactly one, the seeded owner, whose power is a code-level bypass, not this grant.
    await queryRunner.query(
      `UPDATE "auth"."users" u SET "permissions_version" = u."permissions_version" + 1
        WHERE EXISTS (
          SELECT 1 FROM "auth"."user_permissions" up
            JOIN "auth"."permissions" p ON p."id" = up."permission_id"
           WHERE up."user_id" = u."id" AND p."key" = 'admin.organizations.manage')`,
    );
    await queryRunner.query(
      `DELETE FROM "auth"."user_permissions" up USING "auth"."permissions" p
        WHERE p."id" = up."permission_id" AND p."key" = 'admin.organizations.manage'`,
    );

    // 6. Retire the old roles (role_permissions cascade).
    await queryRunner.query(`DELETE FROM "auth"."roles" WHERE "name" = ANY($1)`, [RETIRED_ROLES]);

    // 7. OTP-only login for team members — clear passwords and revoke live refresh tokens.
    // refresh_tokens.user_id is varchar (see auth.repository.ts), hence the ::text cast.
    await queryRunner.query(
      `UPDATE "auth"."refresh_tokens" SET "revoked_at" = now()
        WHERE "revoked_at" IS NULL AND "user_id" IN (
          SELECT u."id"::text FROM "auth"."users" u JOIN "auth"."roles" r ON r."id" = u."role_id"
           WHERE r."name" = ANY($1) AND u."password_hash" IS NOT NULL)`,
      [STAFF_TEAMS],
    );
    await queryRunner.query(
      `UPDATE "auth"."users" u SET "password_hash" = NULL
         FROM "auth"."roles" r
        WHERE r."id" = u."role_id" AND r."name" = ANY($1) AND u."password_hash" IS NOT NULL`,
      [STAFF_TEAMS],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Roles come back (empty — seed:roles of the previous release refills their bundles); moved
    // users stay on their new teams, cleared passwords and removed direct grants are not restored.
    for (const name of RETIRED_ROLES) {
      await queryRunner.query(
        `INSERT INTO "auth"."roles" ("name", "scope") VALUES ($1, 'platform')
           ON CONFLICT ("name") DO NOTHING`,
        [name],
      );
    }
    await queryRunner.query(
      `UPDATE "auth"."users"
          SET "role_id" = (SELECT "id" FROM "auth"."roles" WHERE "name" = 'load_console'),
              "permissions_version" = "permissions_version" + 1
        WHERE "role_id" = (SELECT "id" FROM "auth"."roles" WHERE "name" = 'ls_admin')`,
    );
    await queryRunner.query(`DELETE FROM "auth"."roles" WHERE "name" = 'ls_admin'`);
    await queryRunner.query(`DROP INDEX "auth"."users_asm_user_id_idx"`);
    await queryRunner.query(`DROP INDEX "auth"."users_reports_to_user_id_idx"`);
    await queryRunner.query(`DROP INDEX "auth"."users_employee_id_team_active_unique"`);
    await queryRunner.query(`ALTER TABLE "auth"."users" DROP CONSTRAINT "FK_users_asm_user"`);
    await queryRunner.query(
      `ALTER TABLE "auth"."users" DROP CONSTRAINT "FK_users_reports_to_user"`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."users"
         DROP COLUMN "asm_user_id",
         DROP COLUMN "sales_type",
         DROP COLUMN "state",
         DROP COLUMN "reports_to_user_id",
         DROP COLUMN "team_role",
         DROP COLUMN "employee_id"`,
    );
    await queryRunner.query(`ALTER TABLE "auth"."users" RENAME COLUMN "region" TO "coverage"`);
  }
}
