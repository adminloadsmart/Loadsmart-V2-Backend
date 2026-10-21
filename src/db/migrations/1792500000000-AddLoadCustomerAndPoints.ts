import { MigrationInterface, QueryRunner } from 'typeorm';

// Loads own their customer, loading/unloading points and dates directly, so loads posted without
// a requisition (Post a load) carry the same data as loads planned from one. Backfilled from the
// requisition or the posting each existing load came from.
export class AddLoadCustomerAndPoints1792500000000 implements MigrationInterface {
  name = 'AddLoadCustomerAndPoints1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "loads"."loads"
        ADD "customer_id" uuid,
        ADD "loading_point_id" uuid,
        ADD "customer_delivery_point_id" uuid,
        ADD "drop_loading_point_id" uuid,
        ADD "pickup_date" date,
        ADD "expected_delivery_date" date
    `);
    await queryRunner.query(`
      ALTER TABLE "loads"."loads"
        ADD CONSTRAINT "FK_loads_customer" FOREIGN KEY ("customer_id")
          REFERENCES "customers"."customers"("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_loads_loading_point" FOREIGN KEY ("loading_point_id")
          REFERENCES "masters"."loading_points"("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_loads_customer_delivery_point" FOREIGN KEY ("customer_delivery_point_id")
          REFERENCES "customers"."customer_delivery_points"("id") ON DELETE RESTRICT,
        ADD CONSTRAINT "FK_loads_drop_loading_point" FOREIGN KEY ("drop_loading_point_id")
          REFERENCES "masters"."loading_points"("id") ON DELETE RESTRICT
    `);
    await queryRunner.query(
      `CREATE INDEX "loads_tenant_customer_idx" ON "loads"."loads" ("tenant_id", "customer_id")`,
    );

    await queryRunner.query(`
      UPDATE "loads"."loads" l
      SET "customer_id" = r."customer_id",
          "loading_point_id" = r."loading_point_id",
          "customer_delivery_point_id" = r."customer_delivery_point_id",
          "pickup_date" = r."pickup_date",
          "expected_delivery_date" = r."expected_delivery_date"
      FROM "loads"."requisitions" r
      WHERE l."requisition_id" = r."id"
    `);
    await queryRunner.query(`
      UPDATE "loads"."loads" l
      SET "customer_id" = p."customer_id",
          "loading_point_id" = p."pickup_loading_point_id",
          "customer_delivery_point_id" = p."drop_customer_delivery_point_id",
          "drop_loading_point_id" = p."drop_loading_point_id",
          "pickup_date" = p."pickup_at"::date,
          "expected_delivery_date" = p."deliver_by_at"::date
      FROM "loads"."load_postings" p
      WHERE l."requisition_id" IS NULL AND l."posting_id" = p."id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "loads"."loads_tenant_customer_idx"`);
    await queryRunner.query(`
      ALTER TABLE "loads"."loads"
        DROP CONSTRAINT "FK_loads_drop_loading_point",
        DROP CONSTRAINT "FK_loads_customer_delivery_point",
        DROP CONSTRAINT "FK_loads_loading_point",
        DROP CONSTRAINT "FK_loads_customer",
        DROP COLUMN "expected_delivery_date",
        DROP COLUMN "pickup_date",
        DROP COLUMN "drop_loading_point_id",
        DROP COLUMN "customer_delivery_point_id",
        DROP COLUMN "loading_point_id",
        DROP COLUMN "customer_id"
    `);
  }
}
