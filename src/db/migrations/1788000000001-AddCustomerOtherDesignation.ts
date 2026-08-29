import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerOtherDesignation1788000000001 implements MigrationInterface {
  name = 'AddCustomerOtherDesignation1788000000001';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD COLUMN IF NOT EXISTS "contact_person_designation_other" character varying(100)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" DROP COLUMN IF EXISTS "contact_person_designation_other"`,
    );
  }
}
