import { describe, expect, it, vi } from 'vitest';
import type { TrackingClient } from '../../adapters/tracking.client';
import { createIssueReportedNotifier } from './breakdown-alerts';
import {
  DriverProblemReportedContext,
  NOTIFICATION_CATALOG,
  PodUploadedContext,
} from './catalog/notification-catalog';
import type { LoadAlertRepository } from './load-alert.repository';
import { createLoadAlertResolvers } from './load-alerts';
import type { LoadAlertSnapshot } from './notifications.interface';
import { createTripTimingChecks } from './trip-timing';
import { NotificationTriggers } from './notifications.interface';

const DAY = 24 * 60 * 60 * 1000;
const recipient = { userId: 'user-1', fullName: 'Asha Verma' };

const snapshot = {
  code: 'LD-1001',
  status: 'delivered_ok',
  sourceType: 'market',
  vehicleNumber: 'MH12AB1234',
  route: 'Ludhiana to Bhiwandi',
  transporterName: 'Sohal Roadlines',
  consigneeName: 'Asian Paints',
  originCity: 'Ludhiana',
  destinationCity: 'Bhiwandi',
  driverName: 'Ramesh Yadav',
  createdBy: 'creator-1',
  elrNumber: 'LR-88213',
  freightType: 'flat',
  freightValue: '40000',
  plannedCapacityTonnes: '20',
  advancePercentage: '30',
  balancePaidAt: null,
  podStatus: 'pending',
  podReceiverName: 'Suresh Kumar',
  podQuantityReceived: '19.5',
  numberOfTonnesShort: '0.5',
  shortageOrDamage: 'shortage',
  deliveredAt: new Date(),
  cargoValuePerTonne: '6000',
} as unknown as LoadAlertSnapshot;

function setup(
  overrides: { snapshot?: Partial<LoadAlertSnapshot>; claimWindowDays?: number } = {},
) {
  const repository = {
    findSnapshot: vi.fn(async () => ({ ...snapshot, ...overrides.snapshot })),
    findClaimWindowDays: vi.fn(async () => overrides.claimWindowDays ?? 7),
  } as unknown as LoadAlertRepository;
  const resolvers = createLoadAlertResolvers(repository, vi.fn(), {} as TrackingClient, {
    list: async () => [],
  });
  return { resolvers };
}

describe('LS_N_0034 shortage or damage recorded', () => {
  const build = NOTIFICATION_CATALOG['load.shortage_recorded'].buildContent;

  it('names the shortage, its value at risk and the claim window', async () => {
    const { resolvers } = setup();
    const resolved = (await resolvers.shortageRecorded('tenant-1', { loadId: 'load-1' }))!;
    expect(resolved).toMatchObject({ shortage: true, claimValue: '₹3,000', claimWindowDays: 7 });
    const content = build(resolved);
    expect(content.title).toBe('Shortage recorded on LD-1001');
    expect(content.body).toBe(
      'Asian Paints recorded 0.5 MT short against LR-88213. Value at risk ₹3,000. Raise a claim with Sohal Roadlines within 7 days or the recovery lapses.',
    );
    expect(NOTIFICATION_CATALOG['load.shortage_recorded'].alsoNotifyUserId(resolved)).toBe(
      'creator-1',
    );
  });

  it('alerts damage (or wet cargo) too, with no value at risk', async () => {
    const { resolvers } = setup({
      snapshot: { numberOfTonnesShort: '0', shortageOrDamage: 'wet' },
    });
    const content = build((await resolvers.shortageRecorded('tenant-1', { loadId: 'load-1' }))!);
    expect(content.title).toBe('Damage recorded on LD-1001');
    expect(content.body).toBe(
      'Asian Paints recorded damage against LR-88213. Raise a claim with Sohal Roadlines within 7 days or the recovery lapses.',
    );
  });

  it('leaves out the value at risk without a cargo value per MT', async () => {
    const { resolvers } = setup({ snapshot: { cargoValuePerTonne: null } });
    const resolved = (await resolvers.shortageRecorded('tenant-1', { loadId: 'load-1' }))!;
    expect(resolved.claimValue).toBeNull();
    expect(build(resolved).body).not.toContain('Value at risk');
  });

  it('sends nothing when the E-POD recorded neither', async () => {
    const { resolvers } = setup({
      snapshot: { numberOfTonnesShort: '0', shortageOrDamage: 'none' },
    });
    expect(await resolvers.shortageRecorded('tenant-1', { loadId: 'load-1' })).toBeNull();
  });

  it('the reminder counts down, and is dropped once the window has closed', async () => {
    const open = setup({ snapshot: { deliveredAt: new Date(Date.now() - 4 * DAY) } });
    const reminder = (await open.resolvers.shortageRecorded('tenant-1', {
      loadId: 'load-1',
      reminder: true,
    }))!;
    expect(build(reminder).title).toBe('Claim window closes in 3 days on LD-1001');
    expect(build(reminder).body).toMatch(
      /^3 days left to raise a claim with Sohal Roadlines for the 0.5 MT short recorded against LR-88213 at Asian Paints\. The window closes on \d+ \w+\. Value at risk ₹3,000\.$/,
    );
    const closed = setup({ snapshot: { deliveredAt: new Date(Date.now() - 8 * DAY) } });
    expect(
      await closed.resolvers.shortageRecorded('tenant-1', { loadId: 'load-1', reminder: true }),
    ).toBeNull();
  });
});

