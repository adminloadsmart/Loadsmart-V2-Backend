import { describe, expect, it, vi } from 'vitest';
import {
  changePercent,
  liveStatus,
  median,
  moneyVisibility,
  previousPeriod,
  teamHolding,
} from './console-rules';
import { LsConsoleService } from './ls-console.service';
import type { AllLoadsRow, ConsoleRepository } from './console.repository';
import type { TrackingClient } from '../../adapters/tracking.client';
import type { LoadsmartRepository } from './loadsmart.repository';

const staff = (...permissions: string[]) => ({ role: 'staff', permissions });

describe('team holding a load', () => {
  const won = {
    sourcingStatus: 'won' as const,
    claimOpen: false,
    invoiceStatus: null,
    carrierBalancePaid: false,
  };

  it('follows the load from Approval to closed', () => {
    expect(teamHolding({ ...won, sourcingStatus: 'pending_approval', loadStatus: 'created' })).toBe(
      'approval',
    );
    expect(teamHolding({ ...won, sourcingStatus: 'bid_sent', loadStatus: 'bids_received' })).toBe(
      'placement',
    );
    expect(teamHolding({ ...won, loadStatus: 'bids_received' })).toBe('placement');
    expect(teamHolding({ ...won, loadStatus: 'loaded' })).toBe('tracking');
    expect(teamHolding({ ...won, loadStatus: 'reached_unloading' })).toBe('tracking');
    expect(teamHolding({ ...won, loadStatus: 'delivered_with_issues', claimOpen: true })).toBe(
      'cs',
    );
    expect(teamHolding({ ...won, loadStatus: 'delivered_ok' })).toBe('receivables');
    expect(teamHolding({ ...won, loadStatus: 'payment', invoiceStatus: 'partly_paid' })).toBe(
      'receivables',
    );
    expect(teamHolding({ ...won, loadStatus: 'payment', invoiceStatus: 'paid' })).toBe('payables');
    expect(teamHolding({ ...won, loadStatus: 'closed' })).toBe('closed');
    expect(teamHolding({ ...won, sourcingStatus: 'lost', loadStatus: 'truck_assigned' })).toBe(
      'off_loadsmart',
    );
  });
});

describe('money each team sees', () => {
  it('hides shipper rates from Tracking and Payables, carrier rates from Receivables', () => {
    expect(moneyVisibility(staff('loadsmart.placement'))).toEqual({
      shipper: true,
      carrier: true,
      margin: true,
    });
    expect(moneyVisibility(staff('loadsmart.tracking'))).toEqual({
      shipper: false,
      carrier: true,
      margin: false,
    });
    expect(moneyVisibility(staff('loadsmart.payables'))).toEqual({
      shipper: false,
      carrier: true,
      margin: false,
    });
    expect(moneyVisibility(staff('loadsmart.receivables'))).toEqual({
      shipper: true,
      carrier: false,
      margin: false,
    });
    expect(moneyVisibility(staff('loadsmart.cs'))).toEqual({
      shipper: false,
      carrier: false,
      margin: false,
    });
    expect(moneyVisibility(staff('loadsmart.money.approve'))).toEqual({
      shipper: true,
      carrier: true,
      margin: true,
    });
    expect(moneyVisibility({ role: 'platform_admin', permissions: [] }).margin).toBe(true);
  });
});

describe('live map status', () => {
  const now = new Date('2026-11-16T10:00:00Z');
  const at = (minutesAgo: number) => ({
    recordedAt: new Date(now.getTime() - minutesAgo * 60_000),
    stale: false,
  });

  it('is moving, no signal after 2 h, or needs action', () => {
    expect(liveStatus({ position: at(10), pendingAction: false, runningLate: false }, now)).toBe(
      'moving',
    );
    expect(liveStatus({ position: at(121), pendingAction: false, runningLate: false }, now)).toBe(
      'no_signal',
    );
    expect(liveStatus({ position: null, pendingAction: false, runningLate: false }, now)).toBe(
      'no_signal',
    );
    expect(liveStatus({ position: at(10), pendingAction: true, runningLate: false }, now)).toBe(
      'needs_action',
    );
    expect(liveStatus({ position: at(10), pendingAction: false, runningLate: true }, now)).toBe(
      'needs_action',
    );
    expect(
      liveStatus({ position: at(10), halted: true, pendingAction: false, runningLate: false }, now),
    ).toBe('at_a_stop');
  });
});

describe('analytics helpers', () => {
  it('takes medians, the previous period and the change', () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
    const before = previousPeriod(
      new Date('2026-11-08T00:00:00Z'),
      new Date('2026-11-15T00:00:00Z'),
    );
    expect(before).toEqual({
      from: new Date('2026-11-01T00:00:00Z'),
      to: new Date('2026-11-08T00:00:00Z'),
    });
    expect(changePercent(120, 100)).toBe(20);
    expect(changePercent(5, 0)).toBeNull();
  });
});

const row = (overrides: Partial<AllLoadsRow>): AllLoadsRow => ({
  sourcingId: 's-1',
  sourcingStatus: 'won',
  tenantId: 't-1',
  shipperName: 'Acme',
  trackingOwnerId: null,
  placementOwnerId: null,
  loadId: 'load-1',
  code: 'LOAD-1',
  status: 'loaded',
  vehicleNumber: 'MH12AB1234',
  driverName: 'Ravi',
  driverNumber: '9876543210',
  fromCity: 'Pune',
  toCity: 'Delhi',
  pickupAt: null,
  partnerName: 'Broker One',
  shipperTrip: '50000.00',
  carrierTrip: '45000.00',
  claimStatus: null,
  invoiceStatus: null,
  advanceStatus: 'paid',
  balanceStatus: null,
  lastStageAt: null,
  updatedAt: new Date(),
  ...overrides,
});

