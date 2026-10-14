import { MigrationInterface, QueryRunner } from 'typeorm';

// Shipper "Post a load": postings, recipients, drafts, customer contracts; loads may now come
// from a posting instead of a requisition; customers get a CUS-nnnn code and may be added by name
// alone (mobile nullable — completed later in the Customer master).
export class AddLoadPosting1790400000000 implements MigrationInterface {
  name = 'AddLoadPosting1790400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // --- loads ---
    await queryRunner.query(
      `ALTER TYPE "loads"."loads_source_type_enum" ADD VALUE IF NOT EXISTS 'indent'`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ALTER COLUMN "requisition_id" DROP NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."loads" ADD "posting_id" uuid`);
    await queryRunner.query(
      `CREATE INDEX "loads_tenant_posting_idx" ON "loads"."loads" ("tenant_id", "posting_id")`,
    );

    // --- customers: code + nullable mobile ---
    await queryRunner.query(`ALTER TABLE "customers"."customers" ADD "code" character varying(20)`);
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ALTER COLUMN "mobile" DROP NOT NULL`,
    );
    // Backfill CUS-1001.. per tenant in creation order, then seed the counter at the tenant's count.
    await queryRunner.query(`
      UPDATE "customers"."customers" c
      SET "code" = 'CUS-' || (1000 + n.rn)
      FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY tenant_id ORDER BY created_at, id) AS rn
        FROM "customers"."customers"
      ) n
      WHERE c.id = n.id
    `);
    await queryRunner.query(`
      INSERT INTO "loads"."code_sequences" ("entity", "scope_id", "value")
      SELECT 'customer', tenant_id, COUNT(*) FROM "customers"."customers" GROUP BY tenant_id
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "customers_tenant_code_unique" ON "customers"."customers" ("tenant_id", "code") WHERE "code" IS NOT NULL AND "deleted_at" IS NULL`,
    );

    // --- enums ---
    await queryRunner.query(
      `CREATE TYPE "loads"."load_postings_mode_enum" AS ENUM('market_fleet', 'indent', 'own_fleet')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."load_postings_price_mode_enum" AS ENUM('set_target', 'ask_for_quotes')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."load_postings_price_basis_enum" AS ENUM('per_trip', 'per_tonne')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."load_postings_balance_paid_by_enum" AS ENUM('shipper', 'consignee')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."load_recipients_recipient_type_enum" AS ENUM('loadsmart', 'transporter')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."load_recipients_message_status_enum" AS ENUM('pending', 'sent', 'failed')`,
    );

    // --- load_postings ---
    await queryRunner.query(`
      CREATE TABLE "loads"."load_postings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "mode" "loads"."load_postings_mode_enum" NOT NULL,
        "customer_id" uuid,
        "pickup_loading_point_id" uuid,
        "pickup_address" jsonb NOT NULL,
        "drop_customer_delivery_point_id" uuid,
        "drop_loading_point_id" uuid,
        "drop_address" jsonb NOT NULL,
        "pickup_at" TIMESTAMP WITH TIME ZONE NOT NULL,
        "deliver_by_at" TIMESTAMP WITH TIME ZONE,
        "commodity_id" uuid,
        "commodity_name" character varying(255) NOT NULL,
        "packaging" character varying(50) NOT NULL,
        "weight_tonnes" numeric(10,2),
        "truck_count" integer NOT NULL DEFAULT 1,
        "truck_type_id" uuid,
        "truck_length_ft" character varying(20),
        "accepted_truck_type_ids" uuid[] NOT NULL DEFAULT '{}',
        "vehicle_id" uuid,
        "price_mode" "loads"."load_postings_price_mode_enum",
        "price_basis" "loads"."load_postings_price_basis_enum",
        "rate" numeric(12,2),
        "freight_total" numeric(14,2),
        "contract_id" uuid,
        "advance_percentage" numeric(5,2),
        "balance_paid_by" "loads"."load_postings_balance_paid_by_enum",
        "note" character varying(300),
        "message_text" text,
        "idempotency_key" character varying(100),
        "posted_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_load_postings_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "load_postings_tenant_id_idx" ON "loads"."load_postings" ("tenant_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "load_postings_tenant_customer_idx" ON "loads"."load_postings" ("tenant_id", "customer_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "load_postings_tenant_idempotency_unique" ON "loads"."load_postings" ("tenant_id", "idempotency_key") WHERE "idempotency_key" IS NOT NULL`,
    );

