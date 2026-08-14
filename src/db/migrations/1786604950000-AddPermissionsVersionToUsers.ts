import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPermissionsVersionToUsers1786604950000 implements MigrationInterface {
  name = 'AddPermissionsVersionToUsers1786604950000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."users" ADD "permissions_version" integer NOT NULL DEFAULT 1`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth"."users" DROP COLUMN "permissions_version"`);
  }
}
