import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProductStandardRate1792800000000 implements MigrationInterface {
  name = 'AddProductStandardRate1792800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "masters"."products" ADD "standard_rate" numeric(15,2)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "masters"."products" DROP COLUMN "standard_rate"`);
  }
}
