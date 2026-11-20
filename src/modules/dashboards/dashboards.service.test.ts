import { describe, expect, it } from 'vitest';
import { DashboardsService } from './dashboards.service';
import type { DashboardsRepository } from './dashboards.repository';
import type { WaitingOnYouLoadRow, WaitingOnYouRaw } from './utils/dashboards.interface';

const baseLoad: WaitingOnYouLoadRow = {
  id: 'load',
  status: 'created',
  route: null,
  awardedParty: null,
  awardedBidId: null,
  memoAcceptedAt: null,
  invoiceNumber: null,
  invoiceFileKey: null,
  ewayBillNumber: null,
  ewayBillFileKey: null,
  elrFileKey: null,
  podFileKey: null,
  podBackFileKey: null,
  podStatus: null,
  transporterInvoiceFileKey: null,
  advancePercentage: null,
  advancePaidAt: null,
  balancePaidAt: null,
  deliveryIssueSettledAt: null,
  freightType: 'flat',
  freightValue: null,
  plannedCapacityTonnes: '10',
  deliveryIssueDeductionAmount: null,
};

const emptyRaw = (loads: WaitingOnYouLoadRow[]): WaitingOnYouRaw => ({
  loads,
  raisedCharges: new Map(),
  charges: new Map(),
  payments: new Map(),
  latestMemo: new Map(),
  invoiceOpen: new Map(),
  lowestBid: new Map(),
});

const serviceFor = (raw: WaitingOnYouRaw) =>
  new DashboardsService(
    { getWaitingOnYouRaw: async () => raw } as unknown as DashboardsRepository,
    {} as never,
    {} as never,
    {} as never,
  );

const bucket = (result: Awaited<ReturnType<DashboardsService['getWaitingOnYou']>>, key: string) =>
  result.buckets.find((entry) => entry.key === key)!;

describe('DashboardsService.getWaitingOnYou', () => {
  it('prices the lowest bid in the load freight basis', async () => {
    const raw = emptyRaw([
      { ...baseLoad, id: 'a', status: 'bids_received', freightType: 'per_ton' },
    ]);
    raw.lowestBid.set('a', '2000');
    const result = await serviceFor(raw).getWaitingOnYou('tenant');
    expect(bucket(result, 'bids_to_confirm')).toMatchObject({
      count: 1,
      loads: 1,
      amount: 20000,
      singleLoadId: 'a',
    });
  });

  it('sums advance due on own-transporter loads that are loaded and unpaid', async () => {
    const loaded = {
      ...baseLoad,
      status: 'loaded' as const,
      route: 'own_transporter' as const,
      advancePercentage: '80',
      freightValue: '10000',
    };
    const raw = emptyRaw([
      { ...loaded, id: 'a' },
      { ...loaded, id: 'b', freightValue: '5000' },
    ]);
    const result = await serviceFor(raw).getWaitingOnYou('tenant');
    expect(bucket(result, 'advance_to_release')).toMatchObject({
      count: 2,
      amount: 12000,
      singleLoadId: null,
    });
    expect(result.totalLoads).toBe(2);
  });

  it('counts charges, not loads, on charges_to_approve and puts each load in one bucket', async () => {
    const raw = emptyRaw([{ ...baseLoad, id: 'a', status: 'loaded', route: 'loadsmart' }]);
    raw.raisedCharges.set('a', { count: 3, total: 3600 });
    const result = await serviceFor(raw).getWaitingOnYou('tenant');
    expect(bucket(result, 'charges_to_approve')).toMatchObject({
      count: 3,
      loads: 1,
      amount: 3600,
    });
    expect(result.totalLoads).toBe(1);
  });

  it('treats an expired sent memo as not waiting', async () => {
    const raw = emptyRaw([
      { ...baseLoad, id: 'live', status: 'truck_assigned' },
      { ...baseLoad, id: 'old', status: 'truck_assigned' },
    ]);
    raw.latestMemo.set('live', { status: 'sent', expiresAt: new Date(Date.now() + 60_000) });
    raw.latestMemo.set('old', { status: 'sent', expiresAt: new Date(Date.now() - 60_000) });
    const result = await serviceFor(raw).getWaitingOnYou('tenant');
    expect(bucket(result, 'memos_to_confirm')).toMatchObject({
      count: 1,
      amount: null,
      singleLoadId: 'live',
    });
  });

  it('skips loads with nothing for the shipper to do', async () => {
    const raw = emptyRaw([{ ...baseLoad, id: 'a', status: 'truck_assigned', route: 'own_fleet' }]);
    const result = await serviceFor(raw).getWaitingOnYou('tenant');
    expect(result.totalLoads).toBe(0);
  });
});
