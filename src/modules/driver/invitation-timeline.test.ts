import { describe, expect, it } from 'vitest';
import type { DriverInviteEvent } from './entities/driver-tenant-relation.entity';
import type { DriverInvitationStatus } from './drivers.types';
import { buildInvitationTimeline } from './invitation-timeline';

const build = (
  events: DriverInviteEvent[],
  firstAppLoginAt: Date | null,
  status: DriverInvitationStatus = 'pending',
) =>
  buildInvitationTimeline({
    events,
    toActor: (id) => (id ? { name: 'Admin', role: 'Org Admin' } : null),
    firstAppLoginAt,
    status,
    expiresAt: new Date('2026-10-30T10:00:00Z'),
  }).map((step) => step.step);

describe('buildInvitationTimeline', () => {
  it('puts an install from before the invite first', () => {
    expect(
      build(
        [{ step: 'sent', at: '2026-10-23T10:00:00Z', by: 'u1' }],
        new Date('2026-10-01T00:00:00Z'),
      ),
    ).toEqual(['installed', 'sent', 'awaiting_response']);
  });

  it('places the install by its time between other events', () => {
    expect(
      build(
        [
          { step: 'sent', at: '2026-10-23T10:00:00Z', by: 'u1' },
          { step: 'whatsapp_read', at: '2026-10-23T10:05:00Z' },
          { step: 'accepted', at: '2026-10-23T11:00:00Z' },
        ],
        new Date('2026-10-23T10:30:00Z'),
        'accepted',
      ),
    ).toEqual(['sent', 'opened', 'installed', 'accepted']);
  });

  it('keeps each Resend and its read as their own entries', () => {
    expect(
      build(
        [
          { step: 'sent', at: '2026-10-23T10:00:00Z', by: 'u1' },
          { step: 'whatsapp_read', at: '2026-10-23T10:05:00Z' },
          { step: 'resent', at: '2026-10-24T10:00:00Z', by: 'u1' },
          { step: 'whatsapp_read', at: '2026-10-24T10:02:00Z' },
        ],
        null,
      ),
    ).toEqual(['sent', 'opened', 'resent', 'opened', 'awaiting_response']);
  });

  it('drops legacy in-app notification views', () => {
    expect(
      build(
        [
          { step: 'sent', at: '2026-10-23T10:00:00Z', by: 'u1' },
          { step: 'viewed', at: '2026-10-23T10:05:00Z', device: null, notificationId: 'n1' },
        ],
        null,
        'expired',
      ),
    ).toEqual(['sent', 'expired']);
  });
});
