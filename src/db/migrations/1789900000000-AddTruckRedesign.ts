import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add Truck drawer redesign: the Vahan-first form, the body → tyres/axle → tonnes → feet truck-type
 * picker, Owned / Financed / Attached, and the optional truck cost, GPS and tyre life blocks.
 *
 * - vehicles: picker fields (axle_type, body_length_ft), Vahan fields (weights, emission norm, raw
 *   body, financier), and a new `financed` ownership type.
 * - vehicle_documents: `road_tax` papers, and the issuer (insurer) of a document.
 * - vehicle_verification_snapshots: RTO and financier as Vahan returned them.
 * - vehicle_telemetry_meta: GPS device, insurance premium, and the attached-truck lease terms.
 * - tyre_readings: is_estimated, for the depths the whole-set preset fills in.
 */
export class AddTruckRedesign1789900000000 implements MigrationInterface {
  name = 'AddTruckRedesign1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // vehicles
    await queryRunner.query(
      `ALTER TYPE "masters"."vehicles_ownership_type_enum" ADD VALUE IF NOT EXISTS 'financed' BEFORE 'leased'`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."vehicles_axle_type_enum" AS ENUM('sxl', 'sxl_hc_9_5', 'sxl_hc_10', 'mxl', 'txl')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicles"
         ADD "axle_type" "masters"."vehicles_axle_type_enum",
         ADD "body_length_ft" character varying(10),
         ADD "gross_vehicle_weight_kg" integer,
         ADD "unladen_weight_kg" integer,
         ADD "emission_norm" character varying(20),
         ADD "vahan_body_type" character varying(50),
         ADD "financier_name" character varying(150)`,
    );

    // vehicle_documents
    await queryRunner.query(
      `ALTER TYPE "masters"."vehicle_documents_document_type_enum" ADD VALUE IF NOT EXISTS 'road_tax' BEFORE 'rc_front'`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_documents" ADD "provider_name" character varying(150)`,
    );

    // vehicle_verification_snapshots
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_verification_snapshots"
         ADD "registering_authority" character varying(100),
         ADD "financier_name" character varying(150)`,
    );

    // vehicle_telemetry_meta
    await queryRunner.query(
      `CREATE TYPE "masters"."vehicle_telemetry_meta_fuel_paid_by_enum" AS ENUM('self', 'owner', 'driver')`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."vehicle_telemetry_meta_toll_paid_by_enum" AS ENUM('self', 'owner')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_telemetry_meta"
         ADD "has_gps" boolean,
         ADD "gps_device_imei" character varying(15),
         ADD "insurance_premium_yearly" numeric(12,2),
         ADD "lease_rent_monthly" numeric(12,2),
         ADD "lease_end_date" date,
         ADD "fuel_paid_by" "masters"."vehicle_telemetry_meta_fuel_paid_by_enum",
         ADD "toll_paid_by" "masters"."vehicle_telemetry_meta_toll_paid_by_enum"`,
    );

    // tyre_readings
    await queryRunner.query(
      `ALTER TABLE "maintenance"."tyre_readings" ADD "is_estimated" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "maintenance"."tyre_readings" DROP COLUMN "is_estimated"`);

    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_telemetry_meta"
         DROP COLUMN "toll_paid_by",
         DROP COLUMN "fuel_paid_by",
         DROP COLUMN "lease_end_date",
         DROP COLUMN "lease_rent_monthly",
         DROP COLUMN "insurance_premium_yearly",
         DROP COLUMN "gps_device_imei",
         DROP COLUMN "has_gps"`,
    );
    await queryRunner.query(`DROP TYPE "masters"."vehicle_telemetry_meta_toll_paid_by_enum"`);
    await queryRunner.query(`DROP TYPE "masters"."vehicle_telemetry_meta_fuel_paid_by_enum"`);

    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_verification_snapshots"
         DROP COLUMN "financier_name",
         DROP COLUMN "registering_authority"`,
    );

    // Postgres can't drop an enum value, so swap in a type without it. road_tax rows have nowhere
    // to go and are removed; financed trucks fall back to owned.
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_documents" DROP COLUMN "provider_name"`,
    );
    await queryRunner.query(
      `DELETE FROM "masters"."vehicle_documents" WHERE "document_type" = 'road_tax'`,
    );
    await queryRunner.query(
      `ALTER TYPE "masters"."vehicle_documents_document_type_enum" RENAME TO "vehicle_documents_document_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."vehicle_documents_document_type_enum" AS ENUM('rc', 'insurance', 'permit', 'puc', 'fitness', 'rc_front', 'rc_back')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicle_documents" ALTER COLUMN "document_type" TYPE "masters"."vehicle_documents_document_type_enum" USING "document_type"::text::"masters"."vehicle_documents_document_type_enum"`,
    );
    await queryRunner.query(`DROP TYPE "masters"."vehicle_documents_document_type_enum_old"`);

    await queryRunner.query(
      `ALTER TABLE "masters"."vehicles"
         DROP COLUMN "financier_name",
         DROP COLUMN "vahan_body_type",
         DROP COLUMN "emission_norm",
         DROP COLUMN "unladen_weight_kg",
         DROP COLUMN "gross_vehicle_weight_kg",
         DROP COLUMN "body_length_ft",
         DROP COLUMN "axle_type"`,
    );
    await queryRunner.query(`DROP TYPE "masters"."vehicles_axle_type_enum"`);
    await queryRunner.query(
      `UPDATE "masters"."vehicles" SET "ownership_type" = 'owned' WHERE "ownership_type" = 'financed'`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicles" ALTER COLUMN "ownership_type" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TYPE "masters"."vehicles_ownership_type_enum" RENAME TO "vehicles_ownership_type_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "masters"."vehicles_ownership_type_enum" AS ENUM('owned', 'leased', 'attached')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicles" ALTER COLUMN "ownership_type" TYPE "masters"."vehicles_ownership_type_enum" USING "ownership_type"::text::"masters"."vehicles_ownership_type_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."vehicles" ALTER COLUMN "ownership_type" SET DEFAULT 'owned'`,
    );
    await queryRunner.query(`DROP TYPE "masters"."vehicles_ownership_type_enum_old"`);
  }
}
