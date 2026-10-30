import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Sends that went out without the invite's WhatsApp message were logged without
 * `whatsapp: false`, so their history read "Invite Sent on WhatsApp". Such a send is the one row
 * state where WhatsApp's status is NULL while push's is set (DriverService.deliverInvite clears
 * it via clearWhatsAppSendStatus when WhatsApp was turned off, or — before WhatsApp that couldn't
 * go out was recorded as failed — when it wasn't configured), and it's always the latest send:
 * marks that send entry.
 */
export class BackfillDriverInviteSendWithoutWhatsapp1793800000000 implements MigrationInterface {
  name = 'BackfillDriverInviteSendWithoutWhatsapp1793800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "masters"."driver_tenant_relations" r
       SET "invite_timeline" =
         jsonb_set(r."invite_timeline", ARRAY[s.idx::text, 'whatsapp'], 'false'::jsonb)
       FROM (
         SELECT DISTINCT ON (t."id") t."id", e.ord - 1 AS idx
         FROM "masters"."driver_tenant_relations" t,
              jsonb_array_elements(t."invite_timeline") WITH ORDINALITY AS e(event, ord)
         WHERE t."whatsapp_delivery_status" IS NULL AND t."push_delivery_status" IS NOT NULL
           AND e.event->>'step' IN ('sent', 'resent')
         ORDER BY t."id", e.ord DESC
       ) s
       WHERE r."id" = s."id"`,
    );
  }

  public async down(): Promise<void> {
    // Harmless to keep: older code ignores the extra `whatsapp` key on a send entry.
  }
}
