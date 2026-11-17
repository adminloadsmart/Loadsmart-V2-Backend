import { MigrationInterface, QueryRunner } from 'typeorm';

const NEW_CHARGE_HEADS = [
  'loading_detention',
  'tarpaulin',
  'overloading',
  'parking',
  'godown',
  'unloading_detention',
  'other',
];

/**
 * Load module Phase 5 — own-transporter and indent money, and truck cancellation:
 * - Charges under the spec's heads, each with its proof.
 * - Payments with how they were made (mode, account), any proof (UTR, transaction ID, advice or
 *   screenshot — the UTR is no longer required on its own), the amount under each head and the
 *   deduction.
 * - The deduction taken for an issue on the POD.
 * - loads.load_cancellations: a truck cancelled between Truck assigned and Loaded.
 */
export class LoadTransporterMoneyAndTruckCancellation1794800000000 implements MigrationInterface {
  name = 'LoadTransporterMoneyAndTruckCancellation1794800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const head of NEW_CHARGE_HEADS) {
      await queryRunner.query(
        `ALTER TYPE "loads"."load_charges_charge_type_enum" ADD VALUE IF NOT EXISTS '${head}'`,
      );
    }
    for (const query of [
      `ALTER TYPE "storage"."files_purpose_enum" ADD VALUE IF NOT EXISTS 'loads/charge-proof'`,
      `ALTER TYPE "loads"."load_documents_doc_type_enum" ADD VALUE IF NOT EXISTS 'charge_proof'`,
      `ALTER TYPE "loads"."load_documents_doc_type_enum" ADD VALUE IF NOT EXISTS 'payment_proof'`,
      `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS 'CHARGE_ADDED'`,
      `ALTER TYPE "loads"."load_activities_action_enum" ADD VALUE IF NOT EXISTS 'TRUCK_CANCELLED'`,
    ]) {
      await queryRunner.query(query);
    }

    await queryRunner.query(`ALTER TABLE "loads"."load_charges" ADD "proof_file_key" text`);

    await queryRunner.query(
      `CREATE TYPE "loads"."load_payments_payment_mode_enum" AS ENUM('neft', 'rtgs', 'imps', 'upi', 'cheque', 'cash')`,
    );
    await queryRunner.query(`
      ALTER TABLE "loads"."load_payments"
        ALTER COLUMN "utr_reference" DROP NOT NULL,
        ADD "transaction_id" character varying(100),
        ADD COLUMN IF NOT EXISTS "proof_file_key" text,
        ADD "payment_mode" "loads"."load_payments_payment_mode_enum",
        ADD "account" character varying(100),
        ADD "heads" jsonb,
        ADD "deduction_amount" numeric(12,2)`);

    await queryRunner.query(
      `ALTER TABLE "loads"."loads" ADD "delivery_issue_deduction_amount" numeric(12,2)`,
    );

    await queryRunner.query(
      `CREATE TYPE "loads"."load_cancellations_next_step_enum" AS ENUM('new_truck', 'reopen')`,
    );
    await queryRunner.query(`
      CREATE TABLE "loads"."load_cancellations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "load_id" uuid NOT NULL,
        "reason_code" character varying(50) NOT NULL,
        "note" text,
        "next_step" "loads"."load_cancellations_next_step_enum" NOT NULL,
        "from_stage" character varying(32) NOT NULL,
        "transporter_id" uuid,
        "vehicle_number" character varying(20),
        "driver_name" character varying(150),
        "driver_mobile" character varying(20),
        "cancelled_by" uuid,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_load_cancellations" PRIMARY KEY ("id"),
        CONSTRAINT "FK_load_cancellations_load" FOREIGN KEY ("load_id")
          REFERENCES "loads"."loads"("id") ON DELETE RESTRICT
      )`);
    await queryRunner.query(
      `CREATE INDEX "load_cancellations_load_idx" ON "loads"."load_cancellations" ("load_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Enum values stay — PostgreSQL can't drop them, and code without them never writes them.
    await queryRunner.query(`DROP TABLE "loads"."load_cancellations"`);
    await queryRunner.query(`DROP TYPE "loads"."load_cancellations_next_step_enum"`);
    await queryRunner.query(
      `ALTER TABLE "loads"."loads" DROP COLUMN "delivery_issue_deduction_amount"`,
    );
    await queryRunner.query(`
      UPDATE "loads"."load_payments"
         SET "utr_reference" = COALESCE("utr_reference", "transaction_id", 'proof-file')
       WHERE "utr_reference" IS NULL`);
    await queryRunner.query(`
      ALTER TABLE "loads"."load_payments"
        DROP COLUMN "deduction_amount",
        DROP COLUMN "heads",
        DROP COLUMN "account",
        DROP COLUMN "payment_mode",
        DROP COLUMN "transaction_id",
        ALTER COLUMN "utr_reference" SET NOT NULL`);
    await queryRunner.query(`DROP TYPE "loads"."load_payments_payment_mode_enum"`);
    await queryRunner.query(`ALTER TABLE "loads"."load_charges" DROP COLUMN "proof_file_key"`);
  }
}
