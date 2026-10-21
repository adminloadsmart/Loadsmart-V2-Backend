import { MigrationInterface, QueryRunner } from 'typeorm';

// Bulk-imported transporters with a GSTIN are verified in the background, on the same
// 'gst-verification' queue as customers: 'pending' while the job waits on the 1-per-2-minutes IDfy
// limit, 'failed' when the register rejected the GSTIN or retries ran out — reason in
// gst_verification_error.
export class TransporterGstVerificationQueue1792600000000 implements MigrationInterface {
  name = 'TransporterGstVerificationQueue1792600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "masters"."transporters_gst_verification_status_enum" ADD VALUE IF NOT EXISTS 'pending'`,
    );
    await queryRunner.query(
      `ALTER TYPE "masters"."transporters_gst_verification_status_enum" ADD VALUE IF NOT EXISTS 'failed'`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."transporters" ADD "gst_verification_error" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."transporters" DROP COLUMN "gst_verification_error"`,
    );
    // PostgreSQL cannot drop enum values; fold the new ones back so older code can read every row.
    await queryRunner.query(
      `UPDATE "masters"."transporters" SET "gst_verification_status" = 'unverified'
       WHERE "gst_verification_status" IN ('pending', 'failed')`,
    );
  }
}
