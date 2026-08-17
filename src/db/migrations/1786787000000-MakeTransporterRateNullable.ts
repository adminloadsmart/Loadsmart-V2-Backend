import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `rate` is optional for transporters. Older local schemas were created with
 * this column as NOT NULL, so inserts that omit rate fail before TypeORM can
 * persist the entity's intended null value.
 */
export class MakeTransporterRateNullable1786787000000 implements MigrationInterface {
  name = 'MakeTransporterRateNullable1786787000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."transporters" ALTER COLUMN "rate" DROP NOT NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Existing NULL rates cannot be converted safely to a required value.
    // Keep the schema nullable on rollback rather than inventing rate data.
  }
}
