import { describe, expect, it, vi } from 'vitest';
import type { LoadEntity } from '../entities/load.entity';
import type { LoadBidEntity } from './load-bid.entity';
import { LoadBidService } from './load-bid.service';
import { acceptBlocker } from './bid-rules';
import { shipperActionFor, ShipperActionInput } from '../utils/shipper-action';
import {
  MSME_CREDIT_DAYS_CAP,
  settingsInputSchema,
  DEFAULT_SETTINGS,
} from '../../settings/settings.types';
import { TRANSPORTER_CHARGE_HEADS } from '../money/charge.types';

const NOW = new Date('2026-11-17T10:00:00Z');

const load = {
  id: 'load-1',
  tenantId: 't-1',
  status: 'bids_received',
  postingType: 'market_fleet',
  route: null,
  awardedParty: null,
  awardedBidId: null,
} as unknown as LoadEntity;

function setup(source: 'transporter' | 'loadsmart' = 'transporter', current = load) {
  const bid: Record<string, unknown> = {
    id: 'bid-1',
    tenantId: 't-1',
    loadId: 'load-1',
    source,
    status: 'received',
    rate: '40000',
    vehicleNumber: 'MH12AB1234',
    truckVerified: true,
    transporterId: source === 'transporter' ? 'tr-1' : null,
    expiresAt: new Date('2026-11-17T13:00:00Z'),
    createdAt: new Date('2026-11-17T09:30:00Z'),
    counterStatus: null,
    counterRate: null,
    rateHistory: [{ at: '2026-11-17T09:30:00.000Z', by: 'u-1', kind: 'bid', rate: '40000' }],
  };
  const bidRepository = {
    findById: vi.fn(async () => bid as unknown as LoadBidEntity),
    update: vi.fn(async (_bid: unknown, data: Record<string, unknown>) => {
      Object.assign(bid, data);
      return bid as unknown as LoadBidEntity;
    }),
    markRejected: vi.fn(async () => {
      bid.status = 'rejected';
    }),
  };
  const hooks = { countered: vi.fn(async () => undefined), rejected: vi.fn(async () => undefined) };
  const service = new LoadBidService(
    bidRepository as never,
    { findById: vi.fn(async () => current) } as never,
    {} as never,
    {} as never,
    { record: vi.fn(async () => undefined) } as never,
    { log: vi.fn(async () => undefined) } as never,
    {} as never,
    {},
    undefined,
    () => NOW,
  );
  service.setLoadsmartBidEventHooks(hooks);
  return { service, bid, bidRepository, hooks };
}

describe('countering a bid', () => {
  it('waits for the answer — Accept stays off — and an accepted counter becomes the rate', async () => {
    const { service, bid } = setup();
    const countered = await service.counterBid('t-1', 'u-1', 'load-1', 'bid-1', { rate: 37000 });
    expect(countered.counter).toMatchObject({ rate: '37000', status: 'pending' });
    expect(countered.canAccept).toBe(false);
    expect(countered.acceptBlocker).toMatch(/counter of ₹37000/);

    const answered = await service.answerCounter('t-1', 'u-1', 'load-1', 'bid-1', {
      accepted: true,
    });
    expect(answered).toMatchObject({ rate: '37000', canAccept: true });
    expect((bid.rateHistory as { kind: string }[]).map((step) => step.kind)).toEqual([
      'bid',
      'counter',
      'counter_accepted',
    ]);
  });

  it('keeps the bid rate when the counter is declined, and refuses a same-rate counter', async () => {
    const { service } = setup();
    await expect(
      service.counterBid('t-1', 'u-1', 'load-1', 'bid-1', { rate: 40000 }),
    ).rejects.toThrow(/same as the bid/);
    await service.counterBid('t-1', 'u-1', 'load-1', 'bid-1', { rate: 38000 });
    const declined = await service.answerCounter('t-1', 'u-1', 'load-1', 'bid-1', {
      accepted: false,
    });
    expect(declined).toMatchObject({ rate: '40000', counter: { status: 'declined' } });
  });

  it("sends a counter on Loadsmart's bid to Placement, who alone answers it", async () => {
    const { service, hooks } = setup('loadsmart');
    await service.counterBid('t-1', 'u-1', 'load-1', 'bid-1', { rate: 39000 });
    expect(hooks.countered).toHaveBeenCalled();
    await expect(
      service.answerCounter('t-1', 'u-1', 'load-1', 'bid-1', { accepted: true }),
    ).rejects.toThrow(/console/);
    const answered = await service.answerCounter(
      't-1',
      'u-ls',
      'load-1',
      'bid-1',
      { accepted: true },
      true,
    );
    expect(answered.rate).toBe('39000');
  });

  it("rejects a bid with a reason, and tells Placement when it is Loadsmart's", async () => {
    const { service, hooks } = setup('loadsmart');
    const rejected = await service.rejectBid('t-1', 'u-1', 'load-1', 'bid-1', 'Too high');
    expect(rejected).toMatchObject({ status: 'rejected', rejectionReason: 'Too high' });
    expect(hooks.rejected).toHaveBeenCalled();
  });

  it('is refused once a bid is accepted on the load', async () => {
    const { service } = setup('transporter', { ...load, awardedBidId: 'bid-9' } as LoadEntity);
    await expect(service.counterBid('t-1', 'u-1', 'load-1', 'bid-1', { rate: 1 })).rejects.toThrow(
      /before one is accepted/,
    );
  });

  it('blocks accepting while a counter waits', () => {
    const base = {
      id: 'b',
      status: 'received' as const,
      rate: '1',
      vehicleNumber: 'X',
      truckVerified: true,
      expiresAt: null,
      createdAt: NOW,
    };
    expect(acceptBlocker({ ...base, counterStatus: 'pending', counterRate: '900' }, NOW)).toMatch(
      /counter/,
    );
    expect(
      acceptBlocker({ ...base, counterStatus: 'declined', counterRate: '900' }, NOW),
    ).toBeNull();
  });
});

