import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddStateToDriverVerifications1788954464272 implements MigrationInterface {
  name = 'AddStateToDriverVerifications1788954464272';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_verifications" ADD COLUMN IF NOT EXISTS "state" character varying(100)`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_verifications" DROP COLUMN IF EXISTS "state"`,
    );
  }
}
