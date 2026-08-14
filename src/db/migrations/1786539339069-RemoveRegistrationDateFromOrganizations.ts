import { MigrationInterface, QueryRunner } from 'typeorm';

export class RemoveRegistrationDateFromOrganizations1786539339069 implements MigrationInterface {
  name = 'RemoveRegistrationDateFromOrganizations1786539339069';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations" DROP COLUMN IF EXISTS "registration_date"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth"."organizations" ADD "registration_date" date`);
  }
}
