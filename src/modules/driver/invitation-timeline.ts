import type { DriverInvitationTimelineStep, InvitationTimelineInput } from './drivers.interface';

/**
 * The invitation drawer's single thread, sorted by time: every stored event (a Resend is its own
 * entry), `opened` at the first tap on the tracked app link after each send (later taps are left
 * out), `installed` at the driver's first app login — so it lands wherever that falls, even
 * before the first send — and, while the invite hasn't ended, one derived last step: `expired`
 * once it ran out (logged for good if it's later resent), otherwise `awaiting_response`.
 * Legacy `viewed` entries (an in-app notification opened) are dropped, and so are `whatsapp_read`
 * ones while read tracking is switched off (see DriverService.recordWhatsAppReports).
 */
export function buildInvitationTimeline(
  input: InvitationTimelineInput,
): DriverInvitationTimelineStep[] {
  // Whether the link was already opened since the latest send — one `opened` per send.
  let openedSinceSend = false;
  const timeline: DriverInvitationTimelineStep[] = input.events.flatMap(
    (event): DriverInvitationTimelineStep[] => {
      const at = new Date(event.at);
      switch (event.step) {
        case 'sent':
        case 'resent':
          openedSinceSend = false;
          return [
            {
              step: event.step,
              at,
              by: input.toActor(event.by),
              whatsapp: event.whatsapp !== false,
            },
          ];
        case 'link_opened':
          if (openedSinceSend) return [];
          openedSinceSend = true;
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