const action = (overrides: Partial<ShipperActionInput>): ShipperActionInput => ({
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
  transporterInvoiceFileKey: null,
  advancePercentage: '70',
  advancePaidAt: null,
  balancePaidAt: null,
  deliveryIssueSettledAt: null,
  pendingCharges: { count: 0, total: 0 },
  invoiceOpen: null,
  paymentPendingMatch: false,
  memoWaiting: false,
  ...overrides,
});

describe("the shipper's next action", () => {
  it('matches the flow screens', () => {
    expect(shipperActionFor(action({ status: 'bids_received' })).kind).toBe('pick_bid');
    expect(shipperActionFor(action({ status: 'reached_loading', route: 'loadsmart' })).kind).toBe(
      'send_invoice',
    );
    expect(shipperActionFor(action({ status: 'reached_loading', route: 'own_fleet' })).kind).toBe(
      'loading_papers',
    );
    expect(
      shipperActionFor(
        action({ status: 'loaded', route: 'loadsmart', pendingCharges: { count: 5, total: 4850 } }),
      ),
    ).toEqual({ kind: 'approve_charges', count: 5, amount: 4850 });
    expect(shipperActionFor(action({ status: 'loaded', route: 'own_transporter' })).kind).toBe(
      'record_advance',
    );
    expect(
      shipperActionFor(action({ status: 'reached_unloading', route: 'indent', advancePaidAt: NOW }))
        .kind,
    ).toBe('upload_pod');
    // The front alone is a POD (the back is optional) — e.g. a driver-app upload.
    expect(
      shipperActionFor(
        action({
          status: 'reached_unloading',
          route: 'indent',
          advancePaidAt: NOW,
          podFileKey: 'pod-front.jpg',
        }),
      ).kind,
    ).not.toBe('upload_pod');
    expect(
      shipperActionFor(
        action({ status: 'delivered_ok', route: 'own_transporter', advancePaidAt: NOW }),
      ).kind,
    ).toBe('upload_transporter_invoice');
    expect(
      shipperActionFor(
        action({ status: 'invoice_generated', route: 'own_transporter', advancePaidAt: NOW }),
      ).kind,
    ).toBe('record_balance');
    expect(
      shipperActionFor(
        action({ status: 'invoice_generated', route: 'loadsmart', invoiceOpen: 58400 }),
      ),
    ).toEqual({ kind: 'pay_invoice', amount: 58400 });
    expect(
      shipperActionFor(
        action({
          status: 'payment',
          route: 'loadsmart',
          invoiceOpen: 58400,
          paymentPendingMatch: true,
        }),
      ).kind,
    ).toBe('none');
    expect(
      shipperActionFor(action({ status: 'in_transit_unloading', route: 'loadsmart' })).kind,
    ).toBe('none');
  });
});

describe('settings and charge heads after the Figma review', () => {
  it('caps shipper credit at 45 days', () => {
    expect(MSME_CREDIT_DAYS_CAP).toBe(45);
    expect(
      settingsInputSchema.safeParse({ ...DEFAULT_SETTINGS, maxShipperCreditDays: 45 }).success,
    ).toBe(true);
    expect(
      settingsInputSchema.safeParse({ ...DEFAULT_SETTINGS, maxShipperCreditDays: 46 }).success,
    ).toBe(false);
  });

  it('has toll/gate as a charge head', () => {
    expect(TRANSPORTER_CHARGE_HEADS).toContain('toll');
  });
});
