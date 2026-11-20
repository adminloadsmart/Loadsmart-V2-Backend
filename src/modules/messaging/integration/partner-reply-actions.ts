import { AppError } from '../../../shared/errors/AppError';
import { writeErrorNote } from './write-error-note';
import { LoadBoardOffer } from '../../loadsmart-ops/loadsmart.interface';
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
import { LANE_LABEL_MAX_LENGTH } from '../messaging.constants';
import { phoneVariantsOf } from './transporter-load-store';

/** Loadsmart's board as WhatsApp replies need it — LsSourcingService satisfies this. */
export interface PartnerBoardGateway {
  findActivePartnersByPhones(phones: string[]): Promise<{ id: string }[]>;
  openBoardLoads(): Promise<LoadBoardOffer[]>;
  findLivePartnerBid(
    sourcingId: string,
    partnerId: string,
  ): Promise<{ vehicleNumber: string | null } | null>;
  recordPartnerBidFromWhatsapp(
    sourcingId: string,
    input: { partnerId: string; rate?: number; vehicleNumber?: string },
  ): Promise<unknown>;
}

export interface OfferAnswerStore {
  latestOfferAnswer(loadId: string, recipientRefId: string): Promise<InboundResolution | null>;
}

/** A broker on a board load (catalog LS_N_0105 / 0106): offered → (Negotiate / Give rate)
 *  awaiting_rate → (rate) a live bid → awaiting_truck until its truck number is in, then offered
 *  (a new rate revises the bid). Closed after Reject. */
export function partnerStage(
  liveBid: { vehicleNumber: string | null } | null,
  lastAnswer: InboundResolution | null,
): RecipientLoadStage {
  if (liveBid) return liveBid.vehicleNumber ? 'offered' : 'awaiting_truck';
  if (lastAnswer === 'rejected') return 'closed';
  return lastAnswer === 'negotiating' ? 'awaiting_rate' : 'offered';
}

/**
 * ReplyActions for Loadsmart partners on the load board: Accept (at the board rate) and typed
 * rates become partner bids through LsSourcingService (no entering user). Truck / driver details
 * and attachments are not taken on WhatsApp today — they go to review for Placement.
 */
export class PartnerReplyActions implements ReplyActions {
  constructor(
    private readonly board: PartnerBoardGateway,
    private readonly answers: OfferAnswerStore,
  ) {}

  async findOpenLoadsForSender(sender: SenderIdentity): Promise<OpenRecipientLoad[]> {
    const partners = await this.board.findActivePartnersByPhones(phoneVariantsOf(sender.phone));
    if (partners.length === 0) return [];
    const boardLoads = await this.board.openBoardLoads();
    const open: OpenRecipientLoad[] = [];
    for (const partner of partners) {
      for (const boardLoad of boardLoads) {
        const stage = await this.stageFor(boardLoad, partner.id);
        if (stage === 'closed') continue;
        open.push({
          ...contextOf(boardLoad, partner.id),
          stage,
          laneLabel: laneLabelOf(boardLoad),
        });
      }
    }
    return open;
  }

  async stageOf(context: RecipientLoadContext): Promise<RecipientLoadStage> {
    const boardLoad = await this.boardLoadFor(context);
    return boardLoad ? this.stageFor(boardLoad, context.recipientRefId) : 'closed';
  }

