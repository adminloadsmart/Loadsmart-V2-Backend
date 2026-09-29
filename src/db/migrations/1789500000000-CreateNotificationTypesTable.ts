import { MigrationInterface, QueryRunner } from 'typeorm';

// App-wide catalog of notification types (no tenant_id — same "fixed, seeded catalog" shape as
// auth.roles), seeded from the in-code domain catalogs — see src/db/seed-notification-types.ts.
// `channels` is every channel a type could ever use (currently all four, for every type);
// `default_channels` is which of those are ON before an org_admin has ever saved a preference for
// it (matches the settings-screen mockup's shown toggle states).
export class CreateNotificationTypesTable1789500000000 implements MigrationInterface {
  name = 'CreateNotificationTypesTable1789500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "notifications"."notification_types" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "key" character varying NOT NULL, "label" character varying NOT NULL, "description" text, "channels" jsonb NOT NULL, "default_channels" jsonb NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_notification_types_key" UNIQUE ("key"), CONSTRAINT "PK_notification_types" PRIMARY KEY ("id"))`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "notifications"."notification_types"`);
  }
}
