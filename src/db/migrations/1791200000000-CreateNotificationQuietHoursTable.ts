import { MigrationInterface, QueryRunner } from 'typeorm';

// One row per tenant — the organisation's quiet hours (see notification-quiet-hours.entity.ts).
// tenant_id is deliberately not FK'd to auth.organizations, same "opaque" precedent as
// notification_preferences.tenant_id.
export class CreateNotificationQuietHoursTable1791200000000 implements MigrationInterface {
  name = 'CreateNotificationQuietHoursTable1791200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notifications"."notification_quiet_hours" ("tenant_id" uuid NOT NULL, "enabled" boolean NOT NULL DEFAULT false, "start_time" character varying(5) NOT NULL, "end_time" character varying(5) NOT NULL, "updated_by" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_notification_quiet_hours" PRIMARY KEY ("tenant_id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notifications"."notification_quiet_hours"`);
  }
}
