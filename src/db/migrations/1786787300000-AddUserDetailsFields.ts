import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserDetailsFields1786787300000 implements MigrationInterface {
  name = 'AddUserDetailsFields1786787300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth"."users" ADD "designation" character varying`);
    await queryRunner.query(
      `ALTER TABLE "auth"."users" ADD "manual_designation" character varying`,
    );
    await queryRunner.query(`ALTER TABLE "auth"."users" ADD "department" character varying`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth"."users" DROP COLUMN "department"`);
    await queryRunner.query(`ALTER TABLE "auth"."users" DROP COLUMN "manual_designation"`);
    await queryRunner.query(`ALTER TABLE "auth"."users" DROP COLUMN "designation"`);
  }
}
