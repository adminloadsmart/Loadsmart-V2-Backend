import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateProductsTables1786605000000 implements MigrationInterface {
  name = 'CreateProductsTables1786605000000';
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "masters"."products_approval_status_enum" AS ENUM('pending_approval', 'approved', 'rejected')`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."products_status_enum" AS ENUM('active', 'inactive')`,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."products" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "product_details" character varying(255) NOT NULL, "hsn_code" character varying(20), "invoice_value" numeric(15,2), "billing_unit" character varying(30), "dimensions" character varying(100), "weight" numeric(12,3), "weight_unit" character varying(30), "approval_status" "masters"."products_approval_status_enum" NOT NULL DEFAULT 'pending_approval', "status" "masters"."products_status_enum" NOT NULL DEFAULT 'inactive', "created_by" uuid NOT NULL, "approved_by" uuid, "approved_at" TIMESTAMP WITH TIME ZONE, "rejected_by" uuid, "rejected_at" TIMESTAMP WITH TIME ZONE, "rejection_reason" text, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_products" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE TABLE "masters"."product_sub_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "product_id" uuid NOT NULL, "tenant_id" uuid NOT NULL, "name" character varying(255) NOT NULL, "created_by" uuid NOT NULL, "deleted_at" TIMESTAMP WITH TIME ZONE, "deleted_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_product_sub_items" PRIMARY KEY ("id"), CONSTRAINT "FK_product_sub_items_product" FOREIGN KEY ("product_id") REFERENCES "masters"."products"("id") ON DELETE NO ACTION ON UPDATE NO ACTION)`,
    );
    await queryRunner.query(
      `CREATE INDEX "products_tenant_id_idx" ON "masters"."products" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "products_tenant_status_idx" ON "masters"."products" ("tenant_id", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "products_tenant_approval_status_idx" ON "masters"."products" ("tenant_id", "approval_status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "product_sub_items_product_deleted_idx" ON "masters"."product_sub_items" ("product_id", "deleted_at")`,
    );
    await queryRunner.query(
      `CREATE INDEX "product_sub_items_tenant_product_idx" ON "masters"."product_sub_items" ("tenant_id", "product_id")`,
    );
  }
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "masters"."product_sub_items_tenant_product_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."product_sub_items_product_deleted_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."products_tenant_approval_status_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."products_tenant_status_idx"`);
    await queryRunner.query(`DROP INDEX "masters"."products_tenant_id_idx"`);
    await queryRunner.query(`DROP TABLE "masters"."product_sub_items"`);
    await queryRunner.query(`DROP TABLE "masters"."products"`);
    await queryRunner.query(`DROP TYPE "masters"."products_status_enum"`);
    await queryRunner.query(`DROP TYPE "masters"."products_approval_status_enum"`);
  }
}
