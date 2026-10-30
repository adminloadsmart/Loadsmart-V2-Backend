import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * MSG91's request id for an invite's latest WhatsApp send — the MSG91 delivery-report webhook
 * carries it, which is how a "delivered"/"read" report finds its invite. Overwritten on every
 * Resend, so only the latest send's reports apply.
 */
export class DriverInviteWhatsappRequestId1793500000000 implements MigrationInterface {
  name = 'DriverInviteWhatsappRequestId1793500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ADD "whatsapp_request_id" character varying(100)`,
    );
    await queryRunner.query(
      `CREATE INDEX "driver_tenant_relations_whatsapp_request_id_idx" ON "masters"."driver_tenant_relations" ("whatsapp_request_id")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX "masters"."driver_tenant_relations_whatsapp_request_id_idx"`,
    );
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" DROP COLUMN "whatsapp_request_id"`,
    );
  }
}
