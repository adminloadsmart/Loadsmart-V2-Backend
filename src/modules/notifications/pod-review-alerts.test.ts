import { describe, expect, it, vi } from 'vitest';
import type { TrackingClient } from '../../adapters/tracking.client';
import { NOTIFICATION_CATALOG } from './catalog/notification-catalog';
import type { LoadAlertRepository } from './load-alert.repository';
import { createLoadAlertResolvers, createLoadEventNotifier } from './load-alerts';
import type { NotificationTriggers } from './notification-triggers';
import type { LoadAlertSnapshot } from './notifications.interface';
import { createTripTimingChecks } from './trip-timing';

const HOUR = 60 * 60 * 1000;
const recipient = { userId: 'user-1', fullName: 'Asha Verma' };
const arrivedAt = new Date(Date.now() - 24 * HOUR - 2 * 60 * 1000);
const reviewedAt = new Date('2026-10-21T08:50:00.000Z');

const snapshot = {
  code: 'LD-1001',
  status: 'reached_delivery_point',
  sourceType: 'market',
  vehicleNumber: 'MH12AB1234',
  route: 'Ludhiana to Bhiwandi',
  transporterName: 'Sohal Roadlines',
  consigneeName: 'Asian Paints',
  driverName: 'Ramesh Yadav',
  driverPhone: '9876543210',
  createdBy: 'creator-1',
  elrNumber: 'LR-88213',
  freightType: 'per_tonne',
  freightValue: '1200',
  plannedCapacityTonnes: '20',
  advancePercentage: '30',
  balancePaidAt: null,
  podStatus: null,
  podReviewedAt: null,
  podReviewedBy: null,
  podRejectionReason: null,
  reachedDeliveryPointAt: arrivedAt,
} as unknown as LoadAlertSnapshot;

function setup(overrides: Partial<LoadAlertSnapshot> = {}) {
  const repository = {
    findSnapshot: vi.fn(async () => ({ ...snapshot, ...overrides })),
    findPersonName: vi.fn(async () => 'Anita Sharma'),
  } as unknown as LoadAlertRepository;
  return createLoadAlertResolvers(repository, vi.fn(), {} as TrackingClient, {
    list: async () => [],
  });
}

describe('LS_N_0039 POD still pending', () => {
  const definition = NOTIFICATION_CATALOG['load.pod_pending'];
  const context = { loadId: 'load-1', since: arrivedAt.toISOString(), step: 0 };

  it('names the hours waited, the freight held up and who to chase', async () => {
    const resolved = (await setup().podPending('tenant-1', context))!;
    const content = definition.buildContent(resolved, recipient);
    expect(content.title).toBe('POD still pending on LD-1001');
    expect(content.body).toBe(
      'MH12AB1234 delivered at Asian Paints 24 hours ago and no POD is in. ₹24,000 cannot be billed until it is. Chase Sohal Roadlines or call Ramesh Yadav on 9876543210.',
    );
    expect(content.metadata).toMatchObject({
      first_name: 'Asha',
      hours_since: '24',
      amount: '₹24,000',
      cta_label: 'Chase POD',
    });
    expect(content.metadata).not.toHaveProperty('cta_path');
  });

  it('goes to POD reviewers and trip trackers, then to org admins only at 72 h', () => {
    expect(definition.recipientPermission({ ...context, step: 1 })).toHaveLength(2);
    expect(definition.extraRecipientRoles({ ...context, step: 1 })).toEqual([]);
    expect(definition.recipientPermission({ ...context, step: 2 })).toEqual([]);
    expect(definition.extraRecipientRoles({ ...context, step: 2 })).toEqual(['org_admin']);
  });

  it('chases a rejected POD from the rejection, and leaves the amount out on own fleet', async () => {
    const rejectedAt = new Date(Date.now() - 48 * HOUR);
    const resolved = (await setup({
      status: 'delivered',
      podStatus: 'rejected',
      podReviewedAt: rejectedAt,
      sourceType: 'own_fleet',
      transporterName: null,
    }).podPending('tenant-1', { loadId: 'load-1', since: rejectedAt.toISOString(), step: 1 }))!;
    expect(definition.buildContent(resolved, recipient).body).toBe(
      'The POD from MH12AB1234 at Asian Paints was sent back 48 hours ago and no new copy is in. Call Ramesh Yadav on 9876543210.',
    );
  });

  it('sends nothing once the POD is in, or for an older wait', async () => {
    expect(
      await setup({ status: 'delivered', podStatus: 'pending' }).podPending('tenant-1', context),
    ).toBeNull();
    expect(
      await setup({ reachedDeliveryPointAt: new Date() }).podPending('tenant-1', context),
    ).toBeNull();
  });
});

