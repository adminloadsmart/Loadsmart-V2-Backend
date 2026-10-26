import { MigrationInterface, QueryRunner } from 'typeorm';

// Phases 4–5: the Loadsmart route (source type, stages 11–13, its ops tables and the shipper's
// side of it), Loadsmart's bid on a load, and verified balance payments. (Live tracking was
// taken out of this migration; the class keeps its name since it has already run in places.)
// Enum values added here can't be removed by `down` — Postgres has no DROP VALUE.

const id = `"id" uuid NOT NULL DEFAULT uuid_generate_v4()`;
const createdAt = `"created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`;
const updatedAt = `"updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()`;

const ENUMS: [string, string[]][] = [
  ['ls_partners_partner_type_enum', ['fleet_owner', 'broker']],
  ['ls_partners_status_enum', ['active', 'inactive']],
  [
    'ls_sourcings_status_enum',
    ['pending_approval', 'posted', 'bid_sent', 'won', 'lost', 'cancelled'],
  ],
  ['ls_partner_bids_status_enum', ['received', 'sent', 'won', 'lost']],
  ['load_charges_charge_type_enum', ['loading', 'unloading', 'detention']],
  ['load_charges_status_enum', ['raised', 'approved', 'rejected']],
  ['load_charges_raised_by_party_enum', ['loadsmart', 'shipper']],
  ['ls_partner_payments_payment_type_enum', ['advance', 'balance']],
  ['load_claims_status_enum', ['open', 'settled']],
  ['load_ratings_subject_enum', ['shipper', 'partner']],
  ['load_bids_source_enum', ['transporter', 'loadsmart']],
  ['load_payments_verification_status_enum', ['pending', 'verified', 'rejected']],
];

