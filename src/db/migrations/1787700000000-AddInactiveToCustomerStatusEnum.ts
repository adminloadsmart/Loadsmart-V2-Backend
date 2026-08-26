import { MigrationInterface, QueryRunner } from 'typeorm';

// Adds the 'inactive' customer status used by CustomerService.updateStatus() — an
// active/inactive toggle separate from the pending/approve/reject onboarding flow.
export class AddInactiveToCustomerStatusEnum1787700000000 implements MigrationInterface {
  name = 'AddInactiveToCustomerStatusEnum1787700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TYPE "customers"."customers_status_enum" ADD VALUE 'inactive'`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Postgres can't drop enum values directly, so roll the enum back the same way TypeORM
    // does: rebuild the type under an _old name, cast the column across, drop, rename.
    await queryRunner.query(
      `CREATE TYPE "customers"."customers_status_enum_old" AS ENUM('pending', 'active', 'rejected')`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ALTER COLUMN "status" TYPE "customers"."customers_status_enum_old" USING "status"::"text"::"customers"."customers_status_enum_old"`,
    );
    await queryRunner.query(`DROP TYPE "customers"."customers_status_enum"`);
    await queryRunner.query(
      `ALTER TYPE "customers"."customers_status_enum_old" RENAME TO "customers_status_enum"`,
    );
  }
}
