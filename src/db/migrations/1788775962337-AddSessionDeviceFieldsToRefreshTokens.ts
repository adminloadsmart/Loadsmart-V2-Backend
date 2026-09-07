import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddSessionDeviceFieldsToRefreshTokens1788775962337 implements MigrationInterface {
  name = 'AddSessionDeviceFieldsToRefreshTokens1788775962337';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Note: migration:generate also diffed two unrelated pre-existing items — a
    // constraint-name mismatch on masters.product_sub_items (see
    // 1786605000000-CreateProductsTables.ts) and TypeORM's lack of awareness of the
    // hand-added partial index in notifications.notifications (see
    // 1788506965235-ExtendNotificationsAddDeliveries.ts, @Index can't express WHERE clauses)
    // — left out here as out-of-scope drift, not something this migration should touch.
    await queryRunner.query(
      `ALTER TABLE "auth"."refresh_tokens" ADD "fcm_token" character varying(512)`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."refresh_tokens" ADD "device_type" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."refresh_tokens" ADD "device_info" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."refresh_tokens" ADD "ip_address" character varying`,
    );
    await queryRunner.query(
      `ALTER TABLE "auth"."refresh_tokens" ADD "last_seen" TIMESTAMP WITH TIME ZONE`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "auth"."refresh_tokens" DROP COLUMN "last_seen"`);
    await queryRunner.query(`ALTER TABLE "auth"."refresh_tokens" DROP COLUMN "ip_address"`);
    await queryRunner.query(`ALTER TABLE "auth"."refresh_tokens" DROP COLUMN "device_info"`);
    await queryRunner.query(`ALTER TABLE "auth"."refresh_tokens" DROP COLUMN "device_type"`);
    await queryRunner.query(`ALTER TABLE "auth"."refresh_tokens" DROP COLUMN "fcm_token"`);
  }
}
