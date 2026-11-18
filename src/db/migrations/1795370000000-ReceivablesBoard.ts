import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Receivables board: the shipper's advance % and balance payer in Loadsmart's terms, who the
 * invoice's balance is collected from and the original POD sent on to them, and the payment advice
 * on a receipt. The settings' default shipper advance lives in the settings JSON (defaults to 0).
 */
export class ReceivablesBoard1795370000000 implements MigrationInterface {
  name = 'ReceivablesBoard1795370000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "loads"."ls_balance_payer_enum" AS ENUM('shipper', 'consignee')`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_commercial_terms" ADD "shipper_advance_percent" numeric(5,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_commercial_terms" ADD "balance_payer" "loads"."ls_balance_payer_enum" NOT NULL DEFAULT 'shipper'`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_invoices" ADD "balance_payer" "loads"."ls_balance_payer_enum" NOT NULL DEFAULT 'shipper'`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_invoices" ADD "balance_payer_name" character varying(200)`,
    );
    await queryRunner.query(
      `CREATE TYPE "loads"."ls_invoices_payer_pod_status_enum" AS ENUM('not_sent', 'in_transit', 'received')`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_invoices" ADD "payer_pod_status" "loads"."ls_invoices_payer_pod_status_enum" NOT NULL DEFAULT 'not_sent'`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_invoices" ADD "payer_pod_courier" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_invoices" ADD "payer_pod_docket" character varying(100)`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_invoices" ADD "payer_pod_sent_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_invoices" ADD "payer_pod_received_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(`ALTER TABLE "loads"."ls_receipts" ADD "proof_file_key" text`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "loads"."ls_receipts" DROP COLUMN "proof_file_key"`);
    for (const column of [
      'payer_pod_received_at',
      'payer_pod_sent_at',
      'payer_pod_docket',
      'payer_pod_courier',
      'payer_pod_status',
      'balance_payer_name',
      'balance_payer',
    ]) {
      await queryRunner.query(`ALTER TABLE "loads"."ls_invoices" DROP COLUMN "${column}"`);
    }
    await queryRunner.query(`DROP TYPE "loads"."ls_invoices_payer_pod_status_enum"`);
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_commercial_terms" DROP COLUMN "balance_payer"`,
    );
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_commercial_terms" DROP COLUMN "shipper_advance_percent"`,
    );
    await queryRunner.query(`DROP TYPE "loads"."ls_balance_payer_enum"`);
  }
}
