import { beforeEach, describe, expect, it } from 'vitest';
import { ConflictError } from '../../../shared/errors';
import { WhatsappBidInput } from '../../loads/utils/load-bid.interface';
import { DispatchOffer } from '../../loads/load-posting/load-dispatch-notifier';
import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import { InboundResolution } from '../messaging.types';
import { OutboundResult, TemplateSendRequest } from '../outbound/outbound-message.service';
import { RecipientLoadContext } from '../router/reply-router.ports';
import { phoneVariantsOf } from './transporter-load-store';
import {
  TransporterBidWriter,
  TransporterOffer,
  TransporterOfferStore,
  TransporterReplyActions,
  transporterStage,
} from './transporter-reply-actions';
import { offerTemplateFor, WhatsappDispatchNotifier } from './whatsapp-dispatch-notifier';

const NOW = new Date(Date.UTC(2026, 10, 14, 12, 0, 0));
const HOUR_MS = 60 * 60 * 1000;
const inbound = {} as WhatsappInboundEntity;

function marketOffer(overrides: Partial<TransporterOffer> = {}): TransporterOffer {
  return {
    recipientId: 'recipient-A',
    tenantId: 'tenant-1',
    transporterId: 'transporter-A',
    loadId: 'load-1',
    loadCode: 'LOAD-0042',
    postingType: 'market_fleet',
    loadStatus: 'created',
    loadTransporterId: null,
    postedAt: new Date(NOW.getTime() - HOUR_MS),
    priceMode: 'set_target',
    postedRate: '45000',
    laneLabel: 'Gurugram → Ludhiana · 24 ft',
    ...overrides,
  };
}

const indentOffer = (overrides: Partial<TransporterOffer> = {}) =>
  marketOffer({
    postingType: 'indent',
    loadTransporterId: 'transporter-A',
    priceMode: null,
    ...overrides,
  });

class FakeOffers implements TransporterOfferStore {
  offers: TransporterOffer[] = [];
  answers = new Map<string, InboundResolution>();
  async findOpenOffersForPhone() {
    return this.offers;
  }
  async findOffer(recipientId: string, loadId: string | null, loadRef: string) {
    return (
      this.offers.find(
        (offer) =>
          offer.recipientId === recipientId &&
          (loadId ? offer.loadId === loadId : offer.loadCode === loadRef),
      ) ?? null
    );
  }
  async latestOfferAnswer(loadId: string, recipientId: string) {
    return this.answers.get(`${loadId}|${recipientId}`) ?? null;
  }
}

class FakeBids implements TransporterBidWriter {
  live: { vehicleNumber: string | null } | null = null;
  calls: string[] = [];
  failWith: Error | null = null;
  async recordWhatsappBid(_tenantId: string, loadId: string, input: WhatsappBidInput) {
    if (this.failWith) throw this.failWith;
    this.calls.push(`bid ${loadId} rate=${input.rate ?? '-'} truck=${input.vehicleNumber ?? '-'}`);
    this.live = { vehicleNumber: input.vehicleNumber ?? this.live?.vehicleNumber ?? null };
  }
  async recordIndentAcceptance(
    _tenantId: string,
    actorId: null,
    loadId: string,
    truck: string,
    channel: 'whatsapp',
  ) {
    this.calls.push(`indent ${loadId} truck=${truck} actor=${actorId} channel=${channel}`);
  }
  async findLiveTransporterBid() {
    return this.live;
  }
}

let offers: FakeOffers;
let bids: FakeBids;
let actions: TransporterReplyActions;
const context = (offer: TransporterOffer): RecipientLoadContext => ({
  tenantId: offer.tenantId,
  loadId: offer.loadId,
  loadRef: offer.loadCode,
  recipientKind: 'transporter',
  recipientRefId: offer.recipientId,
  messageLogId: null,
});

beforeEach(() => {
  offers = new FakeOffers();
  bids = new FakeBids();
  actions = new TransporterReplyActions(offers, bids, () => NOW);
});

