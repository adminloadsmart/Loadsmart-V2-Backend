import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Book a Demo" requests from the public landing page, in their own `marketing` schema: they are
 * prospects, not tenants, users or loads. Write-only for now; nothing in the app lists them yet.
 */
export class DemoRequests1795480000000 implements MigrationInterface {
  name = 'DemoRequests1795480000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "marketing"`);
    await queryRunner.query(
      `CREATE TYPE "marketing"."demo_requests_product_enum" AS ENUM('tms', 'fms', 'load_board', 'driver_app', 'not_sure')`,
    );
    await queryRunner.query(`
      CREATE TABLE "marketing"."demo_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "name" character varying(120) NOT NULL,
        "company_name" character varying(160) NOT NULL,
        "email" character varying(254) NOT NULL,
        "phone_number" character varying(10) NOT NULL,
        "product" "marketing"."demo_requests_product_enum" NOT NULL,
        "ip_address" character varying(45),
        "user_agent" character varying(500),
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_demo_requests" PRIMARY KEY ("id")
      )`);
    await queryRunner.query(
      `CREATE INDEX "demo_requests_created_at_idx" ON "marketing"."demo_requests" ("created_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "demo_requests_email_idx" ON "marketing"."demo_requests" ("email")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "marketing"."demo_requests"`);
    await queryRunner.query(`DROP TYPE "marketing"."demo_requests_product_enum"`);
    await queryRunner.query(`DROP SCHEMA IF EXISTS "marketing"`);
  }
}
