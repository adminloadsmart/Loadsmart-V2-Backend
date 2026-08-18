import { MigrationInterface, QueryRunner } from 'typeorm';

/** A truck can carry a mix of several products (Plan Dispatch v2.0 R-08) — identical across
 *  every load spawned from the same truck line. */
export class CreateLoadCargoItemsTable1786900000002 implements MigrationInterface {
  name = 'CreateLoadCargoItemsTable1786900000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "loads"."load_cargo_items" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "load_id" uuid NOT NULL, "product_id" uuid NOT NULL, "tonnes_per_truck" numeric(10,2) NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_9aaf3f7122ceffe6fbae819ddf9" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "load_cargo_items_load_idx" ON "loads"."load_cargo_items"  ("load_id") `,
    );
    await queryRunner.query(
      `CREATE INDEX "load_cargo_items_tenant_id_idx" ON "loads"."load_cargo_items"  ("tenant_id") `,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_cargo_items" ADD CONSTRAINT "FK_c18c4f16bd82a0a8867e8682b34" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_cargo_items" ADD CONSTRAINT "FK_9c6e934cf8904bde42419a660d5" FOREIGN KEY ("product_id") REFERENCES "masters"."products"("id") ON DELETE RESTRICT ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."load_cargo_items" DROP CONSTRAINT "FK_9c6e934cf8904bde42419a660d5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_cargo_items" DROP CONSTRAINT "FK_c18c4f16bd82a0a8867e8682b34"`,
    );
    await queryRunner.query(`DROP INDEX "loads"."load_cargo_items_tenant_id_idx"`);
    await queryRunner.query(`DROP INDEX "loads"."load_cargo_items_load_idx"`);
    await queryRunner.query(`DROP TABLE "loads"."load_cargo_items"`);
  }
}
