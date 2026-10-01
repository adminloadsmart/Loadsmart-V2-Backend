import { MigrationInterface, QueryRunner } from 'typeorm';

// IDfy bank-account verification: stores the IDfy request_id (so the BullMQ worker can resume
// polling instead of resubmitting), the account holder name the bank returned, and the raw
// IDfy output.
export class DriverBankVerificationFields1790000000000 implements MigrationInterface {
  name = 'DriverBankVerificationFields1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_bank_details" ADD "source_reference" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_bank_details" ADD "name_at_bank" character varying(150)`,
    );
    await queryRunner.query(`ALTER TABLE "masters"."driver_bank_details" ADD "raw_response" jsonb`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_bank_details" DROP COLUMN "raw_response"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_bank_details" DROP COLUMN "name_at_bank"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_bank_details" DROP COLUMN "source_reference"`,
    );
  }
}
