import { MigrationInterface, QueryRunner } from 'typeorm';

// Settings redesign — Products: classification, structured dimensions with a scale unit, the
// conversion model, and the server-computed volume / volumetric weight. The legacy free-text
// `dimensions` column stays.
export class ProductSettingsRedesign1791900000000 implements MigrationInterface {
  name = 'ProductSettingsRedesign1791900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "masters"."products_classification_enum" AS ENUM('non_hazardous', 'hazardous', 'fragile', 'perishable')`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."products_dimension_unit_enum" AS ENUM('m', 'cm', 'ft', 'in')`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."products_conversion_model_enum" AS ENUM('surface_road', 'express_air')`,
    );
    await queryRunner.query(`
      ALTER TABLE "masters"."products"
        ADD "classification" "masters"."products_classification_enum" NOT NULL DEFAULT 'non_hazardous',
        ADD "length" numeric(10,3),
        ADD "width" numeric(10,3),
        ADD "height" numeric(10,3),
        ADD "dimension_unit" "masters"."products_dimension_unit_enum",
        ADD "conversion_model" "masters"."products_conversion_model_enum",
        ADD "volume_cbm" numeric(12,3),
        ADD "volumetric_weight_kg" numeric(14,2)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "masters"."products"
        DROP COLUMN "volumetric_weight_kg", DROP COLUMN "volume_cbm",
        DROP COLUMN "conversion_model", DROP COLUMN "dimension_unit",
        DROP COLUMN "height", DROP COLUMN "width", DROP COLUMN "length",
        DROP COLUMN "classification"
    `);
    await queryRunner.query(`DROP TYPE "masters"."products_conversion_model_enum"`);
    await queryRunner.query(`DROP TYPE "masters"."products_dimension_unit_enum"`);
    await queryRunner.query(`DROP TYPE "masters"."products_classification_enum"`);
  }
}
