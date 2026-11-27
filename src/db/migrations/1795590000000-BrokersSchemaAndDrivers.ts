import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The broker master gets its own schema, `brokers`. The three existing tables are moved with
 * ALTER TABLE … SET SCHEMA — rows, indexes, check constraints and foreign keys move with them
 * (ls_partners.broker_id keeps pointing at brokers.brokers), nothing is copied or recreated.
 *
 * Adds brokers.broker_drivers (Masters → Drivers): one row per broker and licence, filled now from
 * the drivers Placement has already named on loads a broker won — the latest name, mobile, date
 * of birth and licence photos per licence.
 */
export class BrokersSchemaAndDrivers1795590000000 implements MigrationInterface {
  name = 'BrokersSchemaAndDrivers1795590000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SCHEMA IF NOT EXISTS "brokers"`);
    for (const table of ['brokers', 'broker_documents', 'broker_notes']) {
      await queryRunner.query(`ALTER TABLE IF EXISTS "loads"."${table}" SET SCHEMA "brokers"`);
    }

    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "brokers"."broker_drivers" (
         "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
         "broker_id" uuid NOT NULL,
         "full_name" varchar(150) NOT NULL,
         "mobile" varchar(15) NOT NULL,
         "is_on_whatsapp" boolean NOT NULL DEFAULT true,
         "licence_number" varchar(30) NOT NULL,
         "date_of_birth" date,
         "licence_front_file_key" text,
         "licence_back_file_key" text,
         "status" varchar(20) NOT NULL DEFAULT 'active',
         "note" varchar(500),
         "created_by" uuid,
         "updated_by" uuid,
         "created_at" timestamptz NOT NULL DEFAULT now(),
         "updated_at" timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT "broker_drivers_status_chk" CHECK ("status" IN ('active', 'inactive')),
         CONSTRAINT "FK_broker_drivers_broker" FOREIGN KEY ("broker_id")
           REFERENCES "brokers"."brokers" ("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "broker_drivers_broker_licence_uq"
         ON "brokers"."broker_drivers" ("broker_id", "licence_number")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "broker_drivers_licence_idx"
         ON "brokers"."broker_drivers" ("licence_number")`,
    );
    // Lets the driver page find a licence's loads without scanning every load.
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "loads_driver_licence_number_idx"
         ON "loads"."loads" ("driver_licence_number")
         WHERE "driver_licence_number" IS NOT NULL`,
    );
    // A licence's latest Sarathi check across tenants (brokers are platform-wide).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "load_verifications_driver_ref_idx"
         ON "loads"."load_verifications" ("subject_ref", "checked_at" DESC)
         WHERE "subject" = 'driver'`,
    );

    // Backfill: every driver Placement named on a load a broker won.
    await queryRunner.query(
      `INSERT INTO "brokers"."broker_drivers"
         ("broker_id", "full_name", "mobile", "licence_number", "date_of_birth",
          "licence_front_file_key", "licence_back_file_key", "created_at", "updated_at")
       SELECT DISTINCT ON (p.broker_id, l.driver_licence_number)
              p.broker_id, l.driver_name, l.driver_number, l.driver_licence_number,
              l.driver_date_of_birth, s.licence_front_file_key, s.licence_back_file_key,
              COALESCE(s.driver_named_at, l.updated_at), COALESCE(s.driver_named_at, l.updated_at)
         FROM "loads"."loads" l
         JOIN "loads"."ls_sourcings" s ON s.load_id = l.id
         JOIN "loads"."ls_partners" p ON p.id = s.partner_id
        WHERE p.broker_id IS NOT NULL
          AND l.driver_licence_number IS NOT NULL
          AND l.driver_name IS NOT NULL
          AND l.driver_number IS NOT NULL
        ORDER BY p.broker_id, l.driver_licence_number,
                 s.driver_named_at DESC NULLS LAST, l.updated_at DESC
       ON CONFLICT ("broker_id", "licence_number") DO NOTHING`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "loads"."load_verifications_driver_ref_idx"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "loads"."loads_driver_licence_number_idx"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "brokers"."broker_drivers"`);
    for (const table of ['broker_notes', 'broker_documents', 'brokers']) {
      await queryRunner.query(`ALTER TABLE IF EXISTS "brokers"."${table}" SET SCHEMA "loads"`);
    }
    await queryRunner.query(`DROP SCHEMA IF EXISTS "brokers"`);
  }
}
