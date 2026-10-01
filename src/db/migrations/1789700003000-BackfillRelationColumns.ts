import { MigrationInterface, QueryRunner } from 'typeorm';

// Data migration: populates the columns added by the previous migration, joining each row's old
// (tenant_id, driver_id) to the matching driver_tenant_relations row created by
// 1789700001000-BackfillDriverTenantRelationsFromDrivers.ts (1:1, since that migration created
// exactly one relation per existing drivers row).
//
// driver_sessions is different: it never stored which tenant a session was issued for (see
// driver-session.entity.ts's original shape), so there is nothing to join against — every
// currently active session is revoked instead. This forces every driver to log in again once
// this deploys; flag it ahead of the deploy window.
export class BackfillRelationColumns1789700003000 implements MigrationInterface {
  name = 'BackfillRelationColumns1789700003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "masters"."driver_operational_statuses" os
      SET "driver_tenant_relation_id" = r.id
      FROM "masters"."driver_tenant_relations" r
      WHERE r.tenant_id = os.tenant_id AND r.driver_id = os.driver_id
    `);
    await queryRunner.query(`
      UPDATE "masters"."driver_trip_metrics" tm
      SET "driver_tenant_relation_id" = r.id
      FROM "masters"."driver_tenant_relations" r
      WHERE r.tenant_id = tm.tenant_id AND r.driver_id = tm.driver_id
    `);
    await queryRunner.query(`
      UPDATE "masters"."fleet_driver_links" fdl
      SET "driver_tenant_relation_id" = r.id
      FROM "masters"."driver_tenant_relations" r
      WHERE r.tenant_id = fdl.tenant_id AND r.driver_id = fdl.driver_id
    `);

    // Self-healing: a row the join above couldn't match (no relation for its tenant_id+driver_id
    // pair) can never be correctly linked — its driver_id is either genuinely stale or, on a
    // database that went through a revert/redo cycle of this migration set, was already
    // irrecoverably lost by an earlier step's down() (see 1789700005000's down() note on
    // driver_id — it restores column shape only, not the original values). Rather than leave an
    // orphaned row to violate the NOT NULL constraint the next migration adds, delete it: this is
    // live/current-state data (operational status, trip metrics, a vehicle assignment), not an
    // audit trail, so it is safely re-creatable by normal use once the driver is active again.
    await queryRunner.query(
      `DELETE FROM "masters"."driver_operational_statuses" WHERE "driver_tenant_relation_id" IS NULL`,
    );
    await queryRunner.query(
      `DELETE FROM "masters"."driver_trip_metrics" WHERE "driver_tenant_relation_id" IS NULL`,
    );
    await queryRunner.query(
      `DELETE FROM "masters"."fleet_driver_links" WHERE "driver_tenant_relation_id" IS NULL`,
    );

    await queryRunner.query(
      `UPDATE "masters"."driver_sessions" SET "revoked_at" = now() WHERE "revoked_at" IS NULL`,
    );
  }

  public async down(): Promise<void> {
    // Not reversible: session revocation is a one-way action, and the relation-column backfill
    // is superseded (and made irreversible in the ordinary sense) once the next migration drops
    // the old driver_id columns it was computed from.
  }
}
