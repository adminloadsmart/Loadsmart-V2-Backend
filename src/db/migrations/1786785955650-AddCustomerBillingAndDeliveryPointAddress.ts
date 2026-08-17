import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 *customers now carry a billing address, a "balance %" payment
 * term alongside the existing advance %/credit days, and each delivery point can carry a full
 * Address Component. `location` on customer_delivery_points is kept as-is (not replaced) — the
 * new address columns are additive, optional detail alongside it.
 *
 * Also flips customer uniqueness from name to mobile — multiple customers may now share a name,
 * but a tenant's active customers must have distinct mobile numbers (mirrors TransporterEntity's
 * equivalent name→phone swap). If a tenant already has active duplicate mobiles, this migration
 * will fail on apply and those rows need de-duplicating first.
 */
export class AddCustomerBillingAndDeliveryPointAddress1786785955650 implements MigrationInterface {
  name = 'AddCustomerBillingAndDeliveryPointAddress1786785955650';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD COLUMN IF NOT EXISTS "balance_percentage" numeric(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD COLUMN IF NOT EXISTS "billing_address_line_1" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD COLUMN IF NOT EXISTS "billing_address_line_2" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD COLUMN IF NOT EXISTS "billing_landmark" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD COLUMN IF NOT EXISTS "billing_area_locality" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD COLUMN IF NOT EXISTS "billing_city" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD COLUMN IF NOT EXISTS "billing_state" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD COLUMN IF NOT EXISTS "billing_pin_code" character varying(10)`,
    );

    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" ADD COLUMN IF NOT EXISTS "address_line_1" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" ADD COLUMN IF NOT EXISTS "address_line_2" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" ADD COLUMN IF NOT EXISTS "landmark" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" ADD COLUMN IF NOT EXISTS "area_locality" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" ADD COLUMN IF NOT EXISTS "city" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" ADD COLUMN IF NOT EXISTS "state" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" ADD COLUMN IF NOT EXISTS "pin_code" character varying(10)`,
    );

    // The new invariant is one active customer per tenant/mobile. Keep the oldest
    // active row and soft-delete newer duplicates so existing data can be indexed
    // without losing customer records.
    await queryRunner.query(
      `WITH ranked_customers AS (
        SELECT
          "id",
          ROW_NUMBER() OVER (
            PARTITION BY "tenant_id", "mobile"
            ORDER BY "created_at" ASC NULLS LAST, "id" ASC
          ) AS row_number
        FROM "customers"."customers"
        WHERE "deleted_at" IS NULL
      )
      UPDATE "customers"."customers" AS customer
      SET "deleted_at" = NOW(), "updated_at" = NOW()
      FROM ranked_customers
      WHERE customer."id" = ranked_customers."id"
        AND ranked_customers.row_number > 1`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "customers_tenant_mobile_active_unique" ON "customers"."customers" ("tenant_id", "mobile") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "customers"."customers_tenant_mobile_active_unique"`);
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" DROP COLUMN "pin_code"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" DROP COLUMN "state"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" DROP COLUMN "city"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" DROP COLUMN "area_locality"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" DROP COLUMN "landmark"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" DROP COLUMN "address_line_2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" DROP COLUMN "address_line_1"`,
    );

    await queryRunner.query(`ALTER TABLE "customers"."customers" DROP COLUMN "billing_pin_code"`);
    await queryRunner.query(`ALTER TABLE "customers"."customers" DROP COLUMN "billing_state"`);
    await queryRunner.query(`ALTER TABLE "customers"."customers" DROP COLUMN "billing_city"`);
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" DROP COLUMN "billing_area_locality"`,
    );
    await queryRunner.query(`ALTER TABLE "customers"."customers" DROP COLUMN "billing_landmark"`);
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" DROP COLUMN "billing_address_line_2"`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" DROP COLUMN "billing_address_line_1"`,
    );
    await queryRunner.query(`ALTER TABLE "customers"."customers" DROP COLUMN "balance_percentage"`);
  }
}