function consoleFixture(rows: AllLoadsRow[], tracking: Partial<TrackingClient> = {}) {
  const consoleRepository = { allLoads: vi.fn(async () => rows) } as unknown as ConsoleRepository;
  const repository = {
    findSourcingByLoad: async () => ({
      load: { unloadingContactPhone: null, unloadingAppointmentId: null },
    }),
  } as unknown as LoadsmartRepository;
  const service = new LsConsoleService(
    { getRepository: () => ({}) } as never,
    repository,
    consoleRepository,
    {} as never,
    {} as never,
    tracking as TrackingClient,
    {} as never,
    {} as never,
    () => new Date('2026-11-16T10:00:00Z'),
  );
  return { service, consoleRepository };
}

describe('All loads (L01)', () => {
  const rows = [
    row({}),
    row({ loadId: 'load-2', code: 'LOAD-2', status: 'delivered_ok' }),
    row({ loadId: 'load-3', code: 'LOAD-3', sourcingStatus: 'posted', status: 'created' }),
  ];

  it('counts loads per team and filters by team', async () => {
    const { service } = consoleFixture(rows);
    const all = await service.allLoads(staff('loadsmart.placement'), {});
    expect(all.counts).toEqual({ tracking: 1, receivables: 1, placement: 1 });
    const tracking = await service.allLoads(staff('loadsmart.placement'), { team: 'tracking' });
    expect(tracking.items.map((item) => item.code)).toEqual(['LOAD-1']);
  });

  it('shows Tracking the carrier freight only, Receivables the shipper freight only', async () => {
    const { service } = consoleFixture([row({})]);
    const tracking = await service.allLoads(staff('loadsmart.tracking'), {});
    expect(tracking.items[0].money).toEqual({ carrierFreight: 45000 });
    expect(tracking.items[0].invoice).toBeUndefined();
    const receivables = await service.allLoads(staff('loadsmart.receivables'), {});
    expect(receivables.items[0].money).toEqual({ shipperFreight: 50000 });
    expect(receivables.items[0].carrierAdvance).toBeUndefined();
    const placement = await service.allLoads(staff('loadsmart.placement'), {});
    expect(placement.items[0].money).toEqual({
      shipperFreight: 50000,
      carrierFreight: 45000,
      margin: 5000,
      marginPercent: 10,
    });
  });
});

describe('Tracking inbox', () => {
  const rows = [
    row({ loadId: 'a', code: 'A', trackingOwnerId: 'me' }),
    row({ loadId: 'b', code: 'B', trackingOwnerId: 'someone-else' }),
    row({ loadId: 'c', code: 'C', trackingOwnerId: null }),
    row({ loadId: 'd', code: 'D', status: 'delivered_ok' }), // no longer on the road
  ];
  const me = { id: 'me', ...staff('loadsmart.tracking') };

  it('lists only loads on the road, with counts for all, mine and unclaimed', async () => {
    const { service } = consoleFixture(rows);
    const inbox = await service.trackingInbox(me, {});
    expect(inbox.items.map((item) => item.code)).toEqual(['A', 'B', 'C']);
    expect(inbox.counts).toEqual({ all: 3, mine: 1, unclaimed: 1 });
  });

  it('narrows to mine or unclaimed, shows carrier money only and no margin', async () => {
    const { service } = consoleFixture(rows);
    const mine = await service.trackingInbox(me, { mine: true });
    expect(mine.items.map((item) => item.code)).toEqual(['A']);
    expect(mine.items[0].owners.tracking).toBe('me');
    const unclaimed = await service.trackingInbox(me, { unclaimed: true });
    expect(unclaimed.items.map((item) => item.code)).toEqual(['C']);
    expect(unclaimed.items[0].money).toEqual({ carrierFreight: 45000 });
  });
});

describe('Live map (T07)', () => {
  it('reads each trip from tracking and survives tracking being down', async () => {
    const getTrip = vi
      .fn()
      .mockResolvedValueOnce({
        eta: { etaAt: new Date(), remainingKm: 120, stale: false, projectedDelayMin: -10 },
        position: {
          lat: 18.5,
          lng: 73.8,
          recordedAt: new Date('2026-11-16T09:50:00Z'),
          stale: false,
          placeName: 'Pune',
        },
      })
      .mockRejectedValueOnce(new Error('down'));
    const { service } = consoleFixture(
      [
        row({ status: 'in_transit_unloading' }),
        row({ loadId: 'load-2', code: 'LOAD-2', status: 'reached_unloading' }),
      ],
      { getTrip },
    );
    const map = await service.liveMap({});
    expect(map.items.map((item) => [item.code, item.liveStatus, item.needs])).toEqual([
      ['LOAD-1', 'needs_action', ['unloading details']],
      ['LOAD-2', 'needs_action', ['POD to decide']],
    ]);
    expect(map.items[0].position).toMatchObject({ placeName: 'Pune' });
    expect(map.items[1].position).toBeNull();
  });
});
