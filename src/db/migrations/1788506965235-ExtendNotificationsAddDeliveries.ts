import { MigrationInterface, QueryRunner } from 'typeorm';

export class ExtendNotificationsAddDeliveries1788506965235 implements MigrationInterface {
  name = 'ExtendNotificationsAddDeliveries1788506965235';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Note: migration:generate also diffed an unrelated pre-existing constraint-name mismatch
    // on masters.product_sub_items (hand-named FK_product_sub_items_product in
    // 1786605000000-CreateProductsTables.ts vs. TypeORM's auto-generated hash name) — left
    // out here as out-of-scope drift, not something this migration should touch.
    await queryRunner.query(
      `CREATE TYPE "notifications"."notification_deliveries_channel_enum" AS ENUM('email', 'sms', 'push')`,
    );
    await queryRunner.query(
      `CREATE TYPE "notifications"."notification_deliveries_status_enum" AS ENUM('pending', 'sent', 'failed')`,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications"."notification_deliveries" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "notification_id" uuid NOT NULL, "channel" "notifications"."notification_deliveries_channel_enum" NOT NULL, "destination" character varying(512) NOT NULL, "status" "notifications"."notification_deliveries_status_enum" NOT NULL DEFAULT 'pending', "error" text, "attempts" integer NOT NULL DEFAULT '0', "sent_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_81daeff81f237bd384f7cfc4a4c" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "notification_deliveries_notification_channel_unique" ON "notifications"."notification_deliveries"  ("notification_id", "channel") `,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications"."notifications" ADD "recipient_user_id" uuid NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications"."notifications" ADD "type" character varying(100) NOT NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications"."notifications" ADD "title" character varying(255) NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "notifications"."notifications" ADD "body" text NOT NULL`);
    await queryRunner.query(
      `ALTER TABLE "notifications"."notifications" ADD "channels" jsonb NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "notifications"."notifications" ADD "metadata" jsonb`);
    await queryRunner.query(
      `CREATE TYPE "notifications"."notifications_status_enum" AS ENUM('pending', 'processing', 'sent', 'partially_failed', 'failed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications"."notifications" ADD "status" "notifications"."notifications_status_enum" NOT NULL DEFAULT 'pending'`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications"."notifications" ADD "read_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `CREATE INDEX "notifications_tenant_recipient_idx" ON "notifications"."notifications"  ("tenant_id", "recipient_user_id") `,
    );
    // Partial index backing the unread-count/list-filter query (GET /notifications?unreadOnly)
    // — not expressible via TypeORM's @Index decorator, added here by hand.
    await queryRunner.query(
      `CREATE INDEX "notifications_recipient_unread_idx" ON "notifications"."notifications" ("recipient_user_id") WHERE "read_at" IS NULL`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications"."notification_deliveries" ADD CONSTRAINT "FK_435486b970fffc3e33a7450ee97" FOREIGN KEY ("notification_id") REFERENCES "notifications"."notifications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications"."notification_deliveries" DROP CONSTRAINT "FK_435486b970fffc3e33a7450ee97"`,
    );
    await queryRunner.query(`DROP INDEX "notifications"."notifications_recipient_unread_idx"`);
    await queryRunner.query(`DROP INDEX "notifications"."notifications_tenant_recipient_idx"`);
    await queryRunner.query(`ALTER TABLE "notifications"."notifications" DROP COLUMN "read_at"`);
    await queryRunner.query(`ALTER TABLE "notifications"."notifications" DROP COLUMN "status"`);
    await queryRunner.query(`DROP TYPE "notifications"."notifications_status_enum"`);
    await queryRunner.query(`ALTER TABLE "notifications"."notifications" DROP COLUMN "metadata"`);
    await queryRunner.query(`ALTER TABLE "notifications"."notifications" DROP COLUMN "channels"`);
    await queryRunner.query(`ALTER TABLE "notifications"."notifications" DROP COLUMN "body"`);
    await queryRunner.query(`ALTER TABLE "notifications"."notifications" DROP COLUMN "title"`);
    await queryRunner.query(`ALTER TABLE "notifications"."notifications" DROP COLUMN "type"`);
    await queryRunner.query(
      `ALTER TABLE "notifications"."notifications" DROP COLUMN "recipient_user_id"`,
    );
    await queryRunner.query(
      `DROP INDEX "notifications"."notification_deliveries_notification_channel_unique"`,
    );
    await queryRunner.query(`DROP TABLE "notifications"."notification_deliveries"`);
    await queryRunner.query(`DROP TYPE "notifications"."notification_deliveries_status_enum"`);
    await queryRunner.query(`DROP TYPE "notifications"."notification_deliveries_channel_enum"`);
  }
}
