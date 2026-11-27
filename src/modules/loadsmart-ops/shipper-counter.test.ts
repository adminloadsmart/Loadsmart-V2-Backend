import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../audit/audit.service';
import type { LoadActivityService } from '../loads/activity/load-activity.service';
import type { LoadBidEntity } from '../loads/bids/load-bid.entity';
import type { LoadBidService } from '../loads/bids/load-bid.service';
import type { LoadEntity } from '../loads/entities/load.entity';
import type { LoadsmartRepository } from './loadsmart.repository';
import { LsSourcingService } from './ls-sourcing.service';

const NOW = new Date('2026-11-26T08:30:00Z');

// A 5 T per-tonne load: Loadsmart bid ₹8,400 (₹1,680/t) on the broker's ₹8,000 (₹1,600/t); the
// shipper countered ₹7,800 for the trip (₹1,560/t).
function setup(otherLiveBids: Partial<LoadBidEntity>[] = []) {
  const sourcing = {
    id: 'sourcing-1',
    tenantId: 'tenant-1',
    loadId: 'load-1',
    status: 'bid_sent',
    marginPercent: '5',
    negotiationNote: null,
    bidSentBy: 'user-1',
    load: { id: 'load-1', code: 'LOAD-1030', freightType: 'per_ton', plannedCapacityTonnes: '5' },
  };
  const partnerBid = {
    id: 'pb-1',
    partnerId: 'partner-1',
    rate: '1600.00',
    status: 'sent',
    truckVerified: null,
    vehicleNumber: null,
    brokerCounterRate: null as string | null,
    brokerCounterSentAt: null as Date | null,
    partner: { id: 'partner-1', name: 'Doon Valley Transport', phone: '9800000000' },
  };
  const loadBid = {
    id: 'bid-1',
    source: 'loadsmart',
    lsPartnerBidId: 'pb-1',
    rate: '1680.00',
    counterRate: '1560.00',
    counterStatus: 'pending',
    counterNote: 'Budget is tight',
    counteredAt: NOW,
  } as unknown as LoadBidEntity;
  const repository = {
    sourcings: { findOneBy: vi.fn(async () => sourcing) },
    findSourcing: vi.fn(async () => sourcing),
    findSourcingByLoad: vi.fn(async () => sourcing),
    updateSourcing: vi.fn(async (_id: string, data: Record<string, unknown>) =>
      Object.assign(sourcing, data),
    ),
    markOtherPartnerBidsLost: vi.fn(async () => undefined),
    partnerBids: {
      find: vi.fn(async () => [partnerBid]),
      findOne: vi.fn(async () => partnerBid),
      findOneBy: vi.fn(async () => partnerBid),
      save: vi.fn(async (row: typeof partnerBid) => Object.assign(partnerBid, row)),
      update: vi.fn(async (_where: unknown, data: Record<string, unknown>) => {
        Object.assign(partnerBid, data);
      }),
    },
    partnerBidResponses: {
      create: vi.fn((row: unknown) => row),
      save: vi.fn(async (row: unknown) => row),
    },
  } as unknown as LoadsmartRepository;
  const bidService = {
    listLiveLoadsmartBids: vi.fn(async () => [loadBid, ...otherLiveBids]),
    findBid: vi.fn(async () => loadBid),
    answerCounter: vi.fn(async () => ({ rate: loadBid.counterRate })),
    recordLoadsmartBid: vi.fn(async () => ({ id: 'bid-new' })),
  } as unknown as LoadBidService;
  const activity = { record: vi.fn(async () => undefined) } as unknown as LoadActivityService;
  const audit = { log: vi.fn(async () => undefined) } as unknown as AuditService;
  const n = null as never;
  const service = new LsSourcingService(
    repository,
    activity,
    audit,
    n,
    n,
    bidService,
    n,
    n,
    n,
    n,
    () => NOW,
  );
  return { service, sourcing, partnerBid, loadBid, bidService, repository };
}

