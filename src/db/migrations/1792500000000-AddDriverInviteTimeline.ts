import { MigrationInterface, QueryRunner } from 'typeorm';

// Invitation drawer's permanent timeline. The send/view/channel columns only hold the latest send,
// so every event is now also appended to invite_timeline (see DriverInviteEvent). Existing invites
// are backfilled from what is known: the first send (taken from the first Resend's audit row when
// there was one), every Resend (DRIVER_INVITE_RESENT audit rows), the latest view, a failed push,
// and the driver's answer or the cancel. Anything a re-invite overwrote before this can't be
// recovered. Each send is then linked to the in-app invite notification it created (the first one
// for that invitation within two minutes of the send) so the drawer can show its read state.
// Events on the same timestamp keep their natural order (send → view → failed push → answer).
const ISO = (column: string) =>
  `to_char(${column} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export class AddDriverInviteTimeline1792500000000 implements MigrationInterface {
  name = 'AddDriverInviteTimeline1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" ADD "invite_timeline" jsonb NOT NULL DEFAULT '[]'::jsonb`,
    );
    await queryRunner.query(`
      WITH sent AS (
        SELECT * FROM "masters"."driver_tenant_relations" WHERE "invite_sent_at" IS NOT NULL
      ),
      resends AS (
        SELECT a."new_data"->>'invitationId' AS "relation_id", a."user_id",
               a."old_data"->>'inviteSentAt' AS "previous_sent_at",
               a."new_data"->>'inviteSentAt' AS "sent_at",
               row_number() OVER (PARTITION BY a."new_data"->>'invitationId' ORDER BY a."created_at") AS n
        FROM "audit"."audit_logs" a
        WHERE a."action" = 'DRIVER_INVITE_RESENT' AND a."new_data" ? 'invitationId'
      ),
      events AS (
        -- First send: before any Resend overwrote invite_sent_at/_by.
        SELECT r."id", 0 AS "rank", jsonb_build_object(
          'step', 'sent',
          'at', COALESCE(first."previous_sent_at", ${ISO('r."invite_sent_at"')}),
          'by', CASE WHEN first."relation_id" IS NULL THEN r."invite_sent_by"
                     WHEN r."initiated_by" = 'staff' THEN r."approved_by"
                     ELSE r."initiated_by_user_id" END
        ) AS e
        FROM sent r
        LEFT JOIN resends first ON first."relation_id" = r."id"::text AND first.n = 1
        UNION ALL
        SELECT r."id", 1, jsonb_build_object('step', 'resent', 'at', x."sent_at", 'by', x."user_id")
        FROM sent r JOIN resends x ON x."relation_id" = r."id"::text
        WHERE x."sent_at" IS NOT NULL
        UNION ALL
        SELECT "id", 2, jsonb_build_object('step', 'viewed', 'at', ${ISO('"invite_viewed_at"')},
                                           'device', "invite_viewed_device")
        FROM sent WHERE "invite_viewed_at" IS NOT NULL
        UNION ALL
        SELECT "id", 3, jsonb_build_object('step', 'delivery_failed',
                                           'at', ${ISO('"push_delivery_status_at"')}, 'channel', 'push')
        FROM sent WHERE "push_delivery_status" = 'failed' AND "push_delivery_status_at" IS NOT NULL
        UNION ALL
        SELECT "id", 4, jsonb_build_object('step', 'accepted',
                                           'at', ${ISO('COALESCE("driver_responded_at", "updated_at")')})
        FROM sent WHERE "status" = 'active'
        UNION ALL
        SELECT "id", 4, jsonb_build_object('step', 'declined', 'at', ${ISO('"driver_responded_at"')},
                                           'reason', "rejection_reason")
        FROM sent WHERE "status" = 'rejected' AND "driver_responded_at" IS NOT NULL
        UNION ALL
        SELECT "id", 4, jsonb_build_object('step', 'cancelled', 'at', ${ISO('"updated_at"')},
                                           'by', "updated_by")
        FROM sent WHERE "status" = 'cancelled'
      )
      UPDATE "masters"."driver_tenant_relations" r
      SET "invite_timeline" = t."timeline"
      FROM (
        SELECT "id", jsonb_agg(e ORDER BY (e->>'at')::timestamptz, "rank") AS "timeline"
        FROM events GROUP BY "id"
      ) t
      WHERE r."id" = t."id"
    `);
    // notifications.created_at is a plain timestamp written in the session time zone, so the
    // ::timestamptz cast reads it back the same way.
    await queryRunner.query(`
      UPDATE "masters"."driver_tenant_relations" r
      SET "invite_timeline" = linked."timeline"
      FROM (
        SELECT r2."id", jsonb_agg(
          CASE WHEN n."id" IS NULL THEN e.v
               ELSE e.v || jsonb_build_object('notificationId', n."id"::text) END
          ORDER BY e.ord
        ) AS "timeline"
        FROM "masters"."driver_tenant_relations" r2
        CROSS JOIN LATERAL jsonb_array_elements(r2."invite_timeline") WITH ORDINALITY e(v, ord)
        LEFT JOIN LATERAL (
          SELECT n."id" FROM "notifications"."notifications" n
          WHERE e.v->>'step' IN ('sent', 'resent')
            AND n."type" = 'driver.account.invited'
            AND n."recipient_user_id" = r2."driver_id"
            AND n."metadata"->>'invitationId' = r2."id"::text
            AND n."created_at"::timestamptz >= (e.v->>'at')::timestamptz
            AND n."created_at"::timestamptz < (e.v->>'at')::timestamptz + interval '2 minutes'
          ORDER BY n."created_at"
          LIMIT 1
        ) n ON true
        WHERE r2."invite_timeline" <> '[]'::jsonb
        GROUP BY r2."id"
      ) linked
      WHERE r."id" = linked."id"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "masters"."driver_tenant_relations" DROP COLUMN "invite_timeline"`,
    );
  }
}
