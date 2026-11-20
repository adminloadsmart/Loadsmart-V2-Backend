import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A transporter who taps Negotiate (or Give rate) on WhatsApp is shown to the shipper as
 * "negotiating" on its load_recipients row, until its rate comes in.
 */
export class RecipientReplyNegotiating1795450000000 implements MigrationInterface {
  name = 'RecipientReplyNegotiating1795450000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "loads"."load_recipients_reply_status_enum" ADD VALUE IF NOT EXISTS 'negotiating'`,
    );
  }

  public async down(): Promise<void> {
    // Postgres can't drop an enum value; an unused one is harmless.
  }
}
