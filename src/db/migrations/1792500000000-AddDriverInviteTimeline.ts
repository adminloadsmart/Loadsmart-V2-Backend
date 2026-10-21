import { MigrationInterface, QueryRunner, TableColumn } from 'typeorm';

// Invitation drawer's permanent timeline. The send/view/channel columns only hold the latest send,
// so every event is now also appended to invite_timeline (see DriverInviteEvent). Existing invites
// are backfilled from what is known: the first send (taken from the first Resend's audit row when
// there was one), every Resend (DRIVER_INVITE_RESENT audit rows), the latest view, a failed push,
// and the driver's answer or the cancel. Anything a re-invite overwrote before this can't be
// recovered. Each send is then linked to the in-app invite notification it created (the first one
// for that invitation within NOTIFICATION_MATCH_WINDOW_MS of the send) so the drawer can show its
// read state.
//
// Reads by table and column name. The write goes through the entity's `inviteTimeline` property:
// TypeORM resolves any registered table path to its entity, so an update can't bypass it — renaming
// that property later means updating this migration too.

const RELATIONS_TABLE = 'masters.driver_tenant_relations';
const TIMELINE_COLUMN = 'invite_timeline';
const TIMELINE_PROPERTY = 'inviteTimeline';
const NOTIFICATION_MATCH_WINDOW_MS = 2 * 60 * 1000;

interface InviteRow {
  id: string;
  driverId: string;
  status: string;
  initiatedBy: string;
  initiatedByUserId: string | null;
  approvedBy: string | null;
  inviteSentAt: Date;
  inviteSentBy: string | null;
  inviteViewedAt: Date | null;
  inviteViewedDevice: string | null;
  pushDeliveryStatus: string | null;
  pushDeliveryStatusAt: Date | null;
  driverRespondedAt: Date | null;
  rejectionReason: string | null;
  updatedAt: Date;
  updatedBy: string | null;
}

interface ResendAuditRow {
  userId: string | null;
  oldData: { invitationId?: string; inviteSentAt?: string } | null;
  newData: { invitationId?: string; inviteSentAt?: string } | null;
}

interface InviteNotificationRow {
  id: string;
  recipientUserId: string;
  metadata: { invitationId?: string } | null;
  createdAt: Date;
}

type TimelineEvent = { step: string; at: string } & Record<string, unknown>;

const isSend = (event: TimelineEvent) => event.step === 'sent' || event.step === 'resent';

function buildTimeline(invite: InviteRow, resends: ResendAuditRow[]): TimelineEvent[] {
  const events: TimelineEvent[] = [
    {
      step: 'sent',
      at: resends[0]?.oldData?.inviteSentAt ?? invite.inviteSentAt.toISOString(),
      // invite_sent_by was overwritten by the first Resend — fall back to who started the invite.
      by: resends.length
        ? invite.initiatedBy === 'staff'
          ? invite.approvedBy
          : invite.initiatedByUserId
        : invite.inviteSentBy,
    },
  ];
  for (const resend of resends) {
    if (resend.newData?.inviteSentAt) {
      events.push({ step: 'resent', at: resend.newData.inviteSentAt, by: resend.userId });
    }
  }
  if (invite.inviteViewedAt) {
    events.push({
      step: 'viewed',
      at: invite.inviteViewedAt.toISOString(),
      device: invite.inviteViewedDevice,
    });
  }
  if (invite.pushDeliveryStatus === 'failed' && invite.pushDeliveryStatusAt) {
    events.push({
      step: 'delivery_failed',
      at: invite.pushDeliveryStatusAt.toISOString(),
      channel: 'push',
    });
  }
  if (invite.status === 'active') {
    events.push({
      step: 'accepted',
      at: (invite.driverRespondedAt ?? invite.updatedAt).toISOString(),
    });
  } else if (invite.status === 'rejected' && invite.driverRespondedAt) {
    events.push({
      step: 'declined',
      at: invite.driverRespondedAt.toISOString(),
      reason: invite.rejectionReason,
    });
  } else if (invite.status === 'cancelled') {
    events.push({ step: 'cancelled', at: invite.updatedAt.toISOString(), by: invite.updatedBy });
  }
  return events.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
}

