import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Send requirement" sends the WhatsApp offer (LS_N_0105 / LS_N_0106) from the server to the
 * brokers Placement picked — one row per broker per load: sent, not on WhatsApp (Placement calls
 * them) or failed, and when it was delivered and read.
 */
export class RequirementRecipients1795470000000 implements MigrationInterface {
  name = 'RequirementRecipients1795470000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "loads"."ls_requirement_recipients_status_enum" AS ENUM('sent', 'not_on_whatsapp', 'failed')`,
    );
    await queryRunner.query(`
      CREATE TABLE "loads"."ls_requirement_recipients" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "sourcing_id" uuid NOT NULL,
        "partner_id" uuid NOT NULL,
        "status" "loads"."ls_requirement_recipients_status_enum" NOT NULL,
        "message_log_id" uuid,
        "fail_reason" character varying(300),
        "delivered_at" TIMESTAMP WITH TIME ZONE,
        "read_at" TIMESTAMP WITH TIME ZONE,
        "sent_by" uuid NOT NULL,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        CONSTRAINT "PK_ls_requirement_recipients" PRIMARY KEY ("id"),
        CONSTRAINT "ls_requirement_recipients_sourcing_partner_uq" UNIQUE ("sourcing_id", "partner_id"),
        CONSTRAINT "FK_ls_requirement_recipients_sourcing" FOREIGN KEY ("sourcing_id")
          REFERENCES "loads"."ls_sourcings"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_ls_requirement_recipients_partner" FOREIGN KEY ("partner_id")
          REFERENCES "loads"."ls_partners"("id") ON DELETE RESTRICT
      )`);
    await queryRunner.query(
      `CREATE INDEX "ls_requirement_recipients_message_log_idx" ON "loads"."ls_requirement_recipients" ("message_log_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "loads"."ls_requirement_recipients"`);
    await queryRunner.query(`DROP TYPE "loads"."ls_requirement_recipients_status_enum"`);
  }
}
