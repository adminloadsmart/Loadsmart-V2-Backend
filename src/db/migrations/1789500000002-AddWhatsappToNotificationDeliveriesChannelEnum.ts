import { MigrationInterface, QueryRunner } from 'typeorm';

// notifications.types.ts's NOTIFICATION_CHANNELS gained 'whatsapp' when WhatsappChannel was added
// (see channels/whatsapp.channel.ts), but this Postgres enum was never extended to match — a
// WhatsApp delivery row would fail to persist. ADD VALUE is transactional as of Postgres 12, and
// nothing in this same migration reads the new value, so it's safe inside migration:run's
// per-migration transaction.
export class AddWhatsappToNotificationDeliveriesChannelEnum1789500000002 implements MigrationInterface {
  name = 'AddWhatsappToNotificationDeliveriesChannelEnum1789500000002';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notifications"."notification_deliveries_channel_enum" ADD VALUE IF NOT EXISTS 'whatsapp'`,
    );
  }

  // Postgres has no ALTER TYPE ... DROP VALUE, so reverting means rebuilding the enum type from
  // scratch — this fails if any row already has channel = 'whatsapp' (the USING cast has nowhere
  // to map it), which is the expected/safe behavior for a down() run shortly after a bad deploy.
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "notifications"."notification_deliveries_channel_enum" RENAME TO "notification_deliveries_channel_enum_old"`,
    );
    await queryRunner.query(
      `CREATE TYPE "notifications"."notification_deliveries_channel_enum" AS ENUM('email', 'sms', 'push')`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications"."notification_deliveries" ALTER COLUMN "channel" TYPE "notifications"."notification_deliveries_channel_enum" USING "channel"::text::"notifications"."notification_deliveries_channel_enum"`,
    );
    await queryRunner.query(`DROP TYPE "notifications"."notification_deliveries_channel_enum_old"`);
  }
}