/** Adds `notificationId` to each send that has a matching invite notification. */
function linkNotifications(
  timeline: TimelineEvent[],
  notifications: InviteNotificationRow[],
): TimelineEvent[] {
  const unused = [...notifications];
  return timeline.map((event) => {
    if (!isSend(event)) return event;
    const sentAt = new Date(event.at).getTime();
    const index = unused.findIndex((notification) => {
      const createdAt = notification.createdAt.getTime();
      return createdAt >= sentAt && createdAt < sentAt + NOTIFICATION_MATCH_WINDOW_MS;
    });
    if (index === -1) return event;
    const [notification] = unused.splice(index, 1);
    return { ...event, notificationId: notification.id };
  });
}

export class AddDriverInviteTimeline1792500000000 implements MigrationInterface {
  name = 'AddDriverInviteTimeline1792500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      RELATIONS_TABLE,
      new TableColumn({
        name: TIMELINE_COLUMN,
        type: 'jsonb',
        isNullable: false,
        default: "'[]'::jsonb",
      }),
    );

    const manager = queryRunner.manager;
    const invites: InviteRow[] = await manager
      .createQueryBuilder()
      .select('relation.id', 'id')
      .addSelect('relation.driver_id', 'driverId')
      .addSelect('relation.status', 'status')
      .addSelect('relation.initiated_by', 'initiatedBy')
      .addSelect('relation.initiated_by_user_id', 'initiatedByUserId')
      .addSelect('relation.approved_by', 'approvedBy')
      .addSelect('relation.invite_sent_at', 'inviteSentAt')
      .addSelect('relation.invite_sent_by', 'inviteSentBy')
      .addSelect('relation.invite_viewed_at', 'inviteViewedAt')
      .addSelect('relation.invite_viewed_device', 'inviteViewedDevice')
      .addSelect('relation.push_delivery_status', 'pushDeliveryStatus')
      .addSelect('relation.push_delivery_status_at', 'pushDeliveryStatusAt')
      .addSelect('relation.driver_responded_at', 'driverRespondedAt')
      .addSelect('relation.rejection_reason', 'rejectionReason')
      .addSelect('relation.updated_at', 'updatedAt')
      .addSelect('relation.updated_by', 'updatedBy')
      .from(RELATIONS_TABLE, 'relation')
      .where('relation.invite_sent_at IS NOT NULL')
      .getRawMany();
    if (!invites.length) return;

    const resendAudits: ResendAuditRow[] = await manager
      .createQueryBuilder()
      .select('audit.user_id', 'userId')
      .addSelect('audit.old_data', 'oldData')
      .addSelect('audit.new_data', 'newData')
      .from('audit.audit_logs', 'audit')
      .where('audit.action = :action', { action: 'DRIVER_INVITE_RESENT' })
      .orderBy('audit.created_at', 'ASC')
      .getRawMany();
    const resendsByInvite = new Map<string, ResendAuditRow[]>();
    for (const audit of resendAudits) {
      const invitationId = audit.newData?.invitationId;
      if (!invitationId) continue;
      resendsByInvite.set(invitationId, [...(resendsByInvite.get(invitationId) ?? []), audit]);
    }

    const inviteNotifications: InviteNotificationRow[] = await manager
      .createQueryBuilder()
      .select('notification.id', 'id')
      .addSelect('notification.recipient_user_id', 'recipientUserId')
      .addSelect('notification.metadata', 'metadata')
      .addSelect('notification.created_at', 'createdAt')
      .from('notifications.notifications', 'notification')
      .where('notification.type = :type', { type: 'driver.account.invited' })
      .orderBy('notification.created_at', 'ASC')
      .getRawMany();
    const notificationsByInvite = new Map<string, InviteNotificationRow[]>();
    for (const notification of inviteNotifications) {
      const invitationId = notification.metadata?.invitationId;
      if (!invitationId) continue;
      notificationsByInvite.set(invitationId, [
        ...(notificationsByInvite.get(invitationId) ?? []),
        notification,
      ]);
    }

    for (const invite of invites) {
      const ownNotifications = (notificationsByInvite.get(invite.id) ?? []).filter(
        (notification) => notification.recipientUserId === invite.driverId,
      );
      const timeline = linkNotifications(
        buildTimeline(invite, resendsByInvite.get(invite.id) ?? []),
        ownNotifications,
      );
      await manager
        .createQueryBuilder()
        .update(RELATIONS_TABLE)
        .set({ [TIMELINE_PROPERTY]: timeline })
        .where('id = :id', { id: invite.id })
        .execute();
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn(RELATIONS_TABLE, TIMELINE_COLUMN);
  }
}
