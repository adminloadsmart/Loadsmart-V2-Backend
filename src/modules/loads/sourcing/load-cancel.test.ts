import { describe, expect, it, vi } from 'vitest';
import { decideStage, StageRuleLoad } from '../core/stage-rules';
import { stagePathFor } from '../utils/load-stages';
import { LoadCancelService } from './load-cancel.service';
import { LoadPostingService } from '../load-posting/load-posting.service';
import { DEFAULT_SETTINGS } from '../../settings/settings.types';

const base: StageRuleLoad = {
  status: 'created',
  postingType: 'market_fleet',
  route: null,
  awardedParty: null,
  transporterId: null,
  vehicleNumber: null,
  memoAcceptedAt: null,
  invoiceNumber: null,
  invoiceFileKey: null,
  ewayBillNumber: null,
  ewayBillFileKey: null,
  elrFileKey: null,
  lsPapersApprovedAt: null,
  podFileKey: null,
  podStatus: null,
  shortageOrDamage: null,
  deliveryIssueSettledAt: null,
  transporterInvoiceFileKey: null,
  advancePaidAt: null,
  balancePaidAt: null,
  partnerBalancePaidAt: null,
  cancelledAt: null,
};
const cancelled = { cancelledAt: new Date() };

describe('the cancelled stage', () => {
  it('lets the shipper cancel any route before Loaded', () => {
    expect(decideStage(base, 'load_cancelled', 'shipper', cancelled)).toMatchObject({
      ok: true,
      to: 'cancelled',
    });
    for (const status of ['truck_assigned', 'in_transit_loading', 'reached_loading'] as const) {
      expect(
        decideStage(
          { ...base, status, route: 'own_transporter' },
          'load_cancelled',
          'shipper',
          cancelled,
        ).ok,
      ).toBe(true);
    }
    expect(
      decideStage(
        { ...base, status: 'truck_assigned', route: 'own_fleet' },
        'load_cancelled',
        'shipper',
        cancelled,
      ).ok,
    ).toBe(true);
    expect(
      decideStage(
        { ...base, status: 'loaded', route: 'indent' },
        'load_cancelled',
        'shipper',
        cancelled,
      ).ok,
    ).toBe(false);
  });

  it('keeps a load Loadsmart has won for Super Admin (ls_team)', () => {
    const won = { ...base, status: 'bids_received' as const, awardedParty: 'loadsmart' as const };
    expect(decideStage(won, 'load_cancelled', 'shipper', cancelled)).toMatchObject({
      ok: false,
      missing: ["Super Admin's approval (Loadsmart has the load)"],
    });
    expect(decideStage(won, 'load_cancelled', 'ls_team', cancelled).ok).toBe(true);
    const memo = { ...won, status: 'truck_assigned' as const, route: 'loadsmart' as const };
    expect(decideStage(memo, 'load_cancelled', 'shipper', cancelled).ok).toBe(false);
    expect(decideStage(memo, 'load_cancelled', 'ls_team', cancelled).ok).toBe(true);
  });

  it('shows the stepper up to the stage it was cancelled from', () => {
    expect(
      stagePathFor({
        postingType: 'market_fleet',
        status: 'cancelled',
        deliveryIssueSettledAt: null,
        cancelledFromStage: 'truck_assigned',
      }),
    ).toEqual(['created', 'bids_received', 'truck_assigned', 'cancelled']);
    expect(
      stagePathFor({
        postingType: 'market_fleet',
        status: 'created',
        deliveryIssueSettledAt: null,
      }),
    ).not.toContain('cancelled');
  });
});

function cancelFixture(load: Record<string, unknown>) {
  const rows: Record<string, unknown>[] = [];
  const cancellations = {
    create: (data: Record<string, unknown>) => ({ ...data }),
    save: async (data: Record<string, unknown>) => {
      const row = { id: `c-${rows.length + 1}`, createdAt: new Date(), ...data };
      rows.push(row);
      return row;
    },
    findOneBy: async (where: Record<string, unknown>) =>
      rows.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null,
    update: async (where: Record<string, unknown>, data: Record<string, unknown>) => {
      const hit = rows.filter((row) =>
        Object.entries(where).every(([key, value]) => row[key] === value),
      );
      hit.forEach((row) => Object.assign(row, data));
      return { affected: hit.length };
    },
  };
  const stageService = { transition: vi.fn(async () => ({ ...load, status: 'cancelled' })) };
  const bidRepository = { rejectAllOpen: vi.fn(async () => undefined) };
  const memo = { id: 'm-1', status: 'sent' };
  const memoRepository = {
    findLatest: vi.fn(async () => memo),
    markWithdrawn: vi.fn(async () => true),
  };
  const activity = { record: vi.fn() };
  const service = new LoadCancelService(
    { getRepository: () => cancellations } as never,
    { findById: async () => load } as never,
    stageService as never,
    bidRepository as never,
    memoRepository as never,
    activity as never,
    { log: vi.fn() } as never,
    { forLoad: async () => ({ id: null, version: 1, values: DEFAULT_SETTINGS }) } as never,
  );
  return { service, rows, stageService, bidRepository, memoRepository, activity };
}

