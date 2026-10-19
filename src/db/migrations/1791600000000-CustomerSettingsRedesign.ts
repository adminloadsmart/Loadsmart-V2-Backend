import { MigrationInterface, QueryRunner } from 'typeorm';

// Settings redesign — Customers: GST verification bookkeeping, registered address, commercial
// terms (invoice against, free hours, balance, credit limit), notes; multiple contacts
// (customer_contacts, backfilled from the legacy contact_person_* columns, which stay as a
// mirror of the first contact); unloading-point POC, map pin and geofence.
const GST_STATES = `('01', 'Jammu and Kashmir'),('02', 'Himachal Pradesh'),('03', 'Punjab'),('04', 'Chandigarh'),('05', 'Uttarakhand'),('06', 'Haryana'),('07', 'Delhi'),('08', 'Rajasthan'),('09', 'Uttar Pradesh'),('10', 'Bihar'),('11', 'Sikkim'),('12', 'Arunachal Pradesh'),('13', 'Nagaland'),('14', 'Manipur'),('15', 'Mizoram'),('16', 'Tripura'),('17', 'Meghalaya'),('18', 'Assam'),('19', 'West Bengal'),('20', 'Jharkhand'),('21', 'Odisha'),('22', 'Chhattisgarh'),('23', 'Madhya Pradesh'),('24', 'Gujarat'),('26', 'Dadra and Nagar Haveli and Daman and Diu'),('27', 'Maharashtra'),('29', 'Karnataka'),('30', 'Goa'),('31', 'Lakshadweep'),('32', 'Kerala'),('33', 'Tamil Nadu'),('34', 'Puducherry'),('35', 'Andaman and Nicobar Islands'),('36', 'Telangana'),('37', 'Andhra Pradesh'),('38', 'Ladakh'),('97', 'Other Territory')`;

export class CustomerSettingsRedesign1791600000000 implements MigrationInterface {
  name = 'CustomerSettingsRedesign1791600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "customers"."customers_gst_verification_status_enum" AS ENUM('verified', 'unverified')`,
    );
    await queryRunner.query(
      `CREATE TYPE "customers"."customers_invoice_against_enum" AS ENUM('original_pod', 'soft_copy')`,
    );
    await queryRunner.query(`
      ALTER TABLE "customers"."customers"
        ADD "registered_address" text,
        ADD "registered_city" character varying(100),
        ADD "place_of_supply" character varying(100),
        ADD "gst_verification_status" "customers"."customers_gst_verification_status_enum" NOT NULL DEFAULT 'unverified',
        ADD "gst_verification_id" uuid,
        ADD "gst_verified_at" TIMESTAMP WITH TIME ZONE,
        ADD "gst_registry_name" character varying(255),
        ADD "gst_name_matched" boolean,
        ADD "invoice_against" "customers"."customers_invoice_against_enum",
        ADD "free_hours_at_drop" integer,
        ADD "balance_amount" numeric(14,2),
        ADD "credit_limit" numeric(14,2),
        ADD "notes" text,
        ADD CONSTRAINT "FK_customers_gst_verification" FOREIGN KEY ("gst_verification_id") REFERENCES "masters"."gst_verifications"("id") ON DELETE SET NULL
    `);
    // Place of supply = the GSTIN's state for every existing customer that has one.
    await queryRunner.query(`
      UPDATE "customers"."customers" c SET "place_of_supply" = s.name
      FROM (VALUES ${GST_STATES}) AS s(code, name)
      WHERE c."gstin" IS NOT NULL AND LEFT(c."gstin", 2) = s.code
    `);

    await queryRunner.query(`
      CREATE TABLE "customers"."customer_contacts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "customer_id" uuid NOT NULL,
        "tenant_id" uuid NOT NULL,
        "full_name" character varying(150),
        "designation" character varying(100),
        "phone" character varying(15),
        "is_whatsapp" boolean NOT NULL DEFAULT false,
        "email" character varying(255),
        "sort_order" smallint NOT NULL DEFAULT 0,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_contacts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_customer_contacts_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"."customers"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "customer_contacts_tenant_customer_idx" ON "customers"."customer_contacts" ("tenant_id", "customer_id")`,
    );
    await queryRunner.query(`
      INSERT INTO "customers"."customer_contacts" ("customer_id", "tenant_id", "full_name", "designation", "phone", "email", "sort_order")
      SELECT "id", "tenant_id", "contact_person_name", "contact_person_designation",
             LEFT(COALESCE("contact_person_number", "mobile"), 15),
             COALESCE("contact_person_email", "email"), 0
      FROM "customers"."customers"
      WHERE "deleted_at" IS NULL
        AND ("contact_person_name" IS NOT NULL OR "contact_person_number" IS NOT NULL
             OR "contact_person_email" IS NOT NULL)
    `);

    await queryRunner.query(
      `CREATE TYPE "customers"."customer_delivery_points_location_source_enum" AS ENUM('google_places', 'manual')`,
    );
    await queryRunner.query(`
      ALTER TABLE "customers"."customer_delivery_points"
        ADD "latitude" numeric(10,6),
        ADD "longitude" numeric(10,6),
        ADD "google_place_id" character varying(255),
        ADD "location_source" "customers"."customer_delivery_points_location_source_enum" NOT NULL DEFAULT 'manual',
        ADD "geofence_radius_m" integer NOT NULL DEFAULT 300,
        ADD "poc_name" character varying(150),
        ADD "poc_phone" character varying(15),
        ADD "poc_email" character varying(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "customers"."customer_delivery_points"
        DROP COLUMN "poc_email", DROP COLUMN "poc_phone", DROP COLUMN "poc_name",
        DROP COLUMN "geofence_radius_m", DROP COLUMN "location_source",
        DROP COLUMN "google_place_id", DROP COLUMN "longitude", DROP COLUMN "latitude"
    `);
    await queryRunner.query(
      `DROP TYPE "customers"."customer_delivery_points_location_source_enum"`,
    );
    await queryRunner.query(`DROP INDEX "customers"."customer_contacts_tenant_customer_idx"`);
    await queryRunner.query(`DROP TABLE "customers"."customer_contacts"`);
    await queryRunner.query(`
      ALTER TABLE "customers"."customers"
        DROP CONSTRAINT "FK_customers_gst_verification",
        DROP COLUMN "notes", DROP COLUMN "credit_limit", DROP COLUMN "balance_amount",
        DROP COLUMN "free_hours_at_drop", DROP COLUMN "invoice_against",
        DROP COLUMN "gst_name_matched", DROP COLUMN "gst_registry_name",
        DROP COLUMN "gst_verified_at", DROP COLUMN "gst_verification_id",
        DROP COLUMN "gst_verification_status", DROP COLUMN "place_of_supply",
        DROP COLUMN "registered_city", DROP COLUMN "registered_address"
    `);
    await queryRunner.query(`DROP TYPE "customers"."customers_invoice_against_enum"`);
    await queryRunner.query(`DROP TYPE "customers"."customers_gst_verification_status_enum"`);
  }
}
