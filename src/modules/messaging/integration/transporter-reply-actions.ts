import { AppError } from '../../../shared/errors/AppError';
import { bidWindowClosesAt } from '../../loads/bids/bid-rules';
import { WhatsappBidInput } from '../../loads/utils/load-bid.interface';
import { LoadPostingType, LoadStatus } from '../../loads/utils/loads.types';
import { PriceMode } from '../../loads/load-posting/utils/load-posting.types';
import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import { InboundResolution, OfferAction, RecipientLoadStage } from '../messaging.types';
import {
  ActionOutcome,
  OpenRecipientLoad,
  RecipientLoadContext,
  ReplyActions,
  SenderIdentity,
} from '../router/reply-router.ports';
import { REPLY_TEXTS } from '../router/reply-texts';

/** One posted load as one transporter received it (recipientId = load_recipients.id). */
export interface TransporterOffer {
  recipientId: string;
  tenantId: string;
  transporterId: string;
  loadId: string;
  loadCode: string;
  postingType: LoadPostingType;
  loadStatus: LoadStatus;
  /** The load's transporter: the indent's contracted one (null on market loads until assigned). */
  loadTransporterId: string | null;
  postedAt: Date;
  priceMode: PriceMode | null;
  /** Target rate (market, set_target) or contract rate (indent). */
  postedRate: string | null;
  laneLabel: string;
}

export interface TransporterOfferStore {
  findOpenOffersForPhone(senderPhone: string, now: Date): Promise<TransporterOffer[]>;
  findOffer(
    recipientId: string,
    loadId: string | null,
    loadRef: string,
  ): Promise<TransporterOffer | null>;
  latestOfferAnswer(loadId: string, recipientId: string): Promise<InboundResolution | null>;
}

/** The bid writes a WhatsApp reply may make — LoadBidService satisfies this. */
export interface TransporterBidWriter {
  recordWhatsappBid(tenantId: string, loadId: string, input: WhatsappBidInput): Promise<unknown>;
  recordIndentAcceptance(
    tenantId: string,
    actorId: null,
    loadId: string,
    vehicleNumber: string,
    channel: 'whatsapp',
  ): Promise<unknown>;
  findLiveTransporterBid(
    tenantId: string,
    loadId: string,
    transporterId: string,
  ): Promise<{ vehicleNumber: string | null } | null>;
}

/**
 * Which step a transporter is at on one load (load-flow CTA sheet, catalog LS_N_0119 / 0120).
 * Market: offered → (Negotiate / Give rate) awaiting_rate → (rate) a live bid → awaiting_truck
 * until its truck number is in, then offered (a new rate revises it). Closed after Reject, once
 * the load has a truck, or when the 4-h bid window ends.
 * Indent: offered → (Accept) awaiting_truck → the truck number records the acceptance.
 */
export function transporterStage(
  offer: TransporterOffer,
  liveBid: { vehicleNumber: string | null } | null,
  lastAnswer: InboundResolution | null,
  now: Date,
): RecipientLoadStage {
  if (offer.postingType === 'indent') {
    if (offer.loadStatus !== 'created' || offer.loadTransporterId !== offer.transporterId)
      return 'closed';
    if (lastAnswer === 'rejected') return 'closed';
    return lastAnswer === 'accepted' ? 'awaiting_truck' : 'offered';
  }
  if (offer.postingType !== 'market_fleet') return 'closed';
  if (offer.loadStatus !== 'created' && offer.loadStatus !== 'bids_received') return 'closed';
  if (now >= bidWindowClosesAt(offer.postedAt)) return 'closed';
  if (liveBid) return liveBid.vehicleNumber ? 'offered' : 'awaiting_truck';
  if (lastAnswer === 'rejected') return 'closed';
  return lastAnswer === 'negotiating' ? 'awaiting_rate' : 'offered';
}

/**
 * ReplyActions for the shipper's own transporters (own transporter market loads and indents):
 * Accept / Negotiate / Give rate / Reject, typed rates and truck numbers become WhatsApp-channel
 * bids and indent acceptances through LoadBidService. Driver details and attachments are not taken
 * on WhatsApp today — they go to review for Placement.
 */
