import { describe, expect, it } from 'vitest';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import { InboundResolution } from '../messaging.types';
import { RecipientLoadContext } from '../router/reply-router.ports';
import { ShipperReplyActions } from './shipper-reply-actions';
import { storedPhoneVariantsOf } from './phone-variants';
import {
  LiveLoadsmartBid,
  MemoGateway,
  ShipperBidGateway,
  ShipperLoad,
  ShipperLoadStore,
  ShipperUser,
} from './load-notices.interface';

const USER: ShipperUser = { id: 'user-1', tenantId: 'tenant-1' };
const LOAD: ShipperLoad = {
  tenantId: 'tenant-1',
  loadId: 'load-1',
  loadCode: 'LD-1001',
  vehicleNumber: 'PB10AB1234',
  driverName: 'Ramesh',
};
const CONTEXT: RecipientLoadContext = {
  tenantId: 'tenant-1',
  loadId: 'load-1',
  loadRef: 'LD-1001',
  recipientKind: 'shipper_user',
  recipientRefId: 'user-1',
  messageLogId: 'log-1',
};
const inbound = {} as WhatsappInboundEntity;

interface SetupOptions {
  memoStatus?: string | null;
  bid?: LiveLoadsmartBid | null;
  latestAnswer?: InboundResolution | null;
  failWith?: Error;
}

function setup({
  memoStatus = 'sent',
  bid = null,
  latestAnswer = null,
  failWith,
}: SetupOptions = {}) {
  const calls: unknown[][] = [];
  const store: ShipperLoadStore = {
    findUser: async (id) => (id === USER.id ? USER : null),
    findUsersByPhone: async (phones) => (phones.includes('9876500004') ? [USER] : []),
    findLoadsAwaitingMemo: async () => (bid ? [] : [LOAD]),
    findLoadsWithLoadsmartBid: async () => (bid ? [LOAD] : []),
    findLoad: async () => LOAD,
    findLiveLoadsmartBid: async () => bid,
    latestAnswer: async () => latestAnswer,
  };
  const record =
    (name: string) =>
    async (...args: unknown[]) => {
      if (failWith) throw failWith;
      calls.push([name, ...args]);
      return {};
    };
  const memos: MemoGateway = {
    getCurrent: async () => {
      if (memoStatus === null) throw new NotFoundError('no memo');
      return { status: memoStatus, vehicleNumber: 'PB10AB1234' };
    },
    accept: record('acceptMemo'),
  };
  const bids: ShipperBidGateway = {
    acceptBid: record('acceptBid'),
    counterBid: record('counterBid'),
    rejectBid: record('rejectBid'),
  };
  return { actions: new ShipperReplyActions(store, memos, bids), calls };
}

const LS_BID: LiveLoadsmartBid = { id: 'bid-ls', rate: '47500.00' };

describe("ShipperReplyActions — Loadsmart's bid (LS_N_0067)", () => {
  it('Accept accepts the bid as the user who posted the load', async () => {
    const { actions, calls } = setup({ bid: LS_BID });
    const outcome = await actions.applyOfferAction(CONTEXT, 'accept', inbound);
    expect(calls).toEqual([['acceptBid', 'tenant-1', 'user-1', 'load-1', 'bid-ls']]);
    expect(outcome).toMatchObject({
      resolution: 'accepted',
      confirmationText: 'LD-1001: Done. Truck details will follow.',
    });
  });

  it('Counter asks for the price; the typed price counters the bid', async () => {
    const { actions, calls } = setup({ bid: LS_BID, latestAnswer: 'negotiating' });
    expect(await actions.applyOfferAction(CONTEXT, 'negotiate', inbound)).toEqual({
      resolution: 'negotiating',
      nextPrompt: 'price_request',
    });
    expect(await actions.stageOf(CONTEXT)).toBe('awaiting_rate');
    const outcome = await actions.applyRate(CONTEXT, 45000, null, inbound);
    expect(calls).toEqual([
      ['counterBid', 'tenant-1', 'user-1', 'load-1', 'bid-ls', { rate: 45000 }],
    ]);
    expect(outcome).toMatchObject({
      resolution: 'bid_recorded',
      confirmationText: "LD-1001: ₹45,000 noted. Got it. We'll come back to you.",
    });
  });

  it('Reject rejects the bid: "Noted. We\'ll come back with a better bid."', async () => {
    const { actions, calls } = setup({ bid: LS_BID });
    const outcome = await actions.applyOfferAction(CONTEXT, 'reject', inbound);
    expect(calls).toEqual([['rejectBid', 'tenant-1', 'user-1', 'load-1', 'bid-ls']]);
    expect(outcome.confirmationText).toBe("LD-1001: Noted. We'll come back with a better bid.");
  });

  it("the bid service's refusal comes back as late, not an error", async () => {
    const { actions } = setup({
      bid: LS_BID,
      failWith: new ConflictError('Bidding on this load has closed'),
    });
    expect(await actions.applyOfferAction(CONTEXT, 'accept', inbound)).toMatchObject({
      resolution: 'late',
      note: 'Bidding on this load has closed',
    });
  });

  it('the load is open to the sender while the bid is live', async () => {
    const { actions } = setup({ bid: LS_BID });
    expect(await actions.findOpenLoadsForSender({ phone: '919876500004', userId: null })).toEqual([
      expect.objectContaining({
        loadRef: 'LD-1001',
        recipientKind: 'shipper_user',
        stage: 'offered',
      }),
    ]);
  });
});

describe('ShipperReplyActions — the load memo (LS_N_0069)', () => {
  it('matches the sender to the user by their 10-digit number', () => {
    expect(storedPhoneVariantsOf('919876500004')).toEqual(['9876500004', '919876500004']);
  });

  it('Accept memo accepts the memo as the user who posted the load', async () => {
    const { actions, calls } = setup();
    const outcome = await actions.applyOfferAction(CONTEXT, 'accept', inbound);
    expect(calls).toEqual([['acceptMemo', 'tenant-1', 'user-1', 'load-1', {}]]);
    expect(outcome).toMatchObject({
      resolution: 'accepted',
      confirmationText: 'LD-1001: Confirmed. Truck PB10AB1234 is on its way.',
    });
  });

  it('an expired memo is not accepted: "This memo has expired"', async () => {
    const { actions, calls } = setup({ memoStatus: 'expired' });
    const outcome = await actions.applyOfferAction(CONTEXT, 'accept', inbound);
    expect(calls).toHaveLength(0);
    expect(outcome).toMatchObject({
      resolution: 'late',
      confirmationText: "LD-1001: This memo has expired. We'll send a new one.",
    });
  });

  it('no memo → closed; a price with no live bid, or Reject on a memo, goes to review', async () => {
    expect(await setup({ memoStatus: null }).actions.stageOf(CONTEXT)).toBe('closed');
    const { actions } = setup();
    expect((await actions.applyRate(CONTEXT, 45000, null, inbound)).resolution).toBe(
      'needs_review',
    );
    expect((await actions.applyOfferAction(CONTEXT, 'reject', inbound)).resolution).toBe(
      'needs_review',
    );
  });
});