describe("the shipper's counter on Loadsmart's bid", () => {
  it('shows Placement the counter as trip totals, with the broker offered it less the margin', async () => {
    const { service, sourcing } = setup();
    const [view] = await service.shipperCounters(sourcing as never);
    expect(view).toMatchObject({
      bidId: 'bid-1',
      partnerBidId: 'pb-1',
      rate: 7800,
      bidPrice: 8400,
      brokerRate: 8000,
      suggestedBrokerRate: 7410,
      broker: { name: 'Doon Valley Transport' },
      sentToBroker: null,
    });
  });

  it("takes the counter to that bid's broker at ₹7,410, kept on their bid until answered", async () => {
    const { service, repository } = setup();
    const view = await service.counterToBroker('user-1', 'sourcing-1', { bidId: 'bid-1' });
    expect(view.sentToBroker).toEqual({ rate: 7410, at: NOW.toISOString() });
    expect(repository.partnerBids.update).toHaveBeenCalledWith(
      { id: 'pb-1' },
      { brokerCounterRate: '7410', brokerCounterSentAt: NOW, brokerCounterSentBy: 'user-1' },
    );
  });

  it('never offers the broker the counter itself or more', async () => {
    const { service } = setup();
    await expect(
      service.counterToBroker('user-1', 'sourcing-1', { bidId: 'bid-1', rate: 7800 }),
    ).rejects.toThrow(/less than the shipper's counter/);
  });

  it("can't accept the counter while the broker is still at ₹8,000 — Loadsmart would lose", async () => {
    const { service } = setup();
    await expect(
      service.answerShipperCounter('user-1', 'load-1', 'bid-1', { accepted: true }),
    ).rejects.toThrow(/no margin/);
  });

  it('accepts once the broker agreed to ₹7,410: their bid moves to it, and the offer clears', async () => {
    const { service, partnerBid, bidService } = setup();
    partnerBid.brokerCounterRate = '7410';
    await service.answerShipperCounter('user-1', 'load-1', 'bid-1', {
      accepted: true,
      brokerRate: 7410,
    });
    expect(bidService.answerCounter).toHaveBeenCalled();
    expect(partnerBid.rate).toBe('1482');
    expect(partnerBid.brokerCounterRate).toBeNull();
  });
});

describe('several Loadsmart bids with the shipper', () => {
  it('sending a broker bid leaves the other sent bids alone', async () => {
    const { service, repository } = setup();
    (repository.partnerBids.findOne as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      id: 'pb-2',
      rate: '1700.00',
      status: 'received',
      truckVerified: null,
      vehicleNumber: null,
      partner: { name: 'Gill Goods Carriers' },
    });
    await service.sendBid('user-1', 'sourcing-1', { partnerBidId: 'pb-2' });
    const updates = (repository.partnerBids.update as ReturnType<typeof vi.fn>).mock.calls;
    expect(updates).toEqual([[{ id: 'pb-2' }, expect.objectContaining({ status: 'sent' })]]);
  });

  it('sends several at once, and one that fails does not stop the others', async () => {
    const { service } = setup();
    const send = vi
      .spyOn(service, 'sendBid')
      .mockResolvedValueOnce({ id: 'bid-a' } as LoadBidEntity)
      .mockRejectedValueOnce(new Error('Gill Goods Carriers: no margin'))
      .mockResolvedValueOnce({ id: 'bid-c' } as LoadBidEntity);
    const result = await service.sendBids('user-1', 'sourcing-1', [
      { partnerBidId: 'pb-a' },
      { partnerBidId: 'pb-b' },
      { partnerBidId: 'pb-c' },
    ]);
    expect(send).toHaveBeenCalledTimes(3);
    expect(result.sent.map((row) => row.bidId)).toEqual(['bid-a', 'bid-c']);
    expect(result.failed).toEqual([
      { partnerBidId: 'pb-b', reason: 'Gill Goods Carriers: no margin' },
    ]);
  });

  it('a rejected bid frees only its broker bid; the load stays with the shipper while others are live', async () => {
    const { service, repository, loadBid } = setup([{ id: 'bid-2' }]);
    await service.onLoadsmartBidRejected(loadBid, { id: 'load-1' } as LoadEntity);
    expect(repository.partnerBids.update).toHaveBeenCalledWith(
      { id: 'pb-1', status: 'sent' },
      expect.objectContaining({ status: 'received' }),
    );
    expect(repository.updateSourcing).not.toHaveBeenCalled();
  });

  it("the shipper's accepted bid sets Loadsmart's price and margin on the win", async () => {
    const { service, repository, loadBid } = setup();
    await service.onLoadsmartBidAccepted(loadBid, { id: 'load-1' } as LoadEntity, 'user-9');
    expect(repository.updateSourcing).toHaveBeenCalledWith(
      'sourcing-1',
      expect.objectContaining({
        status: 'won',
        partnerRate: '1600.00',
        shipperPrice: '1680.00',
        effectiveMarginPercent: '5',
      }),
    );
  });
});