const TABLES = [
  `CREATE TABLE "loads"."ls_partners" (${id},
    "name" character varying(150) NOT NULL,
    "phone" character varying(15) NOT NULL,
    "partner_type" "loads"."ls_partners_partner_type_enum" NOT NULL,
    "status" "loads"."ls_partners_status_enum" NOT NULL DEFAULT 'active',
    "tds_percent" numeric(5,2) NOT NULL DEFAULT 1,
    "bank_account_number" character varying(30),
    "bank_ifsc" character varying(11),
    "upi_id" character varying(100),
    "created_by" uuid, ${createdAt}, ${updatedAt},
    CONSTRAINT "PK_ls_partners_id" PRIMARY KEY ("id"))`,
  `CREATE TABLE "loads"."ls_commercial_terms" (
    "tenant_id" uuid NOT NULL,
    "margin_percent" numeric(5,2) NOT NULL,
    "trucker_advance_percent" numeric(5,2) NOT NULL,
    "updated_by" uuid, ${updatedAt},
    CONSTRAINT "PK_ls_commercial_terms_tenant" PRIMARY KEY ("tenant_id"))`,
  `CREATE TABLE "loads"."ls_sourcings" (${id},
    "tenant_id" uuid NOT NULL,
    "load_id" uuid NOT NULL,
    "status" "loads"."ls_sourcings_status_enum" NOT NULL DEFAULT 'pending_approval',
    "margin_percent" numeric(5,2) NOT NULL,
    "trucker_advance_percent" numeric(5,2) NOT NULL,
    "missing_fields" jsonb NOT NULL DEFAULT '[]',
    "approved_by" uuid,
    "posted_at" TIMESTAMP WITH TIME ZONE,
    "rejection_reason" character varying(500),
    "partner_target_rate" numeric(12,2),
    "shipper_price" numeric(12,2),
    "effective_margin_percent" numeric(5,2),
    "negotiation_note" character varying(500),
    "bid_sent_by" uuid,
    "bid_sent_at" TIMESTAMP WITH TIME ZONE,
    "partner_id" uuid,
    "partner_bid_id" uuid,
    "partner_rate" numeric(12,2),
    "licence_front_file_key" text,
    "licence_back_file_key" text,
    "rc_copy_file_key" text,
    "driver_named_at" TIMESTAMP WITH TIME ZONE,
    "verification_approved_by" uuid,
    "papers_approved_by" uuid,
    "original_pod_courier" character varying(150),
    "original_pod_tracking_number" character varying(100),
    ${createdAt}, ${updatedAt},
    CONSTRAINT "PK_ls_sourcings_id" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_ls_sourcings_load" UNIQUE ("load_id"),
    CONSTRAINT "FK_ls_sourcings_load" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE CASCADE,
    CONSTRAINT "FK_ls_sourcings_partner" FOREIGN KEY ("partner_id") REFERENCES "loads"."ls_partners"("id") ON DELETE RESTRICT)`,
  `CREATE INDEX "ls_sourcings_status_idx" ON "loads"."ls_sourcings" ("status")`,
  `CREATE TABLE "loads"."ls_partner_bids" (${id},
    "sourcing_id" uuid NOT NULL,
    "partner_id" uuid NOT NULL,
    "rate" numeric(12,2) NOT NULL,
    "vehicle_number" character varying(20),
    "truck_verified" boolean,
    "status" "loads"."ls_partner_bids_status_enum" NOT NULL DEFAULT 'received',
    "entered_by" uuid, ${createdAt}, ${updatedAt},
    CONSTRAINT "PK_ls_partner_bids_id" PRIMARY KEY ("id"),
    CONSTRAINT "FK_ls_partner_bids_sourcing" FOREIGN KEY ("sourcing_id") REFERENCES "loads"."ls_sourcings"("id") ON DELETE CASCADE,
    CONSTRAINT "FK_ls_partner_bids_partner" FOREIGN KEY ("partner_id") REFERENCES "loads"."ls_partners"("id") ON DELETE RESTRICT)`,
  `CREATE INDEX "ls_partner_bids_sourcing_idx" ON "loads"."ls_partner_bids" ("sourcing_id")`,
  `CREATE TABLE "loads"."load_charges" (${id},
    "tenant_id" uuid NOT NULL,
    "load_id" uuid NOT NULL,
    "charge_type" "loads"."load_charges_charge_type_enum" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "note" character varying(500),
    "status" "loads"."load_charges_status_enum" NOT NULL DEFAULT 'raised',
    "raised_by_party" "loads"."load_charges_raised_by_party_enum" NOT NULL,
    "raised_by" uuid,
    "decided_by" uuid,
    "decided_at" TIMESTAMP WITH TIME ZONE,
    "rejection_reason" character varying(500),
    ${createdAt},
    CONSTRAINT "PK_load_charges_id" PRIMARY KEY ("id"),
    CONSTRAINT "FK_load_charges_load" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE CASCADE)`,
  `CREATE INDEX "load_charges_tenant_load_idx" ON "loads"."load_charges" ("tenant_id", "load_id")`,
  `CREATE TABLE "loads"."ls_partner_payments" (${id},
    "sourcing_id" uuid NOT NULL,
    "load_id" uuid NOT NULL,
    "partner_id" uuid NOT NULL,
    "payment_type" "loads"."ls_partner_payments_payment_type_enum" NOT NULL,
    "gross_amount" numeric(12,2) NOT NULL,
    "tds_amount" numeric(12,2) NOT NULL,
    "deduction_amount" numeric(12,2) NOT NULL DEFAULT 0,
    "net_amount" numeric(12,2) NOT NULL,
    "utr_reference" character varying(100) NOT NULL,
    "paid_by" uuid,
    "paid_at" TIMESTAMP WITH TIME ZONE NOT NULL,
    ${createdAt},
    CONSTRAINT "PK_ls_partner_payments_id" PRIMARY KEY ("id"),
    CONSTRAINT "FK_ls_partner_payments_sourcing" FOREIGN KEY ("sourcing_id") REFERENCES "loads"."ls_sourcings"("id") ON DELETE CASCADE)`,
  `CREATE UNIQUE INDEX "ls_partner_payments_sourcing_type_idx" ON "loads"."ls_partner_payments" ("sourcing_id", "payment_type")`,
  `CREATE TABLE "loads"."load_claims" (${id},
    "tenant_id" uuid NOT NULL,
    "load_id" uuid NOT NULL,
    "status" "loads"."load_claims_status_enum" NOT NULL DEFAULT 'open',
    "issue" character varying(20),
    "claim_value" numeric(12,2),
    "shipper_note" character varying(500),
    "partner_recovery" numeric(12,2),
    "resolution_note" character varying(1000),
    "settled_by" uuid,
    "settled_at" TIMESTAMP WITH TIME ZONE,
    ${createdAt},
    CONSTRAINT "PK_load_claims_id" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_load_claims_load" UNIQUE ("load_id"),
    CONSTRAINT "FK_load_claims_load" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE CASCADE)`,
  `CREATE TABLE "loads"."load_ratings" (${id},
    "tenant_id" uuid NOT NULL,
    "load_id" uuid NOT NULL,
    "subject" "loads"."load_ratings_subject_enum" NOT NULL,
    "partner_id" uuid,
    "score" smallint NOT NULL,
    "note" character varying(500),
    "rated_by" uuid,
    ${createdAt},
    CONSTRAINT "PK_load_ratings_id" PRIMARY KEY ("id"),
    CONSTRAINT "FK_load_ratings_load" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE CASCADE)`,
  `CREATE UNIQUE INDEX "load_ratings_load_subject_idx" ON "loads"."load_ratings" ("load_id", "subject")`,
  `CREATE TABLE "loads"."ls_invoices" (${id},
    "tenant_id" uuid NOT NULL,
    "load_id" uuid NOT NULL,
    "invoice_number" character varying(30) NOT NULL,
    "freight_amount" numeric(14,2) NOT NULL,
    "charges_amount" numeric(14,2) NOT NULL,
    "claim_credit" numeric(14,2) NOT NULL,
    "taxable_amount" numeric(14,2) NOT NULL,
    "gst_percent" numeric(5,2) NOT NULL,
    "gst_amount" numeric(14,2) NOT NULL,
    "total_amount" numeric(14,2) NOT NULL,
    "advance_received" numeric(14,2) NOT NULL,
    "balance_due" numeric(14,2) NOT NULL,
    "due_date" date NOT NULL,
    "file_key" text,
    "issued_by" uuid,
    ${createdAt},
    CONSTRAINT "PK_ls_invoices_id" PRIMARY KEY ("id"),
    CONSTRAINT "UQ_ls_invoices_load" UNIQUE ("load_id"),
    CONSTRAINT "UQ_ls_invoices_number" UNIQUE ("invoice_number"),
    CONSTRAINT "FK_ls_invoices_load" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE CASCADE)`,
];

