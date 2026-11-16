import { MigrationInterface, QueryRunner } from 'typeorm';

/** Version 1 of Super Admin → Settings: the spec's "Value today" column. Written out in full here
 *  (not read from code) so a later change to the code defaults never rewrites version 1. */
const VERSION_1 = {
  centralMarginPercent: 5,
  marginFloorPercent: 2,
  minReportingLeadMinutes: 30,
  memoExpiryMinutes: 60,
  defaultCarrierAdvancePercent: 90,
  originalPodDueDays: 15,
  originalPodPenaltyPerDay: 100,
  defaultShipperCreditDays: 3,
  maxShipperCreditDays: 10,
  reasonCodes: [
    { code: 'bid_other_than_l1', label: 'Bid other than L1', active: true },
    { code: 'load_lost', label: 'Load lost', active: true },
    { code: 'carrier_not_interested', label: 'Carrier not interested', active: true },
    { code: 'no_vehicle', label: 'No vehicle', active: true },
    { code: 'truck_cancelled_by_carrier', label: 'Truck cancelled by carrier', active: true },
    { code: 'shipper_cancelled', label: 'Shipper cancelled', active: true },
    { code: 'document_rejected', label: 'Document rejected', active: true },
    { code: 'driver_dl_failed_check', label: 'Driver DL failed check', active: true },
  ],
};

/** Retired role → where its users go. The Approval team is the KYC desks; the spec has no
 *  Verification team (checks are automatic, Placement sends the memo) and gives the original POD
 *  to Payables. */
const ROLE_MOVES: [from: string, to: string][] = [
  ['ls_approval', 'online_kyc_desk'],
  ['ls_verification', 'ls_placement'],
  ['ls_pod', 'ls_payables'],
];
const RETIRED_KEYS = ['loadsmart.verification', 'loadsmart.pod'];

/**
 * Load module Phase 0:
 * - loads.settings_versions (S03) with version 1, and loads.settings_version_id — the version a
 *   load was posted under, which every timer and threshold on it reads.
 * - Retires ls_approval / ls_verification / ls_pod and the two permission keys only they used.
 *   seed-roles upserts but never deletes, so the rows go here. Runs before seed-roles on deploy
 *   (.github/workflows/deploy.yml); on a fresh database there is nothing to move.
 */
export class LoadSettingsAndRetireTeamRoles1794200000000 implements MigrationInterface {
  name = 'LoadSettingsAndRetireTeamRoles1794200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "loads"."settings_versions" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "version" integer NOT NULL,
        "settings" jsonb NOT NULL,
        "note" text,
        "created_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_settings_versions" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "settings_versions_version_unique" ON "loads"."settings_versions" ("version")`,
    );
    await queryRunner.query(
      `INSERT INTO "loads"."settings_versions" ("version", "settings", "note") VALUES (1, $1, $2)`,
      [JSON.stringify(VERSION_1), 'Initial values from the Load module specification'],
    );

    await queryRunner.query(`ALTER TABLE "loads"."loads" ADD "settings_version_id" uuid`);
    await queryRunner.query(`
      ALTER TABLE "loads"."loads" ADD CONSTRAINT "FK_loads_settings_version"
        FOREIGN KEY ("settings_version_id") REFERENCES "loads"."settings_versions"("id")
        ON DELETE RESTRICT`);

    for (const [from, to] of ROLE_MOVES) {
      // Bump permissions_version so the moved users' tokens are re-issued with the new role.
      await queryRunner.query(
        `UPDATE "auth"."users" u
            SET "role_id" = target."id", "permissions_version" = u."permissions_version" + 1
           FROM "auth"."roles" retired, "auth"."roles" target
          WHERE u."role_id" = retired."id" AND retired."name" = $1 AND target."name" = $2`,
        [from, to],
      );
      const [{ count }] = await queryRunner.query(
        `SELECT count(*)::int AS count FROM "auth"."users" u
           JOIN "auth"."roles" r ON r."id" = u."role_id" WHERE r."name" = $1`,
        [from],
      );
      if (count > 0) {
        throw new Error(
          `${count} user(s) still hold ${from}: role ${to} does not exist yet. Run seed-roles, then this migration.`,
        );
      }
      await queryRunner.query(
        `DELETE FROM "auth"."role_permissions"
          WHERE "role_id" IN (SELECT "id" FROM "auth"."roles" WHERE "name" = $1)`,
        [from],
      );
      await queryRunner.query(`DELETE FROM "auth"."roles" WHERE "name" = $1`, [from]);
    }

    await queryRunner.query(
      `UPDATE "auth"."users" SET "permissions_version" = "permissions_version" + 1
        WHERE "id" IN (SELECT up."user_id" FROM "auth"."user_permissions" up
                         JOIN "auth"."permissions" p ON p."id" = up."permission_id"
                        WHERE p."key" = ANY($1))`,
      [RETIRED_KEYS],
    );
    await queryRunner.query(
      `DELETE FROM "auth"."user_permissions"
        WHERE "permission_id" IN (SELECT "id" FROM "auth"."permissions" WHERE "key" = ANY($1))`,
      [RETIRED_KEYS],
    );
    await queryRunner.query(
      `DELETE FROM "auth"."role_permissions"
        WHERE "permission_id" IN (SELECT "id" FROM "auth"."permissions" WHERE "key" = ANY($1))`,
      [RETIRED_KEYS],
    );
    await queryRunner.query(`DELETE FROM "auth"."permissions" WHERE "key" = ANY($1)`, [
      RETIRED_KEYS,
    ]);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The retired roles and keys are not recreated, and moved users stay where they are: an
    // older seed-roles run recreates the rows, and nobody can be moved back automatically.
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" DROP CONSTRAINT "FK_loads_settings_version"`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "settings_version_id"`);
    await queryRunner.query(`DROP TABLE "loads"."settings_versions"`);
  }
}
