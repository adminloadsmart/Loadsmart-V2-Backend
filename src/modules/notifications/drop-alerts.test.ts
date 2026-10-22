import { describe, expect, it, vi } from 'vitest';
import type { TrackingClient } from '../../adapters/tracking.client';
import {
  DetentionAtUnloadingContext,
  NOTIFICATION_CATALOG,
  TripCompletedContext,
  VehicleReachedDropContext,
} from './catalog/notification-catalog';
import type { DetentionCandidate, LoadAlertRepository } from './load-alert.repository';
import { createLoadAlertResolvers } from './load-alerts';
import type { NotificationTriggers } from './notification-triggers';
import type { LoadAlertSnapshot } from './notifications.interface';
import { createTripTimingChecks } from './trip-timing';

const HOUR = 60 * 60 * 1000;
const NOW = new Date('2026-10-20T12:00:00.000Z');
const recipient = { userId: 'user-1', fullName: 'Asha Verma' };

const snapshot = {
  code: 'LD-1001',
  status: 'reached_delivery_point',
  vehicleNumber: 'MH12AB1234',
  route: 'Ludhiana to Bhiwandi',
  transporterName: null,
  consigneeName: 'Asian Paints',
  destinationCity: 'Bhiwandi',
  createdBy: 'creator-1',
  podQuantityReceived: '18.00',
  reachedDeliveryPointAt: new Date(NOW.getTime() - 5 * HOUR),
  deliveredAt: null,
  departedDropAt: null,
  promisedDeliveryDate: '2026-10-20',
  customerFreeHoursAtDrop: null,
} as unknown as LoadAlertSnapshot;

function setup(
  overrides: {
    snapshot?: Partial<LoadAlertSnapshot>;
    arrivedByTracking?: boolean;
    alreadySent?: boolean;
  } = {},
) {
  const repository = {
    findSnapshot: vi.fn(async () => ({ ...snapshot, ...overrides.snapshot })),
    findDetentionTerms: vi.fn(async () => ({
      loadingFreeHours: 4,
      unloadingFreeHours: 4,
      ratePerHour: 500,
    })),
    arrivedByTracking: vi.fn(async () => overrides.arrivedByTracking ?? false),
    hasSentNotification: vi.fn(async () => overrides.alreadySent ?? false),
  } as unknown as LoadAlertRepository;
  const resolvers = createLoadAlertResolvers(repository, vi.fn(), {} as TrackingClient, {
    list: async () => [],
  });
  return { repository, resolvers };
}

describe('LS_N_0031 vehicle reached unloading point', () => {
  const context: VehicleReachedDropContext = {
    loadId: 'load-1',
    arrivedAt: '2026-10-20T10:30:00.000Z', // 16:00 IST, the promised day
  };

  it("is early against the end of the promised day; free time is the customer's own", async () => {
    const { resolvers } = setup({ snapshot: { customerFreeHoursAtDrop: 6 } });
    const resolved = (await resolvers.vehicleReachedDrop('tenant-1', context))!;
    expect(resolved.freeTimeEndsAt).toBe('2026-10-20T16:30:00.000Z');
    const content = NOTIFICATION_CATALOG['load.vehicle_reached_drop'].buildContent(resolved);
    expect(content.title).toBe('MH12AB1234 reached Asian Paints');
    expect(content.body).toBe(
      'Arrived at 16:00, 7 h 59 min early against 20 Oct. Free unloading time ends at 20 Oct, 22:00.',
    );
  });

  it("falls back to the company's free hours, and leaves out early/late with no promised date", async () => {
    const { resolvers } = setup({ snapshot: { promisedDeliveryDate: null } });
    const resolved = (await resolvers.vehicleReachedDrop('tenant-1', context))!;
    expect(resolved.freeTimeEndsAt).toBe('2026-10-20T14:30:00.000Z');
    const { body } = NOTIFICATION_CATALOG['load.vehicle_reached_drop'].buildContent(resolved);
    expect(body).toBe('Arrived at 16:00. Free unloading time ends at 20 Oct, 20:00.');
  });
});