describe('transporterStage (CTA sheet: Accept → truck number; Negotiate → rate and truck)', () => {
  it('market: offered → awaiting_rate → awaiting_truck with a truckless bid → offered with the truck', () => {
    expect(transporterStage(marketOffer(), null, null, NOW)).toBe('offered');
    expect(transporterStage(marketOffer(), null, 'negotiating', NOW)).toBe('awaiting_rate');
    expect(transporterStage(marketOffer(), { vehicleNumber: null }, 'accepted', NOW)).toBe(
      'awaiting_truck',
    );
    expect(transporterStage(marketOffer(), { vehicleNumber: 'PB10AB1234' }, null, NOW)).toBe(
      'offered',
    );
    expect(transporterStage(marketOffer(), null, 'rejected', NOW)).toBe('closed');
    expect(
      transporterStage(
        marketOffer({ postedAt: new Date(NOW.getTime() - 5 * HOUR_MS) }),
        null,
        null,
        NOW,
      ),
    ).toBe('closed');
    expect(transporterStage(marketOffer({ loadStatus: 'truck_assigned' }), null, null, NOW)).toBe(
      'closed',
    );
  });

  it('indent: only the contracted transporter; Accept → awaiting_truck', () => {
    expect(transporterStage(indentOffer(), null, null, NOW)).toBe('offered');
    expect(transporterStage(indentOffer(), null, 'accepted', NOW)).toBe('awaiting_truck');
    expect(
      transporterStage(indentOffer({ loadTransporterId: 'someone-else' }), null, null, NOW),
    ).toBe('closed');
  });
});

describe('TransporterReplyActions', () => {
  it('lists only open loads, with lane labels and load_recipients ids', async () => {
    offers.offers = [
      marketOffer(),
      marketOffer({ loadId: 'load-2', loadCode: 'LOAD-0043', loadStatus: 'truck_assigned' }),
    ];
    const open = await actions.findOpenLoadsForSender({ phone: '919876543210', userId: null });
    expect(open).toEqual([
      expect.objectContaining({
        loadRef: 'LOAD-0042',
        recipientRefId: 'recipient-A',
        stage: 'offered',
      }),
    ]);
  });

  it('Accept = a bid at the posted price, then "Send the truck number if you have it"; the truck completes it', async () => {
    const offer = marketOffer();
    offers.offers = [offer];
    const outcome = await actions.applyOfferAction(context(offer), 'accept', inbound);
    expect(outcome).toMatchObject({ resolution: 'accepted' });
    expect(outcome.confirmationText).toBe('LOAD-0042: Done. Send the truck number if you have it.');
    expect(await actions.stageOf(context(offer))).toBe('awaiting_truck');
    expect(await actions.applyTruck(context(offer), 'PB10AB1234', inbound)).toMatchObject({
      resolution: 'details_received',
    });
    expect(bids.calls).toEqual([
      'bid load-1 rate=45000 truck=-',
      'bid load-1 rate=- truck=PB10AB1234',
    ]);
  });

  it('Negotiate asks "Type your rate in ₹ and the truck number"; both in one message make one bid', async () => {
    const offer = marketOffer();
    offers.offers = [offer];
    expect(await actions.applyOfferAction(context(offer), 'negotiate', inbound)).toMatchObject({
      resolution: 'negotiating',
      nextPrompt: 'rate_request',
    });
    const outcome = await actions.applyRate(context(offer), 41000, 'PB10AB1234', inbound);
    expect(outcome).toMatchObject({ resolution: 'bid_recorded' });
    expect(outcome.confirmationText).toBe(
      "LOAD-0042: ₹41,000 noted. Thanks. We'll get back to you.",
    );
    expect(bids.calls).toEqual(['bid load-1 rate=41000 truck=PB10AB1234']);
  });

  it('Reject replies per the CTA sheet: own transporter "Okay, noted."; indent goes to the market', async () => {
    const market = marketOffer();
    offers.offers = [market];
    expect(
      (await actions.applyOfferAction(context(market), 'reject', inbound)).confirmationText,
    ).toBe('LOAD-0042: Okay, noted.');
    const indent = indentOffer({ loadId: 'load-9', loadCode: 'LOAD-0099' });
    offers.offers = [indent];
    expect(
      (await actions.applyOfferAction(context(indent), 'reject', inbound)).confirmationText,
    ).toBe('LOAD-0099: Noted. The load goes to the open market.');
  });

  it('indent: Accept, then the truck number records the acceptance on the whatsapp channel; a rate goes to review', async () => {
    const offer = indentOffer();
    offers.offers = [offer];
    expect(await actions.applyOfferAction(context(offer), 'accept', inbound)).toMatchObject({
      resolution: 'accepted',
    });
    expect(bids.calls).toEqual([]);
    await actions.applyTruck(context(offer), 'PB10AB1234', inbound);
    expect(bids.calls).toEqual(['indent load-1 truck=PB10AB1234 actor=null channel=whatsapp']);
    expect(await actions.applyRate(context(offer), 41000, null, inbound)).toMatchObject({
      resolution: 'needs_review',
    });
  });

  it('a closed load is "late"; a broken business rule goes to review with a reply, not a retry', async () => {
    const closed = marketOffer({ loadStatus: 'truck_assigned' });
    offers.offers = [closed];
    expect(await actions.applyOfferAction(context(closed), 'accept', inbound)).toMatchObject({
      resolution: 'late',
    });

    const open = marketOffer({ loadId: 'load-3', loadCode: 'LOAD-0050' });
    offers.offers = [open];
    bids.failWith = new ConflictError('Vehicle PB10AB1234 is already on an active load elsewhere');
    const outcome = await actions.applyRate(context(open), 41000, 'PB10AB1234', inbound);
    expect(outcome).toMatchObject({
      resolution: 'needs_review',
      note: expect.stringContaining('already on an active load'),
    });
    expect(outcome.confirmationText).toContain('LOAD-0050');
  });

  it('driver details and attachments are not taken on WhatsApp yet — review', async () => {
    expect(await actions.applyDispatch()).toMatchObject({ resolution: 'needs_review' });
    expect(await actions.applySlip()).toMatchObject({ resolution: 'needs_review' });
  });
});

