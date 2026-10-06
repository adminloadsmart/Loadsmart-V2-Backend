import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds P4 Digest ('p4_digest') to both notification severity enums — the weekly idle-vehicle
 * roll-up (LS_N_0059) and the daily morning brief (LS_N_0060). Additive: existing rows keep their
 * severity. Postgres can't drop an enum value, so down() moves any p4_digest rows to p3_info and
 * recreates the enums without it.
 */
export class AddDigestSeverity1790100000000 implements MigrationInterface {
  name = 'AddDigestSeverity1790100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notifications"."notifications_severity_enum" ADD VALUE IF NOT EXISTS 'p4_digest'`,
    );
    await queryRunner.query(
      `ALTER TYPE "notifications"."notification_types_severity_enum" ADD VALUE IF NOT EXISTS 'p4_digest'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const table of ['notifications', 'notification_types']) {
      const type = `"notifications"."${table}_severity_enum"`;
      await queryRunner.query(
        `UPDATE "notifications"."${table}" SET "severity" = 'p3_info' WHERE "severity" = 'p4_digest'`,
      );
      await queryRunner.query(
        `ALTER TABLE "notifications"."${table}" ALTER COLUMN "severity" DROP DEFAULT`,
      );
      await queryRunner.query(`ALTER TYPE ${type} RENAME TO "${table}_severity_enum_old"`);
      await queryRunner.query(`CREATE TYPE ${type} AS ENUM('p1_critical', 'p2_action', 'p3_info')`);
      await queryRunner.query(
        `ALTER TABLE "notifications"."${table}" ALTER COLUMN "severity" TYPE ${type} USING "severity"::text::${type}`,
      );
      await queryRunner.query(
        `ALTER TABLE "notifications"."${table}" ALTER COLUMN "severity" SET DEFAULT 'p3_info'`,
      );
      await queryRunner.query(`DROP TYPE "notifications"."${table}_severity_enum_old"`);
    }
  }
}