describe('LS_N_0032 detention at unloading', () => {
  const context: DetentionAtUnloadingContext = {
    loadId: 'load-1',
    arrivedAt: new Date(Date.now() - 5 * HOUR).toISOString(),
    step: 0,
  };
  const fiveHoursAgo = () => new Date(Date.now() - 5 * HOUR);

  it('bills the hours beyond the free time while the vehicle is at the drop', async () => {
    const { resolvers } = setup({ snapshot: { reachedDeliveryPointAt: fiveHoursAgo() } });
    const resolved = (await resolvers.detentionAtUnloading('tenant-1', context))!;
    expect(resolved).toMatchObject({ hoursAtDestination: 5, freeHours: 4, amount: '₹500' });
    const content = NOTIFICATION_CATALOG['load.detention_at_unloading'].buildContent(
      resolved,
      recipient,
    );
    expect(content.title).toBe('Detention started at Asian Paints');
    expect(content.body).toBe(
      'MH12AB1234 has been at Bhiwandi for 5 hours against 4 free. ₹500 is billable to Asian Paints.',
    );
  });

  it('stops once tracking saw the vehicle leave', async () => {
    const { resolvers } = setup({
      snapshot: { reachedDeliveryPointAt: fiveHoursAgo(), departedDropAt: new Date() },
    });
    expect(await resolvers.detentionAtUnloading('tenant-1', context)).toBeNull();
  });

  it('after the E-POD, keeps running only when the geofence saw it arrive', async () => {
    const delivered = {
      status: 'delivered',
      reachedDeliveryPointAt: fiveHoursAgo(),
      deliveredAt: new Date(Date.now() - HOUR),
    };
    const manual = setup({ snapshot: delivered, arrivedByTracking: false });
    expect(await manual.resolvers.detentionAtUnloading('tenant-1', context)).toBeNull();
    const tracked = setup({ snapshot: delivered, arrivedByTracking: true });
    expect(await tracked.resolvers.detentionAtUnloading('tenant-1', context)).not.toBeNull();
  });

  it('a step already sent is not sent again', async () => {
    const { resolvers } = setup({
      snapshot: { reachedDeliveryPointAt: fiveHoursAgo() },
      alreadySent: true,
    });
    expect(await resolvers.detentionAtUnloading('tenant-1', context)).toBeNull();
  });
});

describe('LS_N_0033 trip completed', () => {
  const delivered = { status: 'delivered', deliveredAt: new Date() };

  it('waits for the E-POD', async () => {
    const { resolvers } = setup();
    expect(await resolvers.tripCompleted('tenant-1', { loadId: 'load-1' })).toBeNull();
  });

  it('waits for tracking to see the vehicle leave when the geofence saw it arrive', async () => {
    const { resolvers } = setup({ snapshot: delivered, arrivedByTracking: true });
    expect(await resolvers.tripCompleted('tenant-1', { loadId: 'load-1' })).toBeNull();
    // …unless it's the post-E-POD retry: the exit never came.
    expect(
      await resolvers.tripCompleted('tenant-1', { loadId: 'load-1', fallback: true }),
    ).not.toBeNull();
  });

  it('completes on the E-POD alone after a manual arrival', async () => {
    const { resolvers } = setup({ snapshot: delivered, arrivedByTracking: false });
    const resolved = (await resolvers.tripCompleted('tenant-1', { loadId: 'load-1' }))!;
    const content = NOTIFICATION_CATALOG['load.trip_completed'].buildContent(resolved);
    expect(content.title).toBe('LD-1001 delivered');
    expect(content.body).toBe('MH12AB1234 unloaded 18 MT at Asian Paints.');
  });

  it('names the departure time and goes to the load creator too', async () => {
    const { resolvers } = setup({
      snapshot: { ...delivered, departedDropAt: new Date('2026-10-20T11:10:00.000Z') },
      arrivedByTracking: true,
    });
    const resolved: TripCompletedContext = (await resolvers.tripCompleted('tenant-1', {
      loadId: 'load-1',
    }))!;
    const definition = NOTIFICATION_CATALOG['load.trip_completed'];
    expect(definition.buildContent(resolved).body).toBe(
      'MH12AB1234 unloaded 18 MT at Asian Paints and left at 16:40.',
    );
    expect(definition.alsoNotifyUserId(resolved)).toBe('creator-1');
  });
});

describe('trip-timing sweep — detention steps', () => {
  const candidate = (hoursAgo: number, freeHours: number): DetentionCandidate => ({
    loadId: 'load-1',
    tenantId: 'tenant-1',
    arrivedAt: new Date(NOW.getTime() - hoursAgo * HOUR),
    freeHours,
  });

  async function run(unloading: DetentionCandidate[]) {
    const enqueue = vi.fn(async () => undefined);
    const repository = {
      findAssignedLoadsDueBetween: vi.fn(async () => []),
      findLoadingDetentionCandidates: vi.fn(async () => []),
      findUnloadingDetentionCandidates: vi.fn(async () => unloading),
      findClaimReminderDueBetween: vi.fn(async () => []),
      findPodPendingBetween: vi.fn(async () => []),
    } as unknown as LoadAlertRepository;
    await createTripTimingChecks(repository, {
      enqueue,
    } as unknown as NotificationTriggers).run(NOW);
    return enqueue;
  }

  it("goes out at each load's own free-time boundary, then every 4 hours", async () => {
    const enqueue = await run([candidate(6.1, 6), candidate(10.2, 6), candidate(7, 6)]);
    expect(enqueue.mock.calls.map((call) => (call as unknown[])[2])).toEqual([
      expect.objectContaining({ step: 0 }),
      expect.objectContaining({ step: 1 }),
    ]);
  });

  it('stops after 48 hours of detention', async () => {
    expect(await run([candidate(4 + 48, 4)])).not.toHaveBeenCalled();
  });
});
