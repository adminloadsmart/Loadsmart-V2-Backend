import { MigrationInterface, QueryRunner } from 'typeorm';

// LS_N_0030 "delivery will be late": the company's own limit (minutes of projected delay before
// it's notified). Null = the default (DEFAULT_LATE_DELIVERY_THRESHOLD_MINUTES, one day). The
// tracking service reads it to decide when to send.
export class AddLateDeliveryThreshold1792400000000 implements MigrationInterface {
  name = 'AddLateDeliveryThreshold1792400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations" ADD COLUMN IF NOT EXISTS "late_delivery_threshold_minutes" integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations" DROP COLUMN IF EXISTS "late_delivery_threshold_minutes"`,
    );
  }
}
