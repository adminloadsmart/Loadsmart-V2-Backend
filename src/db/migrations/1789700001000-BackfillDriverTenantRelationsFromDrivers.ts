import { MigrationInterface, QueryRunner } from 'typeorm';

// Data migration: one driver_tenant_relations row per existing masters.drivers row, carrying
// each row's tenant and approval fields onto its own relation before
// 1789700005000-FinalizeGlobalDriverProfile.ts drops those columns from masters.drivers.
// Employment fields (date_of_joining/salary_type/salary_amount) stay on masters.drivers — they
// aren't part of driver_tenant_relations, so there's nothing to carry over for them. Maps the
// old lifecycle status onto the new relation status: `pending` -> `pending_staff_review`
// (dispatch onboarding, awaiting org_admin approval — preserved exactly), `rejected` ->
// `rejected`, everything else (`active`/`inactive`/`on_trip`/`on_leave` — the operational-status
// values that had also, redundantly, been living on DriverEntity.status) -> `active`, since a
// relation only ever has a binary active/not-active employment state; per-tenant "what are they
// doing right now" already lives in driver_operational_statuses (see the next migration for its
// own column swap).
//
// Assumes masters.drivers has no two rows sharing a phone number across different tenants — the
// old per-tenant unique index only prevented a duplicate *within* one tenant, so this is a
// standing assumption about current data, not something this migration set enforces. If it's
// wrong, this INSERT still succeeds (it doesn't touch phone_number), but
// FinalizeGlobalDriverProfile's new global unique index on drivers.phone_number will fail to
// create — that failure is the intended signal to go clean up the duplicate by hand rather than
// something silently merged automatically.
export class BackfillDriverTenantRelationsFromDrivers1789700001000 implements MigrationInterface {
  name = 'BackfillDriverTenantRelationsFromDrivers1789700001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "masters"."driver_tenant_relations"
        (id, tenant_id, driver_id, status,
         initiated_by, initiated_by_user_id, driver_responded_at, fleet_owner_responded_at,
         approved_by, approved_at, rejection_reason, created_by, updated_by, deleted_at,
         created_at, updated_at)
      SELECT
        uuid_generate_v4(),
        d.tenant_id,
        d.id,
        CASE d.status::text
          WHEN 'pending' THEN 'pending_staff_review'
          WHEN 'rejected' THEN 'rejected'
          ELSE 'active'
        END::"masters"."driver_tenant_relations_status_enum",
        'staff',
        d.approved_by,
        NULL,
        d.created_at,
        d.approved_by,
        d.approved_at,
        d.rejection_reason,
        d.created_by,
        d.updated_by,
        d.deleted_at,
        d.created_at,
        d.updated_at
      FROM "masters"."drivers" d
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DELETE FROM "masters"."driver_tenant_relations"`);
  }
}
