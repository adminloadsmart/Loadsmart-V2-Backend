import { describe, expect, it, vi } from 'vitest';
import type { AuditService } from '../../audit/audit.service';
import type { TransporterService } from '../../masters/transporter/transporter.service';
import type { LoadEventNotifier } from '../../notifications/notifications.interface';
import type { LoadEntity } from '../entities/load.entity';
import type { LoadActivityService } from '../activity/load-activity.service';
import type { LoadStageService } from '../core/load-stage.service';
import type { LoadRepository } from '../core/load.repository';
import type { LoadVerificationService } from '../verification/load-verification.service';
import type { LoadBidEntity } from './load-bid.entity';
import type { LoadBidRepository } from './load-bid.repository';
import { LoadBidService } from './load-bid.service';

const NOW = new Date('2026-10-27T10:00:00Z');

const load = {
  id: 'load-1',
  tenantId: 'tenant-1',
  status: 'bids_received',
  postingType: 'market_fleet',
  route: null,
  awardedParty: null,
  awardedBidId: null,
  freightType: 'flat',
  postingId: null,
  createdAt: new Date('2026-10-27T09:00:00Z'),
} as unknown as LoadEntity;

const bid = {
  id: 'bid-1',
  loadId: 'load-1',
  source: 'transporter',
  status: 'received',
  rate: '40000',
  vehicleNumber: 'MH12AB1234',
  truckVerified: true,
  transporterId: 'transporter-1',
  expiresAt: new Date('2026-10-27T13:00:00Z'),
  createdAt: new Date('2026-10-27T09:30:00Z'),
} as unknown as LoadBidEntity;

function setup(onLoadEvent?: LoadEventNotifier, current: LoadEntity = load) {
  const awarded = {
    ...current,
    route: 'own_transporter',
    awardedParty: 'transporter',
    awardedBidId: 'bid-1',
  } as LoadEntity;
  const bidRepository = {
    findById: vi.fn(async () => bid),
    accept: vi.fn(async () => undefined),
    rejectOthers: vi.fn(async () => undefined),
    markExpired: vi.fn(async () => undefined),
  };
  const loadRepository = {
    findById: vi.fn(async () => current),
    findActiveByVehicleNumber: vi.fn(async () => null),
  } as unknown as LoadRepository;
  const stageService = {
    transition: vi.fn(async () => awarded),
  } as unknown as LoadStageService;
  const service = new LoadBidService(
    bidRepository as unknown as LoadBidRepository,
    loadRepository,
    {} as TransporterService,
    stageService,
    { record: vi.fn(async () => undefined) } as unknown as LoadActivityService,
    {} as AuditService,
    {} as LoadVerificationService,
    {},
    onLoadEvent,
    () => NOW,
  );
  return { service, stageService, awarded, bidRepository };
}

describe('Accepting a bid (LS_N_0016)', () => {
  it('awards the transporter at Bids received, rejects the other bids and queues the event', async () => {
    const onLoadEvent = vi.fn(async () => undefined);
    const { service, stageService, awarded, bidRepository } = setup(onLoadEvent);

    const result = await service.acceptBid('tenant-1', 'user-1', 'load-1', 'bid-1');

    expect(result).toBe(awarded);
    expect(stageService.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'transporter_awarded',
        loadId: 'load-1',
        fields: expect.objectContaining({ awardedBidId: 'bid-1', transporterId: 'transporter-1' }),
      }),
    );
    expect(bidRepository.rejectOthers).toHaveBeenCalledWith(
      'tenant-1',
      'load-1',
      'bid-1',
      'user-1',
    );
    expect(onLoadEvent).toHaveBeenCalledWith({
      kind: 'assigned',
      tenantId: 'tenant-1',
      loadId: 'load-1',
      at: NOW,
      vehicleChecked: false,
      driverChecked: false,
    });
  });

  it('still accepts the bid when no notifier is wired', async () => {
    const { service, awarded } = setup();
    await expect(service.acceptBid('tenant-1', 'user-1', 'load-1', 'bid-1')).resolves.toBe(awarded);
  });

  it('accepts only one bid per load', async () => {
    const { service, stageService } = setup(undefined, {
      ...load,
      awardedBidId: 'other-bid',
    } as LoadEntity);
    await expect(service.acceptBid('tenant-1', 'user-1', 'load-1', 'bid-1')).rejects.toThrow(
      'already accepted',
    );
    expect(stageService.transition).not.toHaveBeenCalled();
  });
});

