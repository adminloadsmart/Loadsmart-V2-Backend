import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../../../shared/errors';
import { LoadBoardOffer } from '../../loadsmart-ops/loadsmart.interface';
import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import { InboundResolution } from '../messaging.types';
import { OutboundResult } from '../outbound/outbound-message.service';
import { RecipientLoadContext, ReplyActions } from '../router/reply-router.ports';
import { CompositeReplyActions } from './composite-reply-actions';
import { PartnerBoardNotifier } from './partner-board-notifier';
import { PartnerBoardGateway, PartnerReplyActions, partnerStage } from './partner-reply-actions';

const inbound = {} as WhatsappInboundEntity;
const boardLoad = (overrides: Partial<LoadBoardOffer> = {}): LoadBoardOffer => ({
  sourcingId: 'sourcing-1',
  tenantId: 'tenant-1',
  loadId: 'load-1',
  loadCode: 'LOAD-0042',
  partnerRate: '42000.00',
  pickupLabel: 'Gurugram',
  dropLabel: 'Ludhiana',
  truckLabel: '24 ft',
  weightTonnes: '18.00',
  pickupAt: new Date(Date.UTC(2026, 10, 15, 4, 30)),
  partners: [
    { id: 'partner-A', name: 'A', phone: '9876543210' },
    { id: 'partner-B', name: 'B', phone: '9876543211' },
  ],
  ...overrides,
});

class FakeBoard implements PartnerBoardGateway {
  partners = [{ id: 'partner-A' }];
  loads: LoadBoardOffer[] = [boardLoad()];
  live = new Map<string, { vehicleNumber: string | null }>();
  calls: string[] = [];
  failWith: Error | null = null;
  async findActivePartnersByPhones(phones: string[]) {
    return phones.includes('9876543210') ? this.partners : [];
  }
  async openBoardLoads() {
    return this.loads;
  }
  async findLivePartnerBid(sourcingId: string, partnerId: string) {
    return this.live.get(`${sourcingId}|${partnerId}`) ?? null;
  }
  async recordPartnerBidFromWhatsapp(
    sourcingId: string,
    input: { partnerId: string; rate?: number; vehicleNumber?: string },
  ) {
    if (this.failWith) throw this.failWith;
    this.calls.push(
      `${sourcingId} ${input.partnerId} rate=${input.rate ?? '-'} truck=${input.vehicleNumber ?? '-'}`,
    );
    const key = `${sourcingId}|${input.partnerId}`;
    this.live.set(key, {
      vehicleNumber: input.vehicleNumber ?? this.live.get(key)?.vehicleNumber ?? null,
    });
  }
}

let board: FakeBoard;
let answers: Map<string, InboundResolution>;
let actions: PartnerReplyActions;
const context: RecipientLoadContext = {
  tenantId: 'tenant-1',
  loadId: 'load-1',
  loadRef: 'LOAD-0042',
  recipientKind: 'partner',
  recipientRefId: 'partner-A',
  messageLogId: null,
};

beforeEach(() => {
  board = new FakeBoard();
  answers = new Map();
  actions = new PartnerReplyActions(board, {
    latestOfferAnswer: async (loadId, partnerId) => answers.get(`${loadId}|${partnerId}`) ?? null,
  });
});

describe('partnerStage', () => {
  it('follows bids and the last answer', () => {
    expect(partnerStage(null, null)).toBe('offered');
    expect(partnerStage(null, 'negotiating')).toBe('awaiting_rate');
    expect(partnerStage(null, 'rejected')).toBe('closed');
    expect(partnerStage({ vehicleNumber: null }, 'accepted')).toBe('awaiting_truck');
    expect(partnerStage({ vehicleNumber: 'PB10AB1234' }, null)).toBe('offered');
  });
});

