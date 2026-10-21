import { MigrationInterface, QueryRunner } from 'typeorm';

// Bulk-imported customers with a GSTIN are verified in the background ('gst-verification' queue):
// 'pending' while the job waits on the 1-per-2-minutes IDfy limit, 'failed' when the register
// rejected the GSTIN or retries ran out — with the reason in gst_verification_error.
export class CustomerGstVerificationQueue1792500000000 implements MigrationInterface {
  name = 'CustomerGstVerificationQueue1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "customers"."customers_gst_verification_status_enum" ADD VALUE IF NOT EXISTS 'pending'`,
    );
    await queryRunner.query(
      `ALTER TYPE "customers"."customers_gst_verification_status_enum" ADD VALUE IF NOT EXISTS 'failed'`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD "gst_verification_error" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" DROP COLUMN "gst_verification_error"`,
    );
    // PostgreSQL cannot drop enum values; fold the new ones back so older code can read every row.
    await queryRunner.query(
      `UPDATE "customers"."customers" SET "gst_verification_status" = 'unverified'
       WHERE "gst_verification_status" IN ('pending', 'failed')`,
    );
  }
}
