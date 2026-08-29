import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPackagingToProducts1788100000000 implements MigrationInterface {
  name = 'AddPackagingToProducts1788100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."products" ADD "packaging" character varying(30)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "masters"."products" DROP COLUMN "packaging"`);
  }
}
