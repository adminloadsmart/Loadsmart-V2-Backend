import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PRD §5.3.2 (FMS-MAS-CUS-001) — customers now carry a billing address, a "balance %" payment
 * term alongside the existing advance %/credit days, and each delivery point can carry a full
 * Address Component. `location` on customer_delivery_points is kept as-is (not replaced) — the
 * new address columns are additive, optional detail alongside it.
 */
export class AddCustomerBillingAndDeliveryPointAddress1786785955650 implements MigrationInterface {
  name = 'AddCustomerBillingAndDeliveryPointAddress1786785955650';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD "balance_percentage" numeric(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD "billing_address_line_1" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD "billing_address_line_2" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD "billing_landmark" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD "billing_area_locality" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD "billing_city" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD "billing_state" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ADD "billing_pin_code" character varying(10)`,
    );

    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" ADD "address_line_1" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" ADD "address_line_2" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" ADD "landmark" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" ADD "area_locality" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" ADD "city" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" ADD "state" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customer_delivery_points" ADD "pin_code" character varying(10)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
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
