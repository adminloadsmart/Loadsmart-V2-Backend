import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 8 of the Load module rebuild — Loadsmart delivery and money.
 *
 * - CS claims: agent, assessment, agreed amount, who bears it (carrier, split, Loadsmart), the
 *   shipper's debit note, a step history; Loadsmart's credit notes (ls_credit_notes).
 * - Receivables: the invoice keeps its drafted lines, GST split (reverse charge, CGST + SGST or
 *   IGST), credit days, how it went and when the shipper received it (the due date waits for
 *   that), and its reconciliation; receipts (ls_receipts); unclaimed payments.
 * - Payables: the original POD tracker (ls_original_pods) with its late penalty.
 * - Shipper terms: credit days, POD type (image or original), billing instructions.
 * - The documents register keeps charge proofs and claim evidence as sets.
 *
 * Enum values are added outside the transaction (Postgres can't use a value added in the same
 * transaction), which is why this migration runs without one.
 */
export class LoadsmartDeliveryAndMoney1795000000000 implements MigrationInterface {
  name = 'LoadsmartDeliveryAndMoney1795000000000';
  transaction = false as const;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "storage"."files_purpose_enum" ADD VALUE IF NOT EXISTS 'loads/claim-evidence'`,
    );
    await queryRunner.query(
      `ALTER TYPE "loads"."load_documents_doc_type_enum" ADD VALUE IF NOT EXISTS 'claim_evidence'`,
    );

    await queryRunner.startTransaction();
    try {
      await this.upInTransaction(queryRunner);
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    }
  }

  private async upInTransaction(queryRunner: QueryRunner): Promise<void> {
    // --- Documents: charge proofs and claim evidence build up as sets ---
    await queryRunner.query(`DROP INDEX "loads"."load_documents_one_current_per_type"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "load_documents_one_current_per_type" ON "loads"."load_documents" ("load_id", "doc_type") WHERE "superseded_at" IS NULL AND "doc_type" NOT IN ('loading_photo', 'charge_proof', 'claim_evidence')`,
    );

    // --- Shipper terms ---
    await queryRunner.query(`ALTER TABLE "loads"."ls_commercial_terms" ADD "credit_days" integer`);
    await queryRunner.query(
      `CREATE TYPE "loads"."ls_commercial_terms_pod_type_enum" AS ENUM('image', 'original')`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_commercial_terms" ADD "pod_type" "loads"."ls_commercial_terms_pod_type_enum" NOT NULL DEFAULT 'image'`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_commercial_terms" ADD "billing_instructions" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."ls_commercial_terms" ADD "billing_note" text`);

    // --- Claims (C01) and credit notes ---
    await queryRunner.query(`ALTER TABLE "loads"."load_claims" ADD "assigned_to" uuid`);
    await queryRunner.query(
      `ALTER TABLE "loads"."load_claims" ADD "assigned_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."load_claims" ADD "cs_assessment" numeric(12,2)`);
    await queryRunner.query(`ALTER TABLE "loads"."load_claims" ADD "agreed_amount" numeric(12,2)`);
    await queryRunner.query(
      `CREATE TYPE "loads"."load_claims_recovery_mode_enum" AS ENUM('carrier', 'split', 'loadsmart')`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_claims" ADD "recovery_mode" "loads"."load_claims_recovery_mode_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_claims" ADD "loadsmart_share" numeric(12,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_claims" ADD "shipper_debit_note_ref" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."load_claims" ADD "history" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(
      `CREATE TABLE "loads"."ls_credit_notes" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "load_id" uuid NOT NULL, "claim_id" uuid, "credit_note_number" character varying(30) NOT NULL, "amount" numeric(14,2) NOT NULL, "reason" character varying(500) NOT NULL, "shipper_debit_note_ref" character varying(100), "issued_by" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_d6d199eeaff33b3d18e15011186" UNIQUE ("credit_note_number"), CONSTRAINT "PK_7f1f1e42b6643009eac50ca2a33" PRIMARY KEY ("id"), CONSTRAINT "FK_ls_credit_notes_load" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE RESTRICT)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ls_credit_notes_load_idx" ON "loads"."ls_credit_notes" ("load_id")`,
    );

    // --- Invoices (R02) ---
    await queryRunner.query(
      `CREATE TYPE "loads"."ls_invoices_status_enum" AS ENUM('issued', 'partly_paid', 'paid', 'short_paid', 'excess')`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_invoices" ADD "status" "loads"."ls_invoices_status_enum" NOT NULL DEFAULT 'issued'`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_invoices" ADD "lines" jsonb NOT NULL DEFAULT '[]'`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."ls_invoices" ADD "gst_split" jsonb`);
    await queryRunner.query(`ALTER TABLE "loads"."ls_invoices" ADD "credit_days" integer`);
    await queryRunner.query(
      `CREATE TYPE "loads"."ls_invoices_sent_via_enum" AS ENUM('app', 'email', 'whatsapp', 'courier')`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_invoices" ADD "sent_via" "loads"."ls_invoices_sent_via_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_invoices" ADD "sent_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."ls_invoices" ADD "received_on" date`);
    await queryRunner.query(`ALTER TABLE "loads"."ls_invoices" ADD "open_amount" numeric(14,2)`);
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_invoices" ADD "follow_up" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_invoices" ADD "settled_at" TIMESTAMP WITH TIME ZONE`,
    );
    // The due date is set once the shipper has received the invoice.
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_invoices" ALTER COLUMN "due_date" DROP NOT NULL`,
    );

