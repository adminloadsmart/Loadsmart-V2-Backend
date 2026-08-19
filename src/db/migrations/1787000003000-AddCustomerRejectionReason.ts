import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerRejectionReason1787000003000 implements MigrationInterface {
  name = 'AddCustomerRejectionReason1787000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD COLUMN IF NOT EXISTS "rejection_reason" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" DROP COLUMN IF EXISTS "rejection_reason"`,
    );
  }
}