describe('PartnerReplyActions', () => {
  it('lists board loads for a partner phone (91-prefixed sender)', async () => {
    const open = await actions.findOpenLoadsForSender({ phone: '919876543210', userId: null });
    expect(open).toEqual([
      expect.objectContaining({
        recipientKind: 'partner',
        recipientRefId: 'partner-A',
        loadRef: 'LOAD-0042',
        stage: 'offered',
        laneLabel: 'Gurugram → Ludhiana · 24 ft',
      }),
    ]);
    expect(await actions.findOpenLoadsForSender({ phone: '919000000000', userId: null })).toEqual(
      [],
    );
  });

  it('Accept = partner bid at the board rate, then "Send the truck number"; the truck keeps that rate', async () => {
    const outcome = await actions.applyOfferAction(context, 'accept', inbound);
    expect(outcome).toMatchObject({
      resolution: 'accepted',
      confirmationText: 'LOAD-0042: Done. Send the truck number if you have it.',
    });
    expect(await actions.stageOf(context)).toBe('awaiting_truck');
    await actions.applyTruck(context, 'PB10AB1234', inbound);
    expect(board.calls).toEqual([
      'sourcing-1 partner-A rate=42000 truck=-',
      'sourcing-1 partner-A rate=- truck=PB10AB1234',
    ]);
    expect(await actions.applyDispatch()).toMatchObject({ resolution: 'needs_review' });
  });

  it('Reject: "Okay. We\'ll send you the next load."', async () => {
    expect((await actions.applyOfferAction(context, 'reject', inbound)).confirmationText).toBe(
      "LOAD-0042: Okay. We'll send you the next load.",
    );
  });

  it('a rate becomes a partner bid; a broken rule goes to review', async () => {
    expect(await actions.applyRate(context, 39000, 'HR26AB4321', inbound)).toMatchObject({
      resolution: 'bid_recorded',
    });
    expect(board.calls).toEqual(['sourcing-1 partner-A rate=39000 truck=HR26AB4321']);
    board.failWith = new ConflictError('This load is not on the load board');
    expect(await actions.applyRate(context, 38000, null, inbound)).toMatchObject({
      resolution: 'needs_review',
      note: 'This load is not on the load board',
    });
  });

  it('a load off the board is late; a load code shared by two shippers is not guessed', async () => {
    board.loads = [];
    expect(await actions.applyOfferAction(context, 'accept', inbound)).toMatchObject({
      resolution: 'late',
    });
    board.loads = [
      boardLoad(),
      boardLoad({ sourcingId: 'sourcing-2', tenantId: 'tenant-2', loadId: 'load-9' }),
    ];
    expect(await actions.stageOf({ ...context, loadId: null })).toBe('closed');
  });
});

describe('CompositeReplyActions', () => {
  it('unions open loads across kinds and routes by recipient kind', async () => {
    const transporter = {
      findOpenLoadsForSender: async () => [
        {
          ...context,
          recipientKind: 'transporter',
          recipientRefId: 'recipient-1',
          loadRef: 'LOAD-0001',
          stage: 'offered',
          laneLabel: 'x',
        },
      ],
      stageOf: async () => 'awaiting_rate',
    } as unknown as ReplyActions;
    const composite = new CompositeReplyActions({ transporter, partner: actions });
    const open = await composite.findOpenLoadsForSender({ phone: '919876543210', userId: null });
    expect(open.map((load) => `${load.recipientKind}:${load.loadRef}`)).toEqual([
      'transporter:LOAD-0001',
      'partner:LOAD-0042',
    ]);
    expect(await composite.stageOf({ ...context, recipientKind: 'transporter' })).toBe(
      'awaiting_rate',
    );
    expect(await composite.stageOf({ ...context, recipientKind: 'driver' })).toBe('closed');
  });
});

describe('PartnerBoardNotifier', () => {
  it('sends the board load to the partners on its lane, by rate or as a quote request', async () => {
    const sent: { templateKey: string; refId: string | null; variables: Record<string, string> }[] =
      [];
    const notifier = new PartnerBoardNotifier({
      sendOffer: async (request) => {
        sent.push({
          templateKey: request.templateKey,
          refId: request.recipient.refId,
          variables: request.variables,
        });
        return { messageLogId: 'log', status: 'queued' } as OutboundResult;
      },
    });
    await notifier.postedToBoard(boardLoad());
    expect(sent.map((item) => `${item.templateKey}:${item.refId}`)).toEqual([
      'LS_N_0105:partner-A',
      'LS_N_0105:partner-B',
    ]);
    // Catalog LS_N_0105: area, truck, weight, reporting time and rate — never the shipper's name.
    expect(sent[0].variables).toEqual({
      from_area: 'Gurugram',
      to_area: 'Ludhiana',
      truck_type: '24 ft',
      weight: '18',
      reporting_time: expect.any(String),
      rate: '42,000',
    });
    await notifier.postedToBoard(boardLoad({ partnerRate: null }));
    expect(sent[2].templateKey).toBe('LS_N_0106');
    // No partner on the lane: nothing goes out.
    await notifier.postedToBoard(boardLoad({ partners: [] }));
    expect(sent).toHaveLength(4);
  });
});
