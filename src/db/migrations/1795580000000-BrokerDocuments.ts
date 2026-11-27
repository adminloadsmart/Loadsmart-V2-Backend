import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * The broker page's bank account and documents. The bank account stays on the broker's
 * ls_partners row (where payouts read it); this adds the account holder and bank name.
 * Documents are details only — type, number, dates — no file is uploaded.
 */
export class BrokerDocuments1795580000000 implements MigrationInterface {
  name = 'BrokerDocuments1795580000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_partners"
         ADD COLUMN IF NOT EXISTS "bank_account_name" varchar(150),
         ADD COLUMN IF NOT EXISTS "bank_name" varchar(100)`,
    );
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "loads"."broker_documents" (
         "id" uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
         "broker_id" uuid NOT NULL,
         "doc_type" varchar(40) NOT NULL,
         "doc_number" varchar(50),
         "issued_on" date,
         "expires_on" date,
         "note" varchar(500),
         "created_by" uuid,
         "updated_by" uuid,
         "created_at" timestamptz NOT NULL DEFAULT now(),
         "updated_at" timestamptz NOT NULL DEFAULT now(),
         CONSTRAINT "FK_broker_documents_broker" FOREIGN KEY ("broker_id")
           REFERENCES "loads"."brokers" ("id") ON DELETE CASCADE
       )`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "broker_documents_broker_idx"
         ON "loads"."broker_documents" ("broker_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "loads"."broker_documents"`);
    await queryRunner.query(
      `ALTER TABLE "loads"."ls_partners"
         DROP COLUMN IF EXISTS "bank_account_name",
         DROP COLUMN IF EXISTS "bank_name"`,
    );
  }
}
