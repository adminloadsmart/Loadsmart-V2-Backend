import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Customer imports are now processed statelessly. Remove the optional import
 * history table from databases where an earlier version created it, while
 * remaining safe on databases where it never existed.
 */
export class DropCustomerImportsTable1787000004000 implements MigrationInterface {
  name = 'DropCustomerImportsTable1787000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "customers"."customer_imports"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "customers"."customer_imports_status_enum"`);
  }

  public async down(_queryRunner: QueryRunner): Promise<void> {
    // Intentionally irreversible: customer import history is no longer part of
    // the application data model and cannot be restored by a rollback.
  }
}
