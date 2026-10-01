import { MigrationInterface, QueryRunner } from 'typeorm';

// One row per (tenant, notification type) — org-wide, not per-user: editable only by org_admin
// (see notification-preferences.service.ts), applies identically to every user in that org. A
// missing row means every external channel is off (opt-in default; see notify-by-type.ts).
// tenant_id is deliberately not FK'd to auth.organizations, matching notifications.tenant_id's
// existing "opaque, not validated by this module" precedent.
export class CreateNotificationPreferencesTable1789500000001 implements MigrationInterface {
  name = 'CreateNotificationPreferencesTable1789500000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notifications"."notification_preferences" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "notification_type_id" uuid NOT NULL, "email_enabled" boolean NOT NULL DEFAULT false, "sms_enabled" boolean NOT NULL DEFAULT false, "push_enabled" boolean NOT NULL DEFAULT false, "whatsapp_enabled" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_notification_preferences" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "notification_preferences_tenant_type_unique" ON "notifications"."notification_preferences" ("tenant_id", "notification_type_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications"."notification_preferences" ADD CONSTRAINT "FK_notification_preferences_type" FOREIGN KEY ("notification_type_id") REFERENCES "notifications"."notification_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications"."notification_preferences" DROP CONSTRAINT "FK_notification_preferences_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "notifications"."notification_preferences_tenant_type_unique"`,
    );
    await queryRunner.query(`DROP TABLE "notifications"."notification_preferences"`);
  }
}
