import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * WhatsApp notifications are on by default (product decision, 2026-10-27): new users start with
 * whatsapp_opt_in = true, and users whose consent was never captured (NULL) are switched on too.
 * An explicit opt-out (false, via PATCH /auth/me/whatsapp-opt-in) is left untouched.
 */
export class DefaultWhatsappOptInTrue1793400000000 implements MigrationInterface {
  name = 'DefaultWhatsappOptInTrue1793400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "auth"."users" ALTER COLUMN "whatsapp_opt_in" SET DEFAULT true`,
    );
    await queryRunner.query(
      `UPDATE "auth"."users" SET "whatsapp_opt_in" = true WHERE "whatsapp_opt_in" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // The backfilled NULLs can't be told apart from real opt-ins, so only the default is reverted.
    await queryRunner.query(
      `ALTER TABLE "auth"."users" ALTER COLUMN "whatsapp_opt_in" DROP DEFAULT`,
    );
  }
}