    // --- Receipts (R03) and unclaimed payments ---
    await queryRunner.query(
      `CREATE TYPE "loads"."ls_receipts_paid_through_enum" AS ENUM('company_account', 'individual', 'pdc')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."ls_receipts_shortfall_reason_enum" AS ENUM('rounded_down', 'damage_or_shortage_deduction', 'late_delivery_penalty', 'tds_not_confirmed', 'other')`,
    );
    await queryRunner.query(
      `CREATE TABLE "loads"."ls_receipts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "load_id" uuid NOT NULL, "invoice_id" uuid NOT NULL, "amount" numeric(14,2) NOT NULL, "received_on" date NOT NULL, "paid_through" "loads"."ls_receipts_paid_through_enum" NOT NULL, "utr_reference" character varying(100), "tds_cut" numeric(14,2) NOT NULL DEFAULT '0', "shortfall_reason" "loads"."ls_receipts_shortfall_reason_enum", "shortfall_note" character varying(500), "load_payment_id" uuid, "unclaimed_payment_id" uuid, "recorded_by" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_7a6d528476fcdfde6cdd4bf2e42" PRIMARY KEY ("id"), CONSTRAINT "FK_ls_receipts_load" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE RESTRICT, CONSTRAINT "FK_ls_receipts_invoice" FOREIGN KEY ("invoice_id") REFERENCES "loads"."ls_invoices"("id") ON DELETE RESTRICT)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ls_receipts_invoice_idx" ON "loads"."ls_receipts" ("invoice_id")`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."ls_unclaimed_payments_mode_enum" AS ENUM('neft', 'rtgs', 'imps', 'upi', 'cheque', 'cash')`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."ls_unclaimed_payments_status_enum" AS ENUM('unclaimed', 'under_review', 'matched', 'refunded')`,
    );
    await queryRunner.query(
      `CREATE TABLE "loads"."ls_unclaimed_payments" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "amount" numeric(14,2) NOT NULL, "payer_name" character varying(150) NOT NULL, "mode" "loads"."ls_unclaimed_payments_mode_enum" NOT NULL, "utr_reference" character varying(100), "remitter_bank" character varying(150), "received_on" date NOT NULL, "status" "loads"."ls_unclaimed_payments_status_enum" NOT NULL DEFAULT 'unclaimed', "matched_invoice_id" uuid, "remarks" jsonb NOT NULL DEFAULT '[]', "created_by" uuid NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_8263410da541f5479cb2836d48b" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "ls_unclaimed_payments_status_idx" ON "loads"."ls_unclaimed_payments" ("status")`,
    );

