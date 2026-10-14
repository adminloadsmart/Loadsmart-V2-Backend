import { MigrationInterface, QueryRunner } from 'typeorm';

// Invitation detail drawer. Everything lives on driver_tenant_relations (latest send only — a
// Resend overwrites the send/view/channel columns); `status` keeps its existing values and still
// drives accepted/rejected/awaiting. Adds:
//   - invite_number: sequential "Req ID" (INV-00042), stable across Resends
//   - invite_sent_by: staff user behind the latest send ("Dispatched by …")
//   - invite_viewed_at/_device: driver opened the latest invite notification on their device
//   - sms/whatsapp/push_delivery_status(+_at): per-channel result of the latest send. SMS and
//     WhatsApp are recorded as `pending` without being sent until the notification branch lands.
export class AddDriverInviteTracking1790600000000 implements MigrationInterface {
  name = 'AddDriverInviteTracking1790600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE SEQUENCE "masters"."driver_invite_number_seq"`);
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ADD "invite_number" bigint`,
    );
    // Number existing rows oldest-first, then make the sequence the default for new rows.
    await queryRunner.query(`
      UPDATE "masters"."driver_tenant_relations" r
      SET "invite_number" = numbered.n
      FROM (
        SELECT "id", nextval('masters.driver_invite_number_seq') AS n
        FROM (SELECT "id" FROM "masters"."driver_tenant_relations" ORDER BY "created_at", "id") ordered
      ) numbered
      WHERE r."id" = numbered."id"
    `);
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ALTER COLUMN "invite_number" SET DEFAULT nextval('masters.driver_invite_number_seq')`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ALTER COLUMN "invite_number" SET NOT NULL`,
    );
    await queryRunner.query(
      `ALTER SEQUENCE "masters"."driver_invite_number_seq" OWNED BY "masters"."driver_tenant_relations"."invite_number"`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "driver_tenant_relations_invite_number_unique" ON "masters"."driver_tenant_relations" ("invite_number")`,
    );

    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ADD "invite_sent_by" uuid`,
    );
    await queryRunner.query(`
      UPDATE "masters"."driver_tenant_relations"
      SET "invite_sent_by" = CASE WHEN "initiated_by" = 'staff' THEN "approved_by"
                                  ELSE "initiated_by_user_id" END
      WHERE "invite_sent_at" IS NOT NULL
    `);

    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ADD "invite_viewed_at" TIMESTAMP WITH TIME ZONE`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ADD "invite_viewed_device" character varying(255)`,
    );

    await queryRunner.query(
      `CREATE TYPE "masters"."driver_tenant_relations_invite_delivery_status_enum" AS ENUM('pending', 'sent', 'delivered', 'read', 'failed')`,
    );
    for (const channel of ['sms', 'whatsapp', 'push']) {
      await queryRunner.query(
        `ALTER TABLE "masters"."driver_tenant_relations" ADD "${channel}_delivery_status" "masters"."driver_tenant_relations_invite_delivery_status_enum"`,
      );
      await queryRunner.query(
        `ALTER TABLE "masters"."driver_tenant_relations" ADD "${channel}_delivery_status_at" TIMESTAMP WITH TIME ZONE`,
      );
    }
    // No backfill for channel statuses — what was actually sent before this feature is unknown.
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const channel of ['push', 'whatsapp', 'sms']) {
      await queryRunner.query(
        `ALTER TABLE "masters"."driver_tenant_relations" DROP COLUMN "${channel}_delivery_status_at"`,
      );
      await queryRunner.query(
        `ALTER TABLE "masters"."driver_tenant_relations" DROP COLUMN "${channel}_delivery_status"`,
      );
    }
    await queryRunner.query(
      `DROP TYPE "masters"."driver_tenant_relations_invite_delivery_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" DROP COLUMN "invite_viewed_device"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" DROP COLUMN "invite_viewed_at"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" DROP COLUMN "invite_sent_by"`,
    );
    await queryRunner.query(`DROP INDEX "masters"."driver_tenant_relations_invite_number_unique"`);
    // Dropping the column drops the OWNED BY sequence with it.
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" DROP COLUMN "invite_number"`,
    );
  }
}