const DROP_TABLES = [
  'ls_invoices',
  'load_ratings',
  'load_claims',
  'ls_partner_payments',
  'load_charges',
  'ls_partner_bids',
  'ls_sourcings',
  'ls_commercial_terms',
  'ls_partners',
];

export class LoadsmartLoadsAndTracking1793100000000 implements MigrationInterface {
  name = 'LoadsmartLoadsAndTracking1793100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "loads"."loads_source_type_enum" ADD VALUE IF NOT EXISTS 'loadsmart'`,
    );
    for (const stage of ['original_pod_received', 'invoice_generated', 'payment']) {
      await queryRunner.query(
        `ALTER TYPE "loads"."loads_status_enum" ADD VALUE IF NOT EXISTS '${stage}' BEFORE 'closed'`,
      );
    }
    for (const action of ['LOADSMART_STEP']) {
      await queryRunner.query(
        `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS '${action}'`,
      );
    }
    for (const [name, values] of ENUMS) {
      await queryRunner.query(
        `CREATE TYPE "loads"."${name}" AS ENUM(${values.map((v) => `'${v}'`).join(', ')})`,
      );
    }
    for (const statement of TABLES) await queryRunner.query(statement);

    await queryRunner.query(
      `ALTER TABLE "loads"."loads"
        ADD "original_pod_received_at" TIMESTAMP WITH TIME ZONE,
        ADD "invoice_generated_at" TIMESTAMP WITH TIME ZONE,
        ADD "payment_submitted_at" TIMESTAMP WITH TIME ZONE,
        ADD "ls_verification_approved_at" TIMESTAMP WITH TIME ZONE,
        ADD "ls_papers_approved_at" TIMESTAMP WITH TIME ZONE,
        ADD "partner_balance_paid_at" TIMESTAMP WITH TIME ZONE,
        ADD "unloading_contact_name" character varying(150),
        ADD "unloading_contact_phone" character varying(20)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_bids"
        ADD "source" "loads"."load_bids_source_enum" NOT NULL DEFAULT 'transporter',
        ADD "ls_partner_bid_id" uuid,
        ALTER COLUMN "transporter_id" DROP NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_payments"
        ADD "verification_status" "loads"."load_payments_verification_status_enum",
        ADD "verified_by" uuid,
        ADD "verified_at" TIMESTAMP WITH TIME ZONE,
        ADD "rejection_reason" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."load_payments"
        DROP COLUMN "rejection_reason",
        DROP COLUMN "verified_at",
        DROP COLUMN "verified_by",
        DROP COLUMN "verification_status"`,
    );
    await queryRunner.query(`DELETE FROM "loads"."load_bids" WHERE "transporter_id" IS NULL`);
    await queryRunner.query(
      `ALTER TABLE "loads"."load_bids"
        ALTER COLUMN "transporter_id" SET NOT NULL,
        DROP COLUMN "ls_partner_bid_id",
        DROP COLUMN "source"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."loads"
        DROP COLUMN "unloading_contact_phone",
        DROP COLUMN "unloading_contact_name",
        DROP COLUMN "partner_balance_paid_at",
        DROP COLUMN "ls_papers_approved_at",
        DROP COLUMN "ls_verification_approved_at",
        DROP COLUMN "payment_submitted_at",
        DROP COLUMN "invoice_generated_at",
        DROP COLUMN "original_pod_received_at"`,
    );
    for (const table of DROP_TABLES) await queryRunner.query(`DROP TABLE "loads"."${table}"`);
    for (const [name] of [...ENUMS].reverse()) {
      await queryRunner.query(`DROP TYPE "loads"."${name}"`);
    }
  }
}
