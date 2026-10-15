import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * WhatsApp Business consent for notifications (see user.entity.ts's whatsappOptIn and
 * notify-by-type.ts). Nullable with no default: NULL means consent was never captured, so existing
 * users get SMS only until they answer the opt-in prompt at their next login — consent is never
 * assumed.
 */
export class AddWhatsappOptInToUsers1789900000000 implements MigrationInterface {
  name = 'AddWhatsappOptInToUsers1789900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth"."users" ADD "whatsapp_opt_in" boolean`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth"."users" DROP COLUMN "whatsapp_opt_in"`);
  }
}
