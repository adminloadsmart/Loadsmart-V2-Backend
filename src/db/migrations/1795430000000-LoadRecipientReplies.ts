import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A transporter's Accept / Reject on WhatsApp is kept on its load_recipients row, so the shipper
 * sees the answer on the load. An indent's Accept wrote nothing the shipper could see until the
 * truck number came in.
 */
export class LoadRecipientReplies1795430000000 implements MigrationInterface {
  name = 'LoadRecipientReplies1795430000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TYPE "loads"."load_recipients_reply_status_enum" AS ENUM('accepted', 'rejected')`,
    );
    await queryRunner.query(`
      ALTER TABLE "loads"."load_recipients"
        ADD COLUMN "reply_status" "loads"."load_recipients_reply_status_enum",
        ADD COLUMN "replied_at" TIMESTAMP WITH TIME ZONE`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "loads"."load_recipients"
        DROP COLUMN "replied_at",
        DROP COLUMN "reply_status"`);
    await queryRunner.query(`DROP TYPE "loads"."load_recipients_reply_status_enum"`);
  }
}
