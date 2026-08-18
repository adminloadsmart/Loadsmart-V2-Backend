import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Structured picker fields for Dispatch Planning's truck-type selection (Plan Dispatch v2.0
 * §6.6): body type, axle/wheel configuration, capacity and deck volume. `masters.truck_types`
 * predates this migration and (like `masters.transporters` used to) has no CREATE migration of
 * its own — only ever created via dev-mode `synchronize` — so this is additive-only, never
 * assuming a clean base.
 */
export class AlterTruckTypesAddDispatchFields1786899000000 implements MigrationInterface {
  name = 'AlterTruckTypesAddDispatchFields1786899000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "masters"."truck_types_body_type_enum" AS ENUM('open_body', 'container', 'lcv_open_body', 'lcv_container', 'trailer_dala_body', 'trailer_flat_bed', 'tanker', 'tipper', 'bulker', 'mini_pickup')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."truck_types" ADD "body_type" "masters"."truck_types_body_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."truck_types" ADD "wheel_configuration" smallint`,
    );
    await queryRunner.query(`ALTER TABLE "masters"."truck_types" ADD "capacity_tons" numeric(6,2)`);
    await queryRunner.query(
      `ALTER TABLE "masters"."truck_types" ADD "deck_volume_cubic_meters" numeric(8,2)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."truck_types" DROP COLUMN "deck_volume_cubic_meters"`,
    );
    await queryRunner.query(`ALTER TABLE "masters"."truck_types" DROP COLUMN "capacity_tons"`);
    await queryRunner.query(
      `ALTER TABLE "masters"."truck_types" DROP COLUMN "wheel_configuration"`,
    );
    await queryRunner.query(`ALTER TABLE "masters"."truck_types" DROP COLUMN "body_type"`);
    await queryRunner.query(`DROP TYPE "masters"."truck_types_body_type_enum"`);
  }
}
