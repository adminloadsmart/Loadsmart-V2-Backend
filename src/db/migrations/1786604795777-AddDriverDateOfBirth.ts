import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddDriverDateOfBirth1786604795777 implements MigrationInterface {
  name = 'AddDriverDateOfBirth1786604795777';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "masters"."drivers" ADD "date_of_birth" date`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "masters"."drivers" DROP COLUMN "date_of_birth"`);
  }
}