  async applyOfferAction(
    context: RecipientLoadContext,
    action: OfferAction,
    _inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome> {
    const boardLoad = await this.boardLoadFor(context);
    if (!boardLoad || (await this.stageFor(boardLoad, context.recipientRefId)) === 'closed')
      return closedOutcome(context.loadRef);
    if (action === 'reject')
      return {
        resolution: 'rejected',
        confirmationText: REPLY_TEXTS.brokerRejected(boardLoad.loadCode),
      };
    if (action === 'negotiate' || action === 'give_rate')
      return { resolution: 'negotiating', nextPrompt: 'rate_request' };

    const partnerRate = Number(boardLoad.partnerRate);
    if (!boardLoad.partnerRate || !Number.isFinite(partnerRate) || partnerRate <= 0) {
      return {
        resolution: 'negotiating',
        note: 'accept on a board load without a partner rate — asked for a rate',
        nextPrompt: 'rate_request',
      };
    }
    return this.write(boardLoad, async () => {
      await this.board.recordPartnerBidFromWhatsapp(boardLoad.sourcingId, {
        partnerId: context.recipientRefId,
        rate: partnerRate,
      });
      return {
        resolution: 'accepted',
        note: `partner bid at the board rate ${partnerRate}`,
        confirmationText: REPLY_TEXTS.offerAccepted(boardLoad.loadCode),
        asksFor: 'truck',
      };
    });
  }

  async applyRate(
    context: RecipientLoadContext,
    rate: number,
    truckNumber: string | null,
    _inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome> {
    const boardLoad = await this.boardLoadFor(context);
    if (!boardLoad) return closedOutcome(context.loadRef);
    return this.write(boardLoad, async () => {
      await this.board.recordPartnerBidFromWhatsapp(boardLoad.sourcingId, {
        partnerId: context.recipientRefId,
        rate,
        ...(truckNumber ? { vehicleNumber: truckNumber } : {}),
      });
      return {
        resolution: 'bid_recorded',
        note: truckNumber ? `rate ${rate}, truck ${truckNumber}` : `rate ${rate}, truck to come`,
        confirmationText: REPLY_TEXTS.rateRecorded(boardLoad.loadCode, rate),
      };
    });
  }

  async applyTruck(
    context: RecipientLoadContext,
    truckNumber: string,
    _inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome> {
    const boardLoad = await this.boardLoadFor(context);
    if (!boardLoad) return closedOutcome(context.loadRef);
    return this.write(boardLoad, async () => {
      await this.board.recordPartnerBidFromWhatsapp(boardLoad.sourcingId, {
        partnerId: context.recipientRefId,
        vehicleNumber: truckNumber,
      });
      return {
        resolution: 'details_received',
        note: `truck ${truckNumber}`,
        confirmationText: REPLY_TEXTS.truckRecorded(boardLoad.loadCode, truckNumber),
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

  private async boardLoadFor(context: RecipientLoadContext): Promise<LoadBoardOffer | null> {
    if (context.recipientKind !== 'partner') return null;
    const boardLoads = await this.board.openBoardLoads();
    if (context.loadId)
      return boardLoads.find((boardLoad) => boardLoad.loadId === context.loadId) ?? null;
    // Load codes are per shipper: by code only when exactly one board load has it.
    const byCode = boardLoads.filter((boardLoad) => boardLoad.loadCode === context.loadRef);
    return byCode.length === 1 ? byCode[0] : null;
  }

  private async stageFor(
    boardLoad: LoadBoardOffer,
    partnerId: string,
  ): Promise<RecipientLoadStage> {
    const [liveBid, lastAnswer] = await Promise.all([
      this.board.findLivePartnerBid(boardLoad.sourcingId, partnerId),
      this.answers.latestOfferAnswer(boardLoad.loadId, partnerId),
    ]);
    return partnerStage(liveBid, lastAnswer);
  }

  private async write(
    boardLoad: LoadBoardOffer,
    apply: () => Promise<ActionOutcome>,
  ): Promise<ActionOutcome> {
    try {
      return await apply();
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      return {
        resolution: 'needs_review',
        note: writeErrorNote(error, boardLoad.loadCode),
        confirmationText: REPLY_TEXTS.notRecorded(boardLoad.loadCode),
      };
    }
  }
}

function contextOf(boardLoad: LoadBoardOffer, partnerId: string): RecipientLoadContext {
  return {
    tenantId: boardLoad.tenantId,
    loadId: boardLoad.loadId,
    loadRef: boardLoad.loadCode,
    recipientKind: 'partner',
    recipientRefId: partnerId,
    messageLogId: null,
  };
}

function laneLabelOf(boardLoad: LoadBoardOffer): string {
  return `${boardLoad.pickupLabel} → ${boardLoad.dropLabel} · ${boardLoad.truckLabel}`.slice(
    0,
    LANE_LABEL_MAX_LENGTH,
  );
}

function closedOutcome(loadRef: string): ActionOutcome {
  return {
    resolution: 'late',
    note: 'load no longer on the board for this partner',
    confirmationText: REPLY_TEXTS.loadClosed(loadRef),
  };
}
