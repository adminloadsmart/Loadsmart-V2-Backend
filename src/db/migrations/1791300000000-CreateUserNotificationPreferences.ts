import { MigrationInterface, QueryRunner } from 'typeorm';

// Per-user notification preferences (see user-notification-preference.entity.ts), and
// notifications.show_in_app — false when the recipient turned in-app off for that type but the
// row still exists to carry another medium's delivery (e.g. email). Existing rows stay visible.
export class CreateUserNotificationPreferences1791300000000 implements MigrationInterface {
  name = 'CreateUserNotificationPreferences1791300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notifications"."user_notification_preferences" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "user_id" uuid NOT NULL, "notification_type_id" uuid NOT NULL, "in_app_enabled" boolean NOT NULL DEFAULT true, "email_enabled" boolean NOT NULL DEFAULT false, "sms_enabled" boolean NOT NULL DEFAULT false, "push_enabled" boolean NOT NULL DEFAULT false, "whatsapp_enabled" boolean NOT NULL DEFAULT false, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_user_notification_preferences" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "user_notification_preferences_tenant_user_type_unique" ON "notifications"."user_notification_preferences" ("tenant_id", "user_id", "notification_type_id")`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications"."user_notification_preferences" ADD CONSTRAINT "FK_user_notification_preferences_type" FOREIGN KEY ("notification_type_id") REFERENCES "notifications"."notification_types"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications"."notifications" ADD "show_in_app" boolean NOT NULL DEFAULT true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications"."notifications" DROP COLUMN "show_in_app"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications"."user_notification_preferences" DROP CONSTRAINT "FK_user_notification_preferences_type"`,
    );
    await queryRunner.query(
      `DROP INDEX "notifications"."user_notification_preferences_tenant_user_type_unique"`,
    );
    await queryRunner.query(`DROP TABLE "notifications"."user_notification_preferences"`);
  }
}
