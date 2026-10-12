import { MigrationInterface, QueryRunner } from 'typeorm';

// "Invitations Sent" tab: when a tenant's invite actually reached the driver (invite_sent_at —
// not created_at, since a dispatch-added driver's invite only goes out on org_admin approval, and
// Resend moves it forward) and when it lapses (invite_expires_at, DRIVER_INVITE_TTL_DAYS later).
export class AddDriverInviteTimestamps1790500000000 implements MigrationInterface {
  name = 'AddDriverInviteTimestamps1790500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ADD "invite_sent_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ADD "invite_expires_at" TIMESTAMP WITH TIME ZONE`,
    );

    // Backfill tenant-initiated relations whose invite actually went out: still pending the
    // driver, accepted, or declined by the driver. A staff-rejected dispatch driver never got one.
    await queryRunner.query(`
      UPDATE "masters"."driver_tenant_relations"
      SET "invite_sent_at" = CASE WHEN "initiated_by" = 'staff'
                                  THEN COALESCE("approved_at", "created_at")
                                  ELSE "created_at" END
      WHERE "initiated_by" IN ('fleet_owner', 'staff')
        AND (
          "status" IN ('pending_driver_review', 'active')
          OR ("status" = 'rejected' AND "driver_responded_at" IS NOT NULL)
        )
    `);
    // Invites still pending get a fresh 7 days so they don't all flip to Expired on deploy.
    await queryRunner.query(`
      UPDATE "masters"."driver_tenant_relations"
      SET "invite_expires_at" = CASE WHEN "status" = 'pending_driver_review'
                                     THEN now() + INTERVAL '7 days'
                                     ELSE "invite_sent_at" + INTERVAL '7 days' END
      WHERE "invite_sent_at" IS NOT NULL
    `);

    await queryRunner.query(
      `CREATE INDEX "driver_tenant_relations_tenant_invite_sent_idx" ON "masters"."driver_tenant_relations" ("tenant_id", "invite_sent_at") WHERE "invite_sent_at" IS NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "masters"."driver_tenant_relations_tenant_invite_sent_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" DROP COLUMN "invite_expires_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" DROP COLUMN "invite_sent_at"`,
    );
  }
}