describe('cancelling a load', () => {
  const transporterLoad = {
    id: 'load-1',
    tenantId: 't-1',
    status: 'truck_assigned',
    route: 'own_transporter',
    awardedParty: 'transporter',
  };

  it('cancels at once off Loadsmart: bids rejected, the memo withdrawn', async () => {
    const { service, rows, stageService, bidRepository, memoRepository } =
      cancelFixture(transporterLoad);
    const result = await service.cancel('t-1', 'u-1', 'load-1', {
      reasonCode: 'shipper_cancelled',
    });
    expect(result.outcome).toBe('cancelled');
    expect(stageService.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'load_cancelled',
        actorType: 'shipper',
        fields: expect.objectContaining({ cancelledFromStage: 'truck_assigned' }),
      }),
    );
    expect(bidRepository.rejectAllOpen).toHaveBeenCalledWith('t-1', 'load-1', 'u-1');
    expect(memoRepository.markWithdrawn).toHaveBeenCalled();
    expect(rows[0]).toMatchObject({
      kind: 'load',
      status: 'approved',
      reasonCode: 'shipper_cancelled',
    });
  });

  it('needs an active reason code and a load not yet Loaded', async () => {
    const { service } = cancelFixture(transporterLoad);
    await expect(service.cancel('t-1', 'u-1', 'load-1', { reasonCode: 'nope' })).rejects.toThrow(
      /not an active reason code/,
    );
    const loaded = cancelFixture({ ...transporterLoad, status: 'loaded' });
    await expect(
      loaded.service.cancel('t-1', 'u-1', 'load-1', { reasonCode: 'shipper_cancelled' }),
    ).rejects.toThrow(/before it is Loaded/);
  });

  it('on a Loadsmart load waits for Super Admin, who approves or rejects', async () => {
    const lsLoad = { ...transporterLoad, route: 'loadsmart', awardedParty: 'loadsmart' };
    const { service, rows, stageService } = cancelFixture(lsLoad);
    const request = await service.cancel('t-1', 'u-1', 'load-1', {
      reasonCode: 'shipper_cancelled',
    });
    expect(request.outcome).toBe('pending');
    expect(stageService.transition).not.toHaveBeenCalled();
    await expect(
      service.cancel('t-1', 'u-1', 'load-1', { reasonCode: 'shipper_cancelled' }),
    ).rejects.toThrow(/already waiting/);

    await expect(service.decide('u-admin', 'c-1', { decision: 'rejected' })).rejects.toThrow(/why/);
    const approved = await service.decide('u-admin', 'c-1', { decision: 'approved' });
    expect(approved.outcome).toBe('cancelled');
    expect(stageService.transition).toHaveBeenCalledWith(
      expect.objectContaining({ trigger: 'load_cancelled', actorType: 'ls_team' }),
    );
    expect(rows[0]).toMatchObject({ status: 'approved', decidedBy: 'u-admin' });
  });
});

describe('editing a posted load', () => {
  function postingFixture(
    posting: Record<string, unknown>,
    loads: Record<string, unknown>[],
    bids = 0,
  ) {
    const service = Object.create(LoadPostingService.prototype) as LoadPostingService;
    const repository = {
      findPostingById: async () => posting,
      listLoadsByPosting: async () => loads,
      countBids: async () => bids,
    };
    Object.assign(service, { repository });
    return service;
  }
  const form = { mode: 'market_fleet', truckCount: 1 } as never;

  it('refuses a full edit once bids are in, an award exists, or the type changes', async () => {
    const posting = { id: 'p-1', mode: 'market_fleet', truckCount: 1 };
    const open = [{ id: 'l-1', status: 'created', awardedBidId: null }];
    await expect(
      postingFixture(posting, open, 2).editPosting('t-1', 'u-1', {} as never, 'p-1', form),
    ).rejects.toThrow(/Bids have come in/);
    await expect(
      postingFixture(posting, [
        { id: 'l-1', status: 'bids_received', awardedBidId: 'b-1' },
      ]).editPosting('t-1', 'u-1', {} as never, 'p-1', form),
    ).rejects.toThrow(/already awarded/);
    await expect(
      postingFixture(posting, open).editPosting('t-1', 'u-1', {} as never, 'p-1', {
        mode: 'indent',
        truckCount: 1,
      } as never),
    ).rejects.toThrow(/load type can't change/);
  });

  it('after bids, allows the area but not once the truck is past that point', async () => {
    const posting = { id: 'p-1', pickupAddress: { city: 'Pune' }, dropAddress: { city: 'Delhi' } };
    const service = postingFixture(posting, [{ id: 'l-1', code: 'LOAD-1', status: 'loaded' }]);
    await expect(
      service.editDetails('t-1', 'u-1', 'p-1', { pickupArea: { areaLocality: 'Chakan' } }),
    ).rejects.toThrow(/pickup address can't change once LOAD-1 is loaded/);
    await expect(
      service.editDetails('t-1', 'u-1', 'p-1', { pickupAt: '2030-01-01T10:00:00Z' }),
    ).rejects.toThrow(/reporting time can't change/);
  });
});
