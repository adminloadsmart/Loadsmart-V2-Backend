import { MigrationInterface, QueryRunner } from 'typeorm';

// The tenant-scoped approval-workflow record for a driver↔fleet-owner link — see
// driver-tenant-relation.entity.ts. Employment fields (salary, dateOfJoining) stay on
// masters.drivers itself (a driver has one job at a time); this table only carries the link's own
// state: who initiated it, its status, and who approved/rejected it. Schema-only; existing
// masters.drivers rows are backfilled into this table by the next migration, before
// masters.drivers itself becomes tenant-independent (1789700005000-FinalizeGlobalDriverProfile.ts).
export class CreateDriverTenantRelationsTable1789700000000 implements MigrationInterface {
  name = 'CreateDriverTenantRelationsTable1789700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "masters"."driver_tenant_relations_status_enum" AS ENUM('pending_staff_review', 'pending_driver_review', 'active', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."driver_tenant_relations_initiated_by_enum" AS ENUM('staff', 'driver', 'fleet_owner')`,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."driver_tenant_relations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "driver_id" uuid NOT NULL,
        "status" "masters"."driver_tenant_relations_status_enum" NOT NULL DEFAULT 'active',
        "initiated_by" "masters"."driver_tenant_relations_initiated_by_enum" NOT NULL,
        "initiated_by_user_id" uuid,
        "driver_responded_at" TIMESTAMP WITH TIME ZONE,
        "fleet_owner_responded_at" TIMESTAMP WITH TIME ZONE,
        "approved_by" uuid,
        "approved_at" TIMESTAMP WITH TIME ZONE,
        "rejection_reason" character varying,
        "created_by" uuid,
        "updated_by" uuid,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_driver_tenant_relations" PRIMARY KEY ("id")
      )`,
    );
    await queryRunner.query(
      `CREATE INDEX "driver_tenant_relations_tenant_id_idx" ON "masters"."driver_tenant_relations" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "driver_tenant_relations_driver_id_idx" ON "masters"."driver_tenant_relations" ("driver_id")`,
    );
    // One live-or-pending relation per tenant per driver; unlimited relations across different tenants.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "driver_tenant_relations_tenant_driver_live_unique" ON "masters"."driver_tenant_relations" ("tenant_id", "driver_id") WHERE "deleted_at" IS NULL AND "status" IN ('pending_staff_review', 'pending_driver_review', 'active')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ADD CONSTRAINT "FK_driver_tenant_relations_driver_id" FOREIGN KEY ("driver_id") REFERENCES "masters"."drivers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" DROP CONSTRAINT "FK_driver_tenant_relations_driver_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "masters"."driver_tenant_relations_tenant_driver_live_unique"`,
    );
    await queryRunner.query(`DROP INDEX "masters"."driver_tenant_relations_driver_id_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."driver_tenant_relations_tenant_id_idx"`);
    await queryRunner.query(`DROP TABLE "masters"."driver_tenant_relations"`);
    await queryRunner.query(`DROP TYPE "masters"."driver_tenant_relations_initiated_by_enum"`);
    await queryRunner.query(`DROP TYPE "masters"."driver_tenant_relations_status_enum"`);
  }
}