export class TransporterReplyActions implements ReplyActions {
  constructor(
    private readonly offers: TransporterOfferStore,
    private readonly bids: TransporterBidWriter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async findOpenLoadsForSender(sender: SenderIdentity): Promise<OpenRecipientLoad[]> {
    const now = this.now();
    const offers = await this.offers.findOpenOffersForPhone(sender.phone, now);
    const open: OpenRecipientLoad[] = [];
    for (const offer of offers) {
      const stage = await this.stageOfOffer(offer, now);
      if (stage === 'closed') continue;
      open.push({ ...contextOf(offer), stage, laneLabel: offer.laneLabel });
    }
    return open;
  }

  async stageOf(context: RecipientLoadContext): Promise<RecipientLoadStage> {
    const offer = await this.offerFor(context);
    return offer ? this.stageOfOffer(offer, this.now()) : 'closed';
  }

  async applyOfferAction(
    context: RecipientLoadContext,
    action: OfferAction,
    _inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome> {
    const offer = await this.offerFor(context);
    if (!offer || (await this.stageOfOffer(offer, this.now())) === 'closed')
      return closedOutcome(context.loadRef);

    if (action === 'reject') {
      return {
        resolution: 'rejected',
        confirmationText:
          offer.postingType === 'indent'
            ? REPLY_TEXTS.indentRejected(offer.loadCode)
            : REPLY_TEXTS.transporterRejected(offer.loadCode),
      };
    }
    if (offer.postingType === 'indent') {
      if (action === 'accept') {
        // The acceptance is recorded with its truck number (recordIndentAcceptance needs one).
        return {
          resolution: 'accepted',
          note: 'indent accepted on WhatsApp — waiting for the truck number',
          confirmationText: REPLY_TEXTS.offerAccepted(offer.loadCode),
        };
      }
      return {
        resolution: 'needs_review',
        note: `"${action}" on an indent — it has a contract rate`,
      };
    }
    if (action === 'negotiate' || action === 'give_rate')
      return { resolution: 'negotiating', nextPrompt: 'rate_request' };

    // Accept on a market offer = a bid at the posted price; then "Send the truck number".
    const targetRate = Number(offer.postedRate);
    if (!offer.postedRate || !Number.isFinite(targetRate) || targetRate <= 0) {
      return {
        resolution: 'negotiating',
        note: 'accept on a load without a price — asked for a rate',
        nextPrompt: 'rate_request',
      };
    }
    return this.write(offer, async () => {
      await this.bids.recordWhatsappBid(offer.tenantId, offer.loadId, {
        transporterId: offer.transporterId,
        rate: targetRate,
      });
      return {
        resolution: 'accepted',
        note: `bid at the posted price ${targetRate}`,
        confirmationText: REPLY_TEXTS.offerAccepted(offer.loadCode),
      };
    });
  }

  async applyRate(
    context: RecipientLoadContext,
    rate: number,
    truckNumber: string | null,
    _inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome> {
    const offer = await this.offerFor(context);
    if (!offer) return closedOutcome(context.loadRef);
    if (offer.postingType !== 'market_fleet')
      return { resolution: 'needs_review', note: 'rate on an indent — it has a contract rate' };
    return this.write(offer, async () => {
      await this.bids.recordWhatsappBid(offer.tenantId, offer.loadId, {
        transporterId: offer.transporterId,
        rate,
        ...(truckNumber ? { vehicleNumber: truckNumber } : {}),
      });
      return {
        resolution: 'bid_recorded',
        note: truckNumber ? `rate ${rate}, truck ${truckNumber}` : `rate ${rate}, truck to come`,
        confirmationText: REPLY_TEXTS.rateRecorded(offer.loadCode, rate),
      };
    });
  }

  async applyTruck(
    context: RecipientLoadContext,
    truckNumber: string,
    _inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome> {
    const offer = await this.offerFor(context);
    if (!offer) return closedOutcome(context.loadRef);
    return this.write(offer, async () => {
      if (offer.postingType === 'indent') {
        await this.bids.recordIndentAcceptance(
          offer.tenantId,
          null,
          offer.loadId,
          truckNumber,
          'whatsapp',
        );
      } else {
        await this.bids.recordWhatsappBid(offer.tenantId, offer.loadId, {
          transporterId: offer.transporterId,
          vehicleNumber: truckNumber,
        });
      }
      return {
        resolution: 'details_received',
        note: `truck ${truckNumber}`,
        confirmationText: REPLY_TEXTS.truckRecorded(offer.loadCode, truckNumber),
      };
    });
  }

  async applyDispatch(): Promise<ActionOutcome> {
    return {
      resolution: 'needs_review',
      note: 'driver details are not taken on WhatsApp yet',
    };
  }

  async applySlip(): Promise<ActionOutcome> {
    return { resolution: 'needs_review', note: 'attachments are not taken on WhatsApp yet' };
  }

  private async offerFor(context: RecipientLoadContext): Promise<TransporterOffer | null> {
    if (context.recipientKind !== 'transporter') return null;
    return this.offers.findOffer(context.recipientRefId, context.loadId, context.loadRef);
  }

  private async stageOfOffer(offer: TransporterOffer, now: Date): Promise<RecipientLoadStage> {
    const [liveBid, lastAnswer] = await Promise.all([
      offer.postingType === 'market_fleet'
        ? this.bids.findLiveTransporterBid(offer.tenantId, offer.loadId, offer.transporterId)
        : null,
      this.offers.latestOfferAnswer(offer.loadId, offer.recipientId),
    ]);
    return transporterStage(offer, liveBid, lastAnswer, now);
  }

  /** Runs a business write; a rule it breaks (window closed, truck busy…) goes to review, not a retry. */
  private async write(
    offer: TransporterOffer,
    apply: () => Promise<ActionOutcome>,
  ): Promise<ActionOutcome> {
    try {
      return await apply();
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      return {
        resolution: 'needs_review',
        note: error.message,
        confirmationText: REPLY_TEXTS.notRecorded(offer.loadCode),
      };
    }
  }
}

function contextOf(offer: TransporterOffer): RecipientLoadContext {
  return {
    tenantId: offer.tenantId,
    loadId: offer.loadId,
    loadRef: offer.loadCode,
    recipientKind: 'transporter',
    recipientRefId: offer.recipientId,
    messageLogId: null,
  };
}

function closedOutcome(loadRef: string): ActionOutcome {
  return {
    resolution: 'late',
    note: 'load no longer open for this transporter',
    confirmationText: REPLY_TEXTS.loadClosed(loadRef),
  };
}