describe('phoneVariantsOf', () => {
  it('matches 10-digit, 91-prefixed and +91 stored numbers', () => {
    expect(phoneVariantsOf('919876543210')).toEqual([
      '919876543210',
      '9876543210',
      '+919876543210',
    ]);
  });
});

describe('WhatsappDispatchNotifier (catalog LS_N_0119 / 0119 quotes / 0120)', () => {
  const offer: DispatchOffer = {
    mode: 'market_fleet',
    priceMode: 'set_target',
    rate: '45000.00',
    pickupLabel: 'Gurugram 122001',
    dropLabel: 'Ludhiana',
    truckLabel: '24 ft',
    weightTonnes: '18.00',
    pickupAt: new Date(Date.UTC(2026, 10, 15, 4, 30)),
    loads: [
      { loadId: 'load-1', loadCode: 'LOAD-0042' },
      { loadId: 'load-2', loadCode: 'LOAD-0043' },
    ],
  };

  it('picks the catalog template by posting mode', () => {
    expect(offerTemplateFor(offer)).toEqual({ templateKey: 'LS_N_0119', priceVariable: 'price' });
    expect(
      offerTemplateFor({ ...offer, priceMode: 'ask_for_quotes', rate: null })?.templateKey,
    ).toBe('LS_N_0119_QUOTE');
    expect(offerTemplateFor({ ...offer, mode: 'indent' })).toEqual({
      templateKey: 'LS_N_0120',
      priceVariable: 'rate',
    });
    expect(offerTemplateFor({ ...offer, mode: 'own_fleet' })).toBeNull();
  });

  it('sends one offer per load to each transporter with the shipper name; queued = pending, all suppressed = failed', async () => {
    const sent: TemplateSendRequest[] = [];
    const notifier = new WhatsappDispatchNotifier(
      {
        sendOffer: async (request) => {
          sent.push(request);
          return {
            messageLogId: 'log',
            status: request.recipient.refId === 'recipient-B' ? 'suppressed' : 'queued',
          } as OutboundResult;
        },
      },
      { nameOf: async () => 'Acme Steels' },
    );
    const results = await notifier.send({
      tenantId: 'tenant-1',
      postingId: 'posting-1',
      text: 'legacy text',
      offer,
      recipients: [
        {
          recipientId: 'recipient-A',
          type: 'transporter',
          name: 'Sharma Roadways',
          phone: '9876543210',
        },
        {
          recipientId: 'recipient-B',
          type: 'transporter',
          name: 'Suppressed',
          phone: '9876543211',
        },
        { recipientId: 'recipient-C', type: 'transporter', name: 'No Phone', phone: null },
        { recipientId: 'recipient-LS', type: 'loadsmart', name: 'Loadsmart', phone: null },
      ],
    });
    expect(results).toEqual([
      { recipientId: 'recipient-A', status: 'pending' },
      { recipientId: 'recipient-B', status: 'failed' },
      { recipientId: 'recipient-C', status: 'failed' },
      { recipientId: 'recipient-LS', status: 'pending' },
    ]);
    expect(
      sent.filter((item) => item.recipient.refId === 'recipient-A').map((item) => item.loadRef),
    ).toEqual(['LOAD-0042', 'LOAD-0043']);
    expect(sent[0]).toMatchObject({
      templateKey: 'LS_N_0119',
      variables: {
        shipper_name: 'Acme Steels',
        origin: 'Gurugram 122001',
        destination: 'Ludhiana',
        truck_type: '24 ft',
        price: '45,000',
      },
    });
  });
});