    // --- load_recipients ---
    await queryRunner.query(`
      CREATE TABLE "loads"."load_recipients" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "posting_id" uuid NOT NULL,
        "recipient_type" "loads"."load_recipients_recipient_type_enum" NOT NULL,
        "transporter_id" uuid,
        "message_status" "loads"."load_recipients_message_status_enum" NOT NULL DEFAULT 'pending',
        "sent_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_load_recipients_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_load_recipients_posting" FOREIGN KEY ("posting_id") REFERENCES "loads"."load_postings"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_load_recipients_transporter" FOREIGN KEY ("transporter_id") REFERENCES "masters"."transporters"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "load_recipients_tenant_posting_idx" ON "loads"."load_recipients" ("tenant_id", "posting_id")`,
    );

    // --- load_drafts ---
    await queryRunner.query(`
      CREATE TABLE "loads"."load_drafts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "payload" jsonb NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_load_drafts_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "load_drafts_tenant_user_idx" ON "loads"."load_drafts" ("tenant_id", "user_id")`,
    );

    // --- customer_contracts ---
    await queryRunner.query(`
      CREATE TABLE "loads"."customer_contracts" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "customer_id" uuid NOT NULL,
        "transporter_id" uuid NOT NULL,
        "contract_number" character varying(50) NOT NULL,
        "pickup_city" character varying(100) NOT NULL,
        "drop_city" character varying(100) NOT NULL,
        "rate" numeric(12,2) NOT NULL,
        "valid_from" date NOT NULL,
        "valid_to" date NOT NULL,
        "created_by" uuid,
        "deleted_at" TIMESTAMP WITH TIME ZONE,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_customer_contracts_id" PRIMARY KEY ("id"),
        CONSTRAINT "FK_customer_contracts_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"."customers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_customer_contracts_transporter" FOREIGN KEY ("transporter_id") REFERENCES "masters"."transporters"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "customer_contracts_tenant_customer_idx" ON "loads"."customer_contracts" ("tenant_id", "customer_id")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "customer_contracts_tenant_number_unique" ON "loads"."customer_contracts" ("tenant_id", "contract_number") WHERE "deleted_at" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "loads"."customer_contracts"`);
    await queryRunner.query(`DROP TABLE "loads"."load_drafts"`);
    await queryRunner.query(`DROP TABLE "loads"."load_recipients"`);
    await queryRunner.query(`DROP TABLE "loads"."load_postings"`);
    await queryRunner.query(`DROP TYPE "loads"."load_recipients_message_status_enum"`);
    await queryRunner.query(`DROP TYPE "loads"."load_recipients_recipient_type_enum"`);
    await queryRunner.query(`DROP TYPE "loads"."load_postings_balance_paid_by_enum"`);
    await queryRunner.query(`DROP TYPE "loads"."load_postings_price_basis_enum"`);
    await queryRunner.query(`DROP TYPE "loads"."load_postings_price_mode_enum"`);
    await queryRunner.query(`DROP TYPE "loads"."load_postings_mode_enum"`);

    await queryRunner.query(`DROP INDEX "customers"."customers_tenant_code_unique"`);
    await queryRunner.query(`DELETE FROM "loads"."code_sequences" WHERE "entity" = 'customer'`);
    await queryRunner.query(`ALTER TABLE "customers"."customers" DROP COLUMN "code"`);
    // Customers added by name alone have no mobile; restoring NOT NULL would fail on them, so the
    // placeholder keeps the column's old constraint without losing the rows.
    await queryRunner.query(
      `UPDATE "customers"."customers" SET "mobile" = 'UNKNOWN' WHERE "mobile" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "customers"."customers" ALTER COLUMN "mobile" SET NOT NULL`,
    );

    await queryRunner.query(`DROP INDEX "loads"."loads_tenant_posting_idx"`);
    await queryRunner.query(`ALTER TABLE "loads"."loads" DROP COLUMN "posting_id"`);
    // requisition_id stays nullable: loads without a requisition may exist by now, and 'indent'
    // stays on loads_source_type_enum — Postgres can't drop an enum value.
  }
}
