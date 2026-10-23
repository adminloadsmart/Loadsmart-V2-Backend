import type { DriverInvitationActor, DriverInvitationTimelineStep } from './drivers.interface';
import type { DriverInviteEvent } from './entities/driver-tenant-relation.entity';

/**
 * The invitation drawer's single thread, sorted by time: every stored event (a Resend is its own
 * entry), `installed` at the driver's first app login — so it lands wherever that falls, even
 * before the first send — and, while the invite hasn't ended, one derived last step: `expired`
 * once it ran out (logged for good if it's later resent), otherwise `awaiting_response`.
 * Legacy `viewed` entries (an in-app notification opened) are dropped.
 */
export function buildInvitationTimeline(input: {
  events: readonly DriverInviteEvent[];
  toActor: (userId: string | null) => DriverInvitationActor | null;
  firstAppLoginAt: Date | null;
  status: string;
  expiresAt: Date | null;
}): DriverInvitationTimelineStep[] {
  const timeline: DriverInvitationTimelineStep[] = input.events.flatMap(
    (event): DriverInvitationTimelineStep[] => {
      const at = new Date(event.at);
      switch (event.step) {
        case 'sent':
        case 'resent':
          return [{ step: event.step, at, by: input.toActor(event.by) }];
        case 'whatsapp_read':
          return [{ step: 'opened', at }];
        case 'cancelled':
          return [{ step: 'cancelled', at, by: input.toActor(event.by) }];
        case 'declined':
          return [{ step: 'declined', at, reason: event.reason }];
        case 'delivery_failed':
          return [{ step: 'delivery_failed', at, channel: event.channel }];
        case 'expired':
        case 'accepted':
          return [{ step: event.step, at }];
        // Legacy in-app views, and any step this build doesn't know, are left out rather than
        // sent as null.
        default:
          return [];
      }
    },
  );
  if (input.firstAppLoginAt) timeline.push({ step: 'installed', at: input.firstAppLoginAt });
  // Stable, so same-time events keep their logged order.
  timeline.sort((a, b) => a.at!.getTime() - b.at!.getTime());

  if (input.status === 'expired') {
    timeline.push({ step: 'expired', at: input.expiresAt });
  } else if (input.status === 'pending') {
    timeline.push({ step: 'awaiting_response', at: null });
  }
  return timeline;
}
