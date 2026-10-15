import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Transporter contracts become a masters table: the lane is city + state (`lane_key` groups and
 * matches it), the rate has a unit (per tonne / per truck), and each contract carries a priority
 * (1 = P1) and a share of business for its lane.
 *
 * Existing `loads.customer_contracts` rows are copied over with the SAME ids. Their rate was per
 * trip, so the unit is `per_truck`. They stored no state: it is taken from the most common state
 * the tenant's earlier postings recorded for that city, else the row gets the placeholder state
 * 'UNRESOLVED' and an empty lane_key, which never matches a lane — fix those through the API.
 * Priority runs by creation order within a lane and share is split evenly (the remainder to P1).
 * `customer_contracts` is left in place, frozen, and dropped in a later migration once Indent is
 * verified. (`load_postings.contract_id` has no FK, so nothing needs repointing.)
 */
export class AddTransporterContracts1791100000000 implements MigrationInterface {
  name = 'AddTransporterContracts1791100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "masters"."transporter_contracts_unit_enum" AS ENUM('per_tonne', 'per_truck')`,
    );
    await queryRunner.query(`
      CREATE TABLE "masters"."transporter_contracts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "transporter_id" uuid NOT NULL,
        "contract_number" character varying(50) NOT NULL,
        "pickup_city" character varying(100) NOT NULL,
        "pickup_state" character varying(100) NOT NULL,
        "drop_city" character varying(100) NOT NULL,
        "drop_state" character varying(100) NOT NULL,
        "lane_key" character varying(300) NOT NULL,
        "rate" numeric(12,2) NOT NULL,
        "unit" "masters"."transporter_contracts_unit_enum" NOT NULL,
        "valid_from" date NOT NULL,
        "valid_to" date NOT NULL,
        "priority" smallint NOT NULL,
        "share_percent" numeric(5,2) NOT NULL,
        "created_by" uuid,
        "updated_by" uuid,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_transporter_contracts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_transporter_contracts_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"."customers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_transporter_contracts_transporter" FOREIGN KEY ("transporter_id") REFERENCES "masters"."transporters"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "transporter_contracts_tenant_customer_lane_idx" ON "masters"."transporter_contracts" ("tenant_id", "customer_id", "lane_key")`,
    );
    await queryRunner.query(
      `CREATE INDEX "transporter_contracts_tenant_transporter_idx" ON "masters"."transporter_contracts" ("tenant_id", "transporter_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "transporter_contracts_tenant_number_unique" ON "masters"."transporter_contracts" ("tenant_id", "contract_number") WHERE "deleted_at" IS NULL`,
    );

    await queryRunner.query(`
      INSERT INTO "masters"."transporter_contracts" (
        "id", "tenant_id", "customer_id", "transporter_id", "contract_number",
        "pickup_city", "pickup_state", "drop_city", "drop_state", "lane_key",
        "rate", "unit", "valid_from", "valid_to", "priority", "share_percent",
        "created_by", "deleted_at", "created_at", "updated_at"
      )
      WITH states AS (
        SELECT unnest(ARRAY['Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat', 'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh', 'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal', 'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu', 'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry']) AS name
      ),
      postings AS (
        SELECT "tenant_id",
               lower(btrim("pickup_address"->>'city')) AS pickup_city_key,
               lower(btrim("drop_address"->>'city')) AS drop_city_key,
               btrim("pickup_address"->>'state') AS pickup_state,
               btrim("drop_address"->>'state') AS drop_state
        FROM "loads"."load_postings"
      ),
      city_states AS (
        SELECT tenant_id, city_key, state, count(*) AS uses
        FROM (
          SELECT tenant_id, pickup_city_key AS city_key, pickup_state AS state FROM postings
          UNION ALL
          SELECT tenant_id, drop_city_key, drop_state FROM postings
        ) all_places
        WHERE state IN (SELECT name FROM states) AND city_key IS NOT NULL
        GROUP BY tenant_id, city_key, state
      ),
      best_state AS (
        SELECT DISTINCT ON (tenant_id, city_key) tenant_id, city_key, state
        FROM city_states
        ORDER BY tenant_id, city_key, uses DESC, state
      ),
      resolved AS (
        SELECT c.*,
               COALESCE(ps.state, 'UNRESOLVED') AS pickup_state,
               COALESCE(ds.state, 'UNRESOLVED') AS drop_state,
               CASE WHEN ps.state IS NOT NULL AND ds.state IS NOT NULL THEN
                 lower(regexp_replace(btrim(c."pickup_city"), '[[:space:]]+', ' ', 'g')) || '|' || ps.state || '|' ||
                 lower(regexp_replace(btrim(c."drop_city"), '[[:space:]]+', ' ', 'g')) || '|' || ds.state
               ELSE '' END AS lane_key
        FROM "loads"."customer_contracts" c
        LEFT JOIN best_state ps ON ps.tenant_id = c."tenant_id" AND ps.city_key = lower(btrim(c."pickup_city"))
        LEFT JOIN best_state ds ON ds.tenant_id = c."tenant_id" AND ds.city_key = lower(btrim(c."drop_city"))
      ),
      ranked AS (
        SELECT r.*,
               row_number() OVER (
                 PARTITION BY r."tenant_id", r."customer_id", CASE WHEN r.lane_key = '' THEN r."id"::text ELSE r.lane_key END
                 ORDER BY r."created_at", r."id"
               ) AS priority,
               count(*) OVER (
                 PARTITION BY r."tenant_id", r."customer_id", CASE WHEN r.lane_key = '' THEN r."id"::text ELSE r.lane_key END
               ) AS lane_size
        FROM resolved r
      )
      SELECT "id", "tenant_id", "customer_id", "transporter_id", "contract_number",
             "pickup_city", pickup_state, "drop_city", drop_state, lane_key,
             "rate", 'per_truck'::"masters"."transporter_contracts_unit_enum", "valid_from", "valid_to",
             priority,
             CASE WHEN priority = 1 THEN 100 - (lane_size - 1) * round(100.0 / lane_size, 2)
                  ELSE round(100.0 / lane_size, 2) END,
             "created_by", "deleted_at", "created_at", "updated_at"
      FROM ranked
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "masters"."transporter_contracts"`);
    await queryRunner.query(`DROP TYPE "masters"."transporter_contracts_unit_enum"`);
  }
}
