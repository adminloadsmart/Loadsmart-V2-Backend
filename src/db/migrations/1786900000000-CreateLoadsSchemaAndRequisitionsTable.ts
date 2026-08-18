import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A requisition can hold multiple products (Plan Dispatch v2.0 R-02) — each is its own
 * `requisition_items` row; `requisitions` itself carries only the stored aggregate tonnage.
 */
export class CreateLoadsSchemaAndRequisitionsTable1786900000000 implements MigrationInterface {
  name = 'CreateLoadsSchemaAndRequisitionsTable1786900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Same reasoning as CreateStorageFilesTable's own CREATE SCHEMA call: this is the first
    // migration to touch the `loads` schema, so a genuinely fresh DB needs it created explicitly.
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "loads"`);

    await queryRunner.query(
      `CREATE TYPE "loads"."requisition_items_unit_enum" AS ENUM('tonnes', 'bags', 'boxes', 'cartons', 'drums', 'pallets', 'pieces')`,
    );
    await queryRunner.query(
      `CREATE TABLE "loads"."requisition_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "requisition_id" uuid NOT NULL, "product_id" uuid NOT NULL, "quantity_tonnes" numeric(10,2) NOT NULL, "quantity" numeric(12,2), "unit" "loads"."requisition_items_unit_enum", "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9abc61153c001d72d089e11c715" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "requisition_items_requisition_idx" ON "loads"."requisition_items"  ("requisition_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "requisition_items_tenant_id_idx" ON "loads"."requisition_items"  ("tenant_id") `,
    );

    await queryRunner.query(
      `CREATE TYPE "loads"."requisitions_status_enum" AS ENUM('open', 'fully_dispatched', 'closed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "loads"."requisitions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "customer_id" uuid NOT NULL, "quantity_tonnes" numeric(10,2) NOT NULL, "dispatched_tonnes" numeric(10,2) NOT NULL DEFAULT '0', "loading_point_id" uuid NOT NULL, "customer_delivery_point_id" uuid NOT NULL, "expected_delivery_date" date NOT NULL, "customer_po_number" character varying(100) NOT NULL, "status" "loads"."requisitions_status_enum" NOT NULL DEFAULT 'open', "closed_reason" character varying, "closed_at" TIMESTAMP WITH TIME ZONE, "closed_by" uuid, "created_by" uuid, "updated_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_be24649237292ddbd473f3ded92" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "requisitions_tenant_customer_idx" ON "loads"."requisitions"  ("tenant_id", "customer_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "requisitions_tenant_status_idx" ON "loads"."requisitions"  ("tenant_id", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "requisitions_tenant_id_idx" ON "loads"."requisitions"  ("tenant_id") `,
    );

    await queryRunner.query(
      `ALTER TABLE "loads"."requisition_items" ADD CONSTRAINT "FK_2afa61cf14fa20efa7dc12883dd" FOREIGN KEY ("requisition_id") REFERENCES "loads"."requisitions"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."requisition_items" ADD CONSTRAINT "FK_765128bdeed85cc8ef54b339434" FOREIGN KEY ("product_id") REFERENCES "masters"."products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."requisitions" ADD CONSTRAINT "FK_7bad680344e8faad0fac3db34e6" FOREIGN KEY ("customer_id") REFERENCES "customers"."customers"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."requisitions" ADD CONSTRAINT "FK_5ff56116cf9a510fa7c79785c3a" FOREIGN KEY ("loading_point_id") REFERENCES "masters"."loading_points"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."requisitions" ADD CONSTRAINT "FK_a5f7874ab8878713b4f0dae9c6a" FOREIGN KEY ("customer_delivery_point_id") REFERENCES "customers"."customer_delivery_points"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."requisitions" DROP CONSTRAINT "FK_a5f7874ab8878713b4f0dae9c6a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."requisitions" DROP CONSTRAINT "FK_5ff56116cf9a510fa7c79785c3a"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."requisitions" DROP CONSTRAINT "FK_7bad680344e8faad0fac3db34e6"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."requisition_items" DROP CONSTRAINT "FK_765128bdeed85cc8ef54b339434"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."requisition_items" DROP CONSTRAINT "FK_2afa61cf14fa20efa7dc12883dd"`,
    );

    await queryRunner.query(`DROP INDEX "loads"."requisitions_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "loads"."requisitions_tenant_status_idx"`);
    await queryRunner.query(`DROP INDEX "loads"."requisitions_tenant_customer_idx"`);
    await queryRunner.query(`DROP TABLE "loads"."requisitions"`);
    await queryRunner.query(`DROP TYPE "loads"."requisitions_status_enum"`);

    await queryRunner.query(`DROP INDEX "loads"."requisition_items_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "loads"."requisition_items_requisition_idx"`);
    await queryRunner.query(`DROP TABLE "loads"."requisition_items"`);
    await queryRunner.query(`DROP TYPE "loads"."requisition_items_unit_enum"`);
    // Schema left in place on down, same convention CreateStorageFilesTable's down() follows for
    // "storage" — later loads-module migrations also own it.
  }
}