describe('LS_N_0038 POD uploaded', () => {
  const context: PodUploadedContext = {
    loadId: 'load-1',
    uploadedAt: '2026-10-21T08:50:00.000Z', // 14:20 IST
  };
  const build = NOTIFICATION_CATALOG['load.pod_uploaded'].buildContent;

  it('names the transporter balance the review holds up', async () => {
    const { resolvers } = setup();
    const resolved = (await resolvers.podUploaded('tenant-1', context))!;
    expect(resolved.balanceAmount).toBe('₹28,000');
    expect(build(resolved).body).toBe(
      'Ramesh Yadav uploaded the POD against LR-88213 at 14:20. 0.5 t short. Verify it to release the ₹28,000 balance to Sohal Roadlines.',
    );
    expect(NOTIFICATION_CATALOG['load.pod_uploaded'].alsoNotifyUserId(resolved)).toBe('creator-1');
  });

  it('own fleet, or a balance already paid: no amount', async () => {
    for (const overrides of [{ sourceType: 'own_fleet' }, { balancePaidAt: new Date() }]) {
      const { resolvers } = setup({
        snapshot: { ...overrides, numberOfTonnesShort: null, shortageOrDamage: 'none' },
      });
      const resolved = (await resolvers.podUploaded('tenant-1', context))!;
      expect(resolved.balanceAmount).toBeNull();
      expect(build(resolved).body).toBe(
        'Ramesh Yadav uploaded the POD against LR-88213 at 14:20. Verify it to close the trip.',
      );
    }
  });
});

describe('LS_N_0037 driver reported a problem', () => {
  const build = NOTIFICATION_CATALOG['load.driver_problem_reported'].buildContent;
  const context: DriverProblemReportedContext = {
    loadId: 'load-1',
    issueId: 'issue-1',
    loadCode: 'LD-1001',
    category: 'road_blocked',
    driverName: 'Ramesh Yadav',
    driverPhone: '9876500000',
    location: 'Khanna, Ludhiana',
    reportedAt: '2026-10-21T08:50:00.000Z',
    driverNote: 'Farmers protest on NH-44',
    etaImpactMinutes: null,
  };

  it('reads like the sheet; the ETA impact appears once something fills it', () => {
    const content = build(context, recipient);
    expect(content.title).toBe('Ramesh Yadav reported a road block on LD-1001');
    expect(content.body).toBe(
      'Reported near Khanna, Ludhiana at 14:20. Farmers protest on NH-44. Driver on 9876500000.',
    );
    expect(content.metadata).toMatchObject({
      cta_label: 'Call driver',
      cta_phone: '+919876500000',
    });
    expect(build({ ...context, etaImpactMinutes: 180 }, recipient).body).toBe(
      'Reported near Khanna, Ludhiana at 14:20. Farmers protest on NH-44. ETA impact about 3 h. Driver on 9876500000.',
    );
  });

  it('the issue notifier routes breakdowns to LS_N_0054 and serious problems to LS_N_0037', async () => {
    const enqueue = vi.fn(async () => undefined);
    const notify = createIssueReportedNotifier({ enqueue } as unknown as NotificationTriggers);
    const report = { tenantId: 'tenant-1', loadId: 'load-1', issueId: 'issue-1' };
    await notify({ ...report, category: 'breakdown' });
    await notify({ ...report, category: 'strike' });
    await notify({ ...report, category: 'traffic_jam' });
    await notify({ ...report, category: 'halt_rest_stop' });
    expect(enqueue.mock.calls.map((call) => (call as unknown[])[0])).toEqual([
      'load.breakdown_reported',
      'load.driver_problem_reported',
    ]);
  });
});

describe('trip-timing sweep — LS_N_0034 claim reminders', () => {
  it('queues the reminder for each load whose window closes in 3 days', async () => {
    const enqueue = vi.fn(async () => undefined);
    const findClaimReminderDueBetween = vi.fn(async () => [
      { loadId: 'load-1', tenantId: 'tenant-1' },
    ]);
    const repository = {
      findAssignedLoadsDueBetween: vi.fn(async () => []),
      findLoadingDetentionCandidates: vi.fn(async () => []),
      findUnloadingDetentionCandidates: vi.fn(async () => []),
      findClaimReminderDueBetween,
      findPodPendingBetween: vi.fn(async () => []),
    } as unknown as LoadAlertRepository;
    const result = await createTripTimingChecks(repository, {
      enqueue,
    } as unknown as NotificationTriggers).run(new Date('2026-10-21T12:00:00Z'));
    expect(findClaimReminderDueBetween).toHaveBeenCalledWith(
      new Date('2026-10-21T11:00:00Z'),
      new Date('2026-10-21T12:00:00Z'),
      3,
    );
    expect(enqueue).toHaveBeenCalledWith('load.shortage_recorded', 'tenant-1', {
      loadId: 'load-1',
      reminder: true,
    });
    expect(result.claimReminders).toBe(1);
  });
});
