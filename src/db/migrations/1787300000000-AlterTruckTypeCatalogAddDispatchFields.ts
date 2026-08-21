import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Structured picker fields for the global truck-type catalog (Plan Dispatch v2.0 §6.6), mirroring
 * 1786899000000-AlterTruckTypesAddDispatchFields's per-tenant columns on `masters.truck_types`.
 * Additive-only: existing name-only catalog rows are untouched, all four columns are nullable.
 */
export class AlterTruckTypeCatalogAddDispatchFields1787300000000 implements MigrationInterface {
  name = 'AlterTruckTypeCatalogAddDispatchFields1787300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "masters"."truck_type_catalog_body_type_enum" AS ENUM('open_body', 'container', 'lcv_open_body', 'lcv_container', 'trailer_dala_body', 'trailer_flat_bed', 'tanker', 'tipper', 'bulker', 'mini_pickup')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."truck_type_catalog" ADD "body_type" "masters"."truck_type_catalog_body_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."truck_type_catalog" ADD "wheel_configuration" smallint`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."truck_type_catalog" ADD "capacity_tons" numeric(6,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."truck_type_catalog" ADD "deck_volume_cubic_meters" numeric(8,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."truck_type_catalog" DROP COLUMN "deck_volume_cubic_meters"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."truck_type_catalog" DROP COLUMN "capacity_tons"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."truck_type_catalog" DROP COLUMN "wheel_configuration"`,
    );
    await queryRunner.query(`ALTER TABLE "masters"."truck_type_catalog" DROP COLUMN "body_type"`);
    await queryRunner.query(`DROP TYPE "masters"."truck_type_catalog_body_type_enum"`);
  }
}
