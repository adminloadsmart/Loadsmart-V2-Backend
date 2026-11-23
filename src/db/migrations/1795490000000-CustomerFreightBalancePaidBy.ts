import { MigrationInterface, QueryRunner } from 'typeorm';

/** Add / Edit Customer "Freight balance paid by customer" toggle — stored on the customer. */
export class CustomerFreightBalancePaidBy1795490000000 implements MigrationInterface {
  name = 'CustomerFreightBalancePaidBy1795490000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customers"."customers"
        ADD COLUMN IF NOT EXISTS "freight_balance_paid_by_customer" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customers"."customers" DROP COLUMN IF EXISTS "freight_balance_paid_by_customer"
    `);
  }
}