describe('Indent rejected', () => {
  const indent = {
    ...load,
    status: 'created',
    postingType: 'indent',
    postingId: 'posting-1',
    transporterId: 'contracted-1',
    freightValue: '38000',
    expectedRate: null,
  } as unknown as LoadEntity;

  function setupIndent(current: LoadEntity = indent) {
    const moved = { ...current, postingType: 'market_fleet', transporterId: null } as LoadEntity;
    const bidRepository = {
      findPosting: vi.fn(async () => ({ contractId: 'contract-1' })),
      findContractPenalty: vi.fn(async () => '5000.00'),
      recordRouteChange: vi.fn(async () => undefined),
      addTransporterRecipients: vi.fn(async () => 4),
      findTransporterRecipient: vi.fn(async () => ({ id: 'recipient-1', replyStatus: null })),
      recordRecipientReply: vi.fn(async () => undefined),
    };
    const stageService = { transition: vi.fn(async () => moved) };
    const hooks = { onMarketLoadsPosted: vi.fn(async () => undefined) };
    const activity = { record: vi.fn(async () => undefined) };
    const service = new LoadBidService(
      bidRepository as unknown as LoadBidRepository,
      { findById: vi.fn(async () => current) } as unknown as LoadRepository,
      {} as TransporterService,
      stageService as unknown as LoadStageService,
      activity as unknown as LoadActivityService,
      {} as AuditService,
      {} as LoadVerificationService,
      hooks,
      undefined,
      () => NOW,
    );
    return { service, bidRepository, stageService, hooks, moved, activity };
  }

  it('sends the load to the open market with the penalty, Loadsmart included', async () => {
    const { service, bidRepository, stageService, hooks, moved } = setupIndent();

    const result = await service.recordIndentRejection(
      'tenant-1',
      'user-1',
      'load-1',
      'contracted-1',
      'No truck',
    );

    expect(result).toBe(moved);
    expect(stageService.transition).toHaveBeenCalledWith(
      expect.objectContaining({
        trigger: 'indent_rejected',
        fields: { transporterId: null, freightValue: null, expectedRate: '38000' },
      }),
    );
    expect(bidRepository.recordRouteChange).toHaveBeenCalledWith(
      expect.objectContaining({
        fromPostingType: 'indent',
        toPostingType: 'market_fleet',
        reason: 'No truck',
        contractId: 'contract-1',
        transporterId: 'contracted-1',
        penaltyAmount: '5000.00',
      }),
    );
    expect(bidRepository.addTransporterRecipients).toHaveBeenCalledWith('tenant-1', 'posting-1');
    expect(bidRepository.recordRecipientReply).toHaveBeenCalledWith('recipient-1', 'rejected', NOW);
    expect(hooks.onMarketLoadsPosted).toHaveBeenCalledWith([moved], 'user-1');
  });

  it('refuses once the indent was accepted, or on a market load', async () => {
    await expect(
      setupIndent({
        ...indent,
        status: 'bids_received',
      } as LoadEntity).service.recordIndentRejection(
        'tenant-1',
        'user-1',
        'load-1',
        'contracted-1',
        'x',
      ),
    ).rejects.toThrow('already accepted');
    await expect(
      setupIndent(load).service.recordIndentRejection(
        'tenant-1',
        'user-1',
        'load-1',
        'contracted-1',
        'x',
      ),
    ).rejects.toThrow('not an indent');
  });

  it('refuses a transporter the indent was not offered to', async () => {
    const { service, stageService } = setupIndent();
    await expect(
      service.recordIndentRejection('tenant-1', 'user-1', 'load-1', 'someone-else', 'x'),
    ).rejects.toThrow("wasn't sent to that transporter");
    expect(stageService.transition).not.toHaveBeenCalled();
  });
});

describe('LoadBidService.recordWhatsappBid', () => {
  const marketLoad = {
    ...load,
    status: 'created',
    postingType: 'market_fleet',
    postingId: 'posting-1',
    code: 'LOAD-0042',
  } as unknown as LoadEntity;

  function whatsappSetup(options: { postedAt: Date; live?: LoadBidEntity | null }) {
    const created: unknown[] = [];
    const updated: unknown[] = [];
    const bidRepository = {
      findPosting: vi.fn(async () => ({ createdAt: options.postedAt })),
      findTransporterRecipient: vi.fn(async () => ({ id: 'recipient-1' })),
      findLive: vi.fn(async () => options.live ?? null),
      create: vi.fn(async (data: Record<string, unknown>) => {
        created.push(data);
        return {
          ...bid,
          ...data,
          id: 'bid-new',
          truckVerified: null,
          createdAt: NOW,
        } as unknown as LoadBidEntity;
      }),
      update: vi.fn(async (current: LoadBidEntity, data: Record<string, unknown>) => {
        updated.push(data);
        return { ...current, ...data, truckVerified: true } as unknown as LoadBidEntity;
      }),
    } as unknown as LoadBidRepository;
    const service = new LoadBidService(
      bidRepository,
      {
        findById: vi.fn(async () => marketLoad),
        findActiveByVehicleNumber: vi.fn(async () => null),
      } as unknown as LoadRepository,
      {} as TransporterService,
      { transition: vi.fn(async () => marketLoad) } as unknown as LoadStageService,
      { record: vi.fn(async () => undefined) } as unknown as LoadActivityService,
      { log: vi.fn(async () => undefined) } as unknown as AuditService,
      {} as LoadVerificationService,
      {},
      undefined,
      () => NOW,
    );
    return { service, created, updated };
  }

  it('records a WhatsApp rate at once — no 30-minute wait — with channel whatsapp and no user', async () => {
    const { service, created } = whatsappSetup({
      postedAt: new Date(NOW.getTime() - 10 * 60 * 1000),
    });
    const view = await service.recordWhatsappBid('tenant-1', 'load-1', {
      transporterId: 'transporter-1',
      rate: 42000,
    });
    expect(created[0]).toMatchObject({
      channel: 'whatsapp',
      enteredBy: null,
      rate: '42000',
      recipientId: 'recipient-1',
      vehicleNumber: null,
    });
    expect(view.channel).toBe('whatsapp');
  });

  it('refuses once the 4-hour window has closed', async () => {
    const { service } = whatsappSetup({ postedAt: new Date(NOW.getTime() - 5 * 60 * 60 * 1000) });
    await expect(
      service.recordWhatsappBid('tenant-1', 'load-1', {
        transporterId: 'transporter-1',
        rate: 42000,
      }),
    ).rejects.toThrow(/closed/);
  });

  it('a new WhatsApp rate revises the live bid', async () => {
    const live = { ...bid, rate: '40000' } as unknown as LoadBidEntity;
    const { service, updated, created } = whatsappSetup({
      postedAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      live,
    });
    await service.recordWhatsappBid('tenant-1', 'load-1', {
      transporterId: 'transporter-1',
      rate: 38000,
    });
    expect(updated[0]).toMatchObject({
      rate: '38000',
      rateHistory: [expect.objectContaining({ by: null, kind: 'revised', rate: '38000' })],
    });
    expect(created).toEqual([]);
  });
});

