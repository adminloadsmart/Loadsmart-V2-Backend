import { MigrationInterface, QueryRunner } from 'typeorm';

// Cancelling a pending invite used to soft-delete the relation, which dropped it from Invitations
// Sent and let the driver send a join request straight away. It now stays, with status
// `cancelled` — scoped to that one tenant's relation row, never the driver's other tenants.
export class AddDriverRelationCancelledStatus1791000000000 implements MigrationInterface {
  name = 'AddDriverRelationCancelledStatus1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "masters"."driver_tenant_relations_status_enum" ADD VALUE IF NOT EXISTS 'cancelled'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres can't drop an enum value — recreate the type without it. A cancelled invite goes
    // back to what cancel used to do: a soft-deleted pending invite.
    await queryRunner.query(
      `UPDATE "masters"."driver_tenant_relations" SET "status" = 'pending_driver_review', "deleted_at" = COALESCE("deleted_at", now()) WHERE "status" = 'cancelled'`,
    );
    await queryRunner.query(
      `ALTER TYPE "masters"."driver_tenant_relations_status_enum" RENAME TO "driver_tenant_relations_status_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."driver_tenant_relations_status_enum" AS ENUM('pending_staff_review', 'pending_driver_review', 'active', 'rejected')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ALTER COLUMN "status" TYPE "masters"."driver_tenant_relations_status_enum" USING "status"::text::"masters"."driver_tenant_relations_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ALTER COLUMN "status" SET DEFAULT 'active'`,
    );
    await queryRunner.query(`DROP TYPE "masters"."driver_tenant_relations_status_enum_old"`);
  }
}
