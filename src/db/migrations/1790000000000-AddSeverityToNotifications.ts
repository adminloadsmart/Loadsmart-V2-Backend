import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Notification severity (P1 Critical / P2 Action / P3 Info — see notifications.types.ts's
 * NOTIFICATION_SEVERITIES). Added to both notifications (per sent notification) and
 * notification_types (per catalog type, for the settings screen). NOT NULL DEFAULT 'p3_info', so
 * existing rows are backfilled as Info and any producer that doesn't pass a severity keeps working;
 * seed-notification-types.ts then sets each type's real severity from the catalog.
 */
export class AddSeverityToNotifications1790000000000 implements MigrationInterface {
  name = 'AddSeverityToNotifications1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "notifications"."notifications_severity_enum" AS ENUM('p1_critical', 'p2_action', 'p3_info')`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications"."notifications" ADD "severity" "notifications"."notifications_severity_enum" NOT NULL DEFAULT 'p3_info'`,
    );
    await queryRunner.query(
      `CREATE TYPE "notifications"."notification_types_severity_enum" AS ENUM('p1_critical', 'p2_action', 'p3_info')`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications"."notification_types" ADD "severity" "notifications"."notification_types_severity_enum" NOT NULL DEFAULT 'p3_info'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications"."notification_types" DROP COLUMN "severity"`,
    );
    await queryRunner.query(`DROP TYPE "notifications"."notification_types_severity_enum"`);
    await queryRunner.query(`ALTER TABLE "notifications"."notifications" DROP COLUMN "severity"`);
    await queryRunner.query(`DROP TYPE "notifications"."notifications_severity_enum"`);
  }
}
