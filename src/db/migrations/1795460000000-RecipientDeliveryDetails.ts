import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * What the shipper sees for each transporter an offer went to ("Who is quoting"): when WhatsApp
 * delivered it, when it was read, and why it failed — kept on load_recipients by the messaging
 * status listener (message_status alone folds delivered and read into `sent`).
 */
export class RecipientDeliveryDetails1795460000000 implements MigrationInterface {
  name = 'RecipientDeliveryDetails1795460000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "loads"."load_recipients"
        ADD COLUMN "delivered_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "read_at" TIMESTAMP WITH TIME ZONE,
        ADD COLUMN "fail_reason" character varying(300)`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "loads"."load_recipients"
        DROP COLUMN "fail_reason",
        DROP COLUMN "read_at",
        DROP COLUMN "delivered_at"`);
  }
}
