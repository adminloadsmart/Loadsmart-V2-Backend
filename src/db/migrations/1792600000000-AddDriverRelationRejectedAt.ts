import { MigrationInterface, QueryRunner } from 'typeorm';

// Recently Rejected / Restore for driver join requests: when a tenant rejected the link and which
// staff user did it. Existing rejections are backfilled from updated_at/updated_by — reject is the
// last write a rejected row gets, and it stamps updated_by with the rejecting user. Only the
// tenant's own rejections: a driver's join request, or a dispatch-added driver the driver never
// answered. A `rejected` invite the driver declined isn't one, and stays without rejected_at.
export class AddDriverRelationRejectedAt1792600000000 implements MigrationInterface {
  name = 'AddDriverRelationRejectedAt1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ADD "rejected_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ADD "rejected_by" uuid`,
    );
    await queryRunner.query(`
      UPDATE "masters"."driver_tenant_relations"
      SET "rejected_at" = "updated_at", "rejected_by" = "updated_by"
      WHERE "status" = 'rejected'
        AND ("initiated_by" = 'driver'
             OR ("initiated_by" = 'staff' AND "driver_responded_at" IS NULL))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" DROP COLUMN "rejected_by"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" DROP COLUMN "rejected_at"`,
    );
  }
}