describe('LS_N_0040 POD rejected', () => {
  const definition = NOTIFICATION_CATALOG['load.pod_rejected'];
  const rejected = {
    status: 'delivered',
    podStatus: 'rejected',
    podReviewedAt: reviewedAt,
    podReviewedBy: 'verifier-1',
    podRejectionReason: 'Consignee stamp missing',
  } as Partial<LoadAlertSnapshot>;

  it('names the reviewer, the reason and the driver to ask', async () => {
    const resolved = (await setup(rejected).podRejected('tenant-1', {
      loadId: 'load-1',
      reviewedAt: reviewedAt.toISOString(),
    }))!;
    const content = definition.buildContent(resolved);
    expect(content.title).toBe('POD on LD-1001 sent back');
    expect(content.body).toBe(
      'Anita Sharma rejected the POD. Reason: Consignee stamp missing. Ask Ramesh Yadav on 9876543210 to upload a clear copy with the consignee stamp and date.',
    );
    expect(content.metadata.cta_label).toBe('Request a new POD');
    expect(definition.alsoNotifyUserId(resolved)).toBe('creator-1');
  });

  it('sends nothing once a new POD is uploaded', async () => {
    expect(
      await setup({ ...rejected, podStatus: 'pending' }).podRejected('tenant-1', {
        loadId: 'load-1',
        reviewedAt: reviewedAt.toISOString(),
      }),
    ).toBeNull();
  });
});

describe('LS_N_0041 POD verified, clear to bill', () => {
  const definition = NOTIFICATION_CATALOG['load.pod_verified'];
  const accepted = {
    status: 'delivered',
    podStatus: 'accepted',
    podReviewedAt: reviewedAt,
    podReviewedBy: 'verifier-1',
  } as Partial<LoadAlertSnapshot>;
  const context = { loadId: 'load-1', reviewedAt: reviewedAt.toISOString() };

  it('hands accounts the amount and the balance to release', async () => {
    const resolved = (await setup(accepted).podVerified('tenant-1', context))!;
    const content = definition.buildContent(resolved);
    expect(content.title).toBe('POD verified on LD-1001');
    expect(content.body).toBe(
      'Anita Sharma approved the POD against LR-88213. ₹24,000 is clear to invoice and the transporter balance can be released.',
    );
    expect(content.metadata.cta_label).toBe('Generate invoice');
  });

  it('own fleet: no amount and no transporter balance', async () => {
    const resolved = (await setup({ ...accepted, sourceType: 'own_fleet' }).podVerified(
      'tenant-1',
      context,
    ))!;
    expect(definition.buildContent(resolved).body).toBe(
      'Anita Sharma approved the POD against LR-88213. The load is clear to invoice.',
    );
  });
});

describe('POD review events and the POD-pending sweep', () => {
  it('routes the review decision to LS_N_0041 / LS_N_0040', async () => {
    const enqueue = vi.fn(async () => undefined);
    const notify = createLoadEventNotifier({ enqueue } as unknown as NotificationTriggers);
    await notify({
      kind: 'pod_reviewed',
      tenantId: 'tenant-1',
      loadId: 'load-1',
      decision: 'rejected',
      at: reviewedAt,
    });
    expect(enqueue).toHaveBeenCalledWith('load.pod_rejected', 'tenant-1', {
      loadId: 'load-1',
      reviewedAt: reviewedAt.toISOString(),
    });
  });

  it('queues the 24 / 48 / 72 h step that is due, and nothing in between', async () => {
    const now = new Date('2026-10-21T12:00:00Z');
    const waited = (hours: number) => ({
      loadId: `load-${hours}`,
      tenantId: 'tenant-1',
      since: new Date(now.getTime() - hours * HOUR),
    });
    const enqueue = vi.fn(async () => undefined);
    const repository = {
      findAssignedLoadsDueBetween: vi.fn(async () => []),
      findLoadingDetentionCandidates: vi.fn(async () => []),
      findUnloadingDetentionCandidates: vi.fn(async () => []),
      findClaimReminderDueBetween: vi.fn(async () => []),
      findPodPendingBetween: vi.fn(async () => [waited(24.5), waited(30), waited(48), waited(72)]),
    } as unknown as LoadAlertRepository;
    const result = await createTripTimingChecks(repository, {
      enqueue,
    } as unknown as NotificationTriggers).run(now);
    expect(
      enqueue.mock.calls.map((call) => [
        (call as unknown[])[0],
        ((call as unknown[])[2] as { step: number }).step,
      ]),
    ).toEqual([
      ['load.pod_pending', 0],
      ['load.pod_pending', 1],
      ['load.pod_pending', 2],
    ]);
    expect(result.podPending).toBe(3);
  });
});