    // --- Original POD tracker (Y03) ---
    await queryRunner.query(
      `CREATE TYPE "loads"."ls_original_pods_status_enum" AS ENUM('yet_to_dispatch', 'dispatched', 'received_filed', 'not_contactable', 'not_traceable')`,
    );
    await queryRunner.query(
      `CREATE TABLE "loads"."ls_original_pods" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "tenant_id" uuid NOT NULL, "load_id" uuid NOT NULL, "sourcing_id" uuid NOT NULL, "status" "loads"."ls_original_pods_status_enum" NOT NULL DEFAULT 'yet_to_dispatch', "delivered_on" date NOT NULL, "courier_name" character varying(100), "docket_number" character varying(100), "holder" character varying(150), "dispatched_at" TIMESTAMP WITH TIME ZONE, "received_at" TIMESTAMP WITH TIME ZONE, "filed_at" TIMESTAMP WITH TIME ZONE, "calls" jsonb NOT NULL DEFAULT '[]', "indemnity_bond_required" boolean NOT NULL DEFAULT false, "penalty_amount" numeric(12,2), "updated_by" uuid, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "UQ_d09c72ee5c0759265645711a29a" UNIQUE ("load_id"), CONSTRAINT "PK_f568b97b5335e12cb23cdbd9d0d" PRIMARY KEY ("id"), CONSTRAINT "FK_ls_original_pods_load" FOREIGN KEY ("load_id") REFERENCES "loads"."loads"("id") ON DELETE RESTRICT)`,
    );
    await queryRunner.query(
      `CREATE INDEX "ls_original_pods_status_idx" ON "loads"."ls_original_pods" ("status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.startTransaction();
    try {
      await queryRunner.query(`DROP TABLE "loads"."ls_original_pods"`);
      await queryRunner.query(`DROP TYPE "loads"."ls_original_pods_status_enum"`);
      await queryRunner.query(`DROP TABLE "loads"."ls_unclaimed_payments"`);
      await queryRunner.query(`DROP TYPE "loads"."ls_unclaimed_payments_status_enum"`);
      await queryRunner.query(`DROP TYPE "loads"."ls_unclaimed_payments_mode_enum"`);
      await queryRunner.query(`DROP TABLE "loads"."ls_receipts"`);
      await queryRunner.query(`DROP TYPE "loads"."ls_receipts_shortfall_reason_enum"`);
      await queryRunner.query(`DROP TYPE "loads"."ls_receipts_paid_through_enum"`);

      // Invoices not yet received get today as their due date in the old shape.
      await queryRunner.query(
        `UPDATE "loads"."ls_invoices" SET "due_date" = CURRENT_DATE WHERE "due_date" IS NULL`,
      );
      await queryRunner.query(
        `ALTER TABLE "loads"."ls_invoices" ALTER COLUMN "due_date" SET NOT NULL`,
      );
      for (const column of [
        'settled_at',
        'follow_up',
        'open_amount',
        'received_on',
        'sent_at',
        'sent_via',
        'credit_days',
        'gst_split',
        'lines',
        'status',
      ]) {
        await queryRunner.query(`ALTER TABLE "loads"."ls_invoices" DROP COLUMN "${column}"`);
      }
      await queryRunner.query(`DROP TYPE "loads"."ls_invoices_sent_via_enum"`);
      await queryRunner.query(`DROP TYPE "loads"."ls_invoices_status_enum"`);

      await queryRunner.query(`DROP TABLE "loads"."ls_credit_notes"`);
      for (const column of [
        'history',
        'shipper_debit_note_ref',
        'loadsmart_share',
        'recovery_mode',
        'agreed_amount',
        'cs_assessment',
        'assigned_at',
        'assigned_to',
      ]) {
        await queryRunner.query(`ALTER TABLE "loads"."load_claims" DROP COLUMN "${column}"`);
      }
      await queryRunner.query(`DROP TYPE "loads"."load_claims_recovery_mode_enum"`);

      for (const column of ['billing_note', 'billing_instructions', 'pod_type', 'credit_days']) {
        await queryRunner.query(
          `ALTER TABLE "loads"."ls_commercial_terms" DROP COLUMN "${column}"`,
        );
      }
      await queryRunner.query(`DROP TYPE "loads"."ls_commercial_terms_pod_type_enum"`);

      // Back to one current file per type: claim evidence goes, and only the latest charge proof
      // stays current. The enum values stay (Postgres can't drop them).
      await queryRunner.query(
        `DELETE FROM "loads"."load_documents" WHERE "doc_type" = 'claim_evidence'`,
      );
      await queryRunner.query(
        `UPDATE "loads"."load_documents" d SET "superseded_at" = now()
          WHERE d."doc_type" = 'charge_proof' AND d."superseded_at" IS NULL
            AND EXISTS (SELECT 1 FROM "loads"."load_documents" n
                         WHERE n."load_id" = d."load_id" AND n."doc_type" = 'charge_proof'
                           AND n."superseded_at" IS NULL AND n."version" > d."version")`,
      );
      await queryRunner.query(`DROP INDEX "loads"."load_documents_one_current_per_type"`);
      await queryRunner.query(
        `CREATE UNIQUE INDEX "load_documents_one_current_per_type" ON "loads"."load_documents" ("load_id", "doc_type") WHERE "superseded_at" IS NULL AND "doc_type" <> 'loading_photo'`,
      );
      await queryRunner.commitTransaction();
    } catch (error) {
      await queryRunner.rollbackTransaction();
      throw error;
    }
  }
}
