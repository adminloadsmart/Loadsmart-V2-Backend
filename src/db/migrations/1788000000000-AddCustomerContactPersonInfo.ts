import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCustomerContactPersonInfo1788000000000 implements MigrationInterface {
  name = 'AddCustomerContactPersonInfo1788000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD COLUMN IF NOT EXISTS "contact_person_name" character varying(150)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD COLUMN IF NOT EXISTS "contact_person_number" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD COLUMN IF NOT EXISTS "contact_person_email" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD COLUMN IF NOT EXISTS "contact_person_designation" character varying(100)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" DROP COLUMN IF EXISTS "contact_person_designation"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" DROP COLUMN IF EXISTS "contact_person_email"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" DROP COLUMN IF EXISTS "contact_person_number"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" DROP COLUMN IF EXISTS "contact_person_name"`,
    );
  }
}
