import { MigrationInterface, QueryRunner } from 'typeorm';

// Schema-only: adds the columns the next migration backfills. Nullable for now — made NOT NULL
// (operational statuses/trip metrics/fleet links) once backfilled, in
// 1789700005000-FinalizeGlobalDriverProfile.ts.
export class AddRelationColumnsForDriverScopedTables1789700002000 implements MigrationInterface {
  name = 'AddRelationColumnsForDriverScopedTables1789700002000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // driver_documents/driver_verifications/driver_bank_details become person-level (visible to
    // every tenant a driver links to) — tenant_id stays as a non-enforced "originating tenant"
    // audit column, no longer an authorization key, and must go nullable: a document/bank-details
    // row created during self-registration has no tenant at all yet.
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_documents" ALTER COLUMN "tenant_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_verifications" ALTER COLUMN "tenant_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_bank_details" ALTER COLUMN "tenant_id" DROP NOT NULL`,
    );

    // "What the driver is doing right now" and trip performance are per-employment, not
    // per-person — moving from driver_id to driver_tenant_relation_id.
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" ADD "driver_tenant_relation_id" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_trip_metrics" ADD "driver_tenant_relation_id" uuid`,
    );

    // A vehicle assignment only makes sense within one employer context — fleet_driver_links
    // keeps its existing driver_id (a denormalized, globally-meaningful convenience column, kept
    // in sync at write time) and gains this as its real per-tenant reference.
    await queryRunner.query(
      `ALTER TABLE "masters"."fleet_driver_links" ADD "driver_tenant_relation_id" uuid`,
    );

    // Sessions can now be identity-scoped (no tenant chosen yet) or tenant-scoped — both nullable.
    await queryRunner.query(`ALTER TABLE "masters"."driver_sessions" ADD "tenant_id" uuid`);
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_sessions" ADD "driver_tenant_relation_id" uuid`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_sessions" DROP COLUMN "driver_tenant_relation_id"`,
    );
    await queryRunner.query(`ALTER TABLE "masters"."driver_sessions" DROP COLUMN "tenant_id"`);
    await queryRunner.query(
      `ALTER TABLE "masters"."fleet_driver_links" DROP COLUMN "driver_tenant_relation_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_trip_metrics" DROP COLUMN "driver_tenant_relation_id"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_operational_statuses" DROP COLUMN "driver_tenant_relation_id"`,
    );
    // Deliberately NOT restoring driver_verifications/driver_documents/driver_bank_details.tenant_id
    // to NOT NULL here: once a real self-registration has created a row with tenant_id IS NULL
    // (the whole point of this column going nullable), that ALTER TABLE ... SET NOT NULL fails
    // outright — and since every statement in this down() shares one transaction, a failed
    // statement here would abort and roll back the DROP COLUMNs above too, not just this one. So
    // this is a one-way door in the ordinary sense, same as FinalizeGlobalDriverProfile's tenant_id
    // note — down() restores the driver_tenant_relation_id columns' removal, not this constraint.
  }
}