describe('Extending the bid window', () => {
  const SENT = new Date('2026-10-27T07:00:00Z'); // 3 h before NOW

  function extendSetup(current: Partial<LoadEntity> = {}, extraMinutes = 0, sent = SENT) {
    const marketLoad = {
      ...load,
      status: 'created',
      postingId: 'posting-1',
      ...current,
    } as LoadEntity;
    const posting = {
      id: 'posting-1',
      createdAt: sent,
      bidWindowExtraMinutes: extraMinutes,
    };
    const bidRepository = {
      findPosting: vi.fn(async () => posting),
      setBidWindowExtraMinutes: vi.fn(async (_t: string, _p: string, minutes: number) => {
        posting.bidWindowExtraMinutes = minutes;
      }),
      listByLoad: vi.fn(async () => []),
      markExpired: vi.fn(async () => undefined),
    };
    const audit = { log: vi.fn(async () => undefined) };
    const service = new LoadBidService(
      bidRepository as unknown as LoadBidRepository,
      { findById: vi.fn(async () => marketLoad) } as unknown as LoadRepository,
      {} as TransporterService,
      {} as LoadStageService,
      { record: vi.fn(async () => undefined) } as unknown as LoadActivityService,
      audit as unknown as AuditService,
      {} as LoadVerificationService,
      {},
      undefined,
      () => NOW,
    );
    return { service, bidRepository, audit };
  }

  it('restarts the window at 4 hours from now and logs it', async () => {
    const { service, bidRepository, audit } = extendSetup();
    const view = await service.extendBidWindow('tenant-1', 'user-1', 'load-1');

    expect(bidRepository.setBidWindowExtraMinutes).toHaveBeenCalledWith(
      'tenant-1',
      'posting-1',
      180,
    );
    expect(view.biddingClosesAt).toBe('2026-10-27T14:00:00.000Z');
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'LOAD_BID_WINDOW_EXTENDED',
        newData: expect.objectContaining({
          closedAt: '2026-10-27T11:00:00.000Z',
          closesAt: '2026-10-27T14:00:00.000Z',
        }),
      }),
    );
  });

  it('reopens a window that already closed', async () => {
    // Sent 6 h ago: its 4 h window closed 2 h ago.
    const { service } = extendSetup({}, 0, new Date('2026-10-27T04:00:00Z'));
    const view = await service.extendBidWindow('tenant-1', 'user-1', 'load-1');
    expect(new Date(view.biddingClosesAt!).getTime()).toBe(NOW.getTime() + 4 * 60 * 60 * 1000);
  });

  it('keeps a window Placement already pushed later', async () => {
    const { service, bidRepository } = extendSetup({}, 600);
    const view = await service.extendBidWindow('tenant-1', 'user-1', 'load-1');
    expect(bidRepository.setBidWindowExtraMinutes).toHaveBeenCalledWith(
      'tenant-1',
      'posting-1',
      600,
    );
    expect(view.biddingClosesAt).toBe('2026-10-27T21:00:00.000Z');
  });

  it('refuses an indent, and a load whose bid is accepted', async () => {
    await expect(
      extendSetup({ postingType: 'indent' } as Partial<LoadEntity>).service.extendBidWindow(
        'tenant-1',
        'user-1',
        'load-1',
      ),
    ).rejects.toThrow('Only a market load');
    await expect(
      extendSetup({ status: 'bids_received', awardedBidId: 'bid-1' }).service.extendBidWindow(
        'tenant-1',
        'user-1',
        'load-1',
      ),
    ).rejects.toThrow('bidding is over');
  });
});
