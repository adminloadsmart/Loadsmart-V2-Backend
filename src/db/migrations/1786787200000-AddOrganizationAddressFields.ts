import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOrganizationAddressFields1786787200000 implements MigrationInterface {
  name = 'AddOrganizationAddressFields1786787200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth"."organizations" ADD "landmark" character varying`);
    await queryRunner.query(
      `ALTER TABLE "auth"."organizations" ADD "area_locality" character varying`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth"."organizations" DROP COLUMN "area_locality"`);
    await queryRunner.query(`ALTER TABLE "auth"."organizations" DROP COLUMN "landmark"`);
  }
}
