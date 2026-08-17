import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTruckTypeCatalog1786705906388 implements MigrationInterface {
  name = 'AddTruckTypeCatalog1786705906388';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "masters"."truck_type_catalog" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "name" character varying(100) NOT NULL, "created_by" uuid, "updated_by" uuid, "deleted_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_abfef1f27477afda6b66c938bbf" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "truck_type_catalog_name_active_unique" ON "masters"."truck_type_catalog"  ("name") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "masters"."truck_type_catalog_name_active_unique"`);
    await queryRunner.query(`DROP TABLE "masters"."truck_type_catalog"`);
  }
}
