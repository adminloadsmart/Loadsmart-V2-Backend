import { AppError } from '../../../shared/errors/AppError';
import { writeErrorNote } from './write-error-note';
import { nameDriverRefusalText } from './name-driver-refusal';
import { LoadBoardOffer } from '../../loadsmart-ops/loadsmart.interface';
import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import {
  InboundResolution,
  OfferAction,
  PartnerDriverChecks,
  RecipientLoadStage,
  ReplyValueKind,
} from '../messaging.types';
import type { PartnerLoadStatus } from '../../loadsmart-ops/loadsmart.types';
import { DispatchDetails } from '../parsers/reply-value.parsers';
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
  /** Where the load stands for this partner — the reply to a message it can't take. */
  partnerLoadStatus(loadId: string, partnerId: string): Promise<PartnerLoadStatus | null>;
  /** Loads these partners won that still wait for the truck and driver (LS_N_0107 asked). */
  wonLoadsAwaitingDriver(partnerIds: string[]): Promise<LoadBoardOffer[]>;
  /** The winning partner's truck and driver from WhatsApp — saved and checked, memo held. */
  nameDriverFromWhatsapp(
    loadId: string,
    partnerId: string,
    driver: {
      driverName: string;
      driverMobile: string;
      licenceNumber: string;
      dateOfBirth: string;
      vehicleNumber?: string;
    },
  ): Promise<{ checks: PartnerDriverChecks }>;
  /** A tap that isn't a rate (Reject / Negotiate / Give rate), for the broker's history. */
  recordPartnerReplyFromWhatsapp(
    sourcingId: string,
    input: { partnerId: string; response: 'declined' | 'negotiating' },
  ): Promise<unknown>;
}

/** A verdict the broker has to act on — the truck failed on VAHAN, or the licence is expired /
 *  the wrong class — as one line; null when nothing failed or Placement can still pass it by
 *  hand (e.g. Sarathi has no match), which stays with Placement. */
export function hardFailureOf(checks: PartnerDriverChecks): string | null {
  const truckFailed = checks.truck?.status === 'failed' && !checks.truckManualAllowed;
  const driverFailed = checks.driver?.status === 'failed' && !checks.driverManualAllowed;
  if (!truckFailed && !driverFailed) return null;
  return checks.blockers[0] ?? 'a check failed';
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
      // Loads this partner won: LS_N_0107 asked for the truck and driver.
      for (const wonLoad of await this.board.wonLoadsAwaitingDriver([partner.id])) {
        open.push({
          ...contextOf(wonLoad, partner.id),
          stage: 'awaiting_dispatch',
          laneLabel: laneLabelOf(wonLoad),
        });
      }
    }
    return open;
  }

  async stageOf(context: RecipientLoadContext): Promise<RecipientLoadStage> {
    const boardLoad = await this.boardLoadFor(context);
    if (boardLoad) return this.stageFor(boardLoad, context.recipientRefId);
    return (await this.wonLoadFor(context)) ? 'awaiting_dispatch' : 'closed';
  }

  /** What to tell the broker when the load can't take this value now. */
  async whyNotAccepted(
    context: RecipientLoadContext,
    kind: ReplyValueKind,
  ): Promise<string | null> {
    if (context.recipientKind !== 'partner' || !context.loadId) return null;
    const status = await this.board.partnerLoadStatus(context.loadId, context.recipientRefId);
    switch (status) {
      case 'cancelled':
        return REPLY_TEXTS.loadCancelled(context.loadRef);
      case 'given_to_other':
        return REPLY_TEXTS.loadGivenToOther(context.loadRef);
      case 'driver_confirmed':
        return REPLY_TEXTS.driverAlreadyConfirmed(context.loadRef);
      case 'bidding':
        return kind === 'dispatch' ? REPLY_TEXTS.driverBeforeAward(context.loadRef) : null;
      case 'awaiting_driver':
        // Won: only the full truck + driver message is taken now.
        return kind === 'dispatch' ? null : REPLY_TEXTS.driverDetailsNeeded(context.loadRef);
      default:
        return null;
    }
  }

  async applyOfferAction(
    context: RecipientLoadContext,
    action: OfferAction,
    _inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome> {
    const boardLoad = await this.boardLoadFor(context);
    if (!boardLoad || (await this.stageFor(boardLoad, context.recipientRefId)) === 'closed')
      return this.closedOutcomeFor(context);
    if (action === 'reject') {
      await this.recordTap(boardLoad, context, 'declined');
      return {
        resolution: 'rejected',
        confirmationText: REPLY_TEXTS.brokerRejected(boardLoad.loadCode),
      };
    }
    if (action === 'negotiate' || action === 'give_rate') {
      await this.recordTap(boardLoad, context, 'negotiating');
      return { resolution: 'negotiating', nextPrompt: 'rate_request' };
    }

    const partnerRate = Number(boardLoad.partnerRate);
    if (!boardLoad.partnerRate || !Number.isFinite(partnerRate) || partnerRate <= 0) {
      await this.recordTap(boardLoad, context, 'negotiating');
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
    if (!boardLoad) return this.closedOutcomeFor(context);
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
    if (!boardLoad) return this.closedOutcomeFor(context);
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

  /** The truck and driver for a load this partner won (answer to LS_N_0107). Sarathi needs the
   *  DL number and the date of birth, so both are asked for when missing. The details are saved
   *  and checked; the memo waits for Placement's review. */
  async applyDispatch(
    context: RecipientLoadContext,
    details: DispatchDetails,
    _inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome> {
    const wonLoad = await this.wonLoadFor(context);
    if (!wonLoad) return this.closedOutcomeFor(context);
    const missing = [
      ...(details.licenceNumber ? [] : ['DL number']),
      ...(details.dateOfBirth ? [] : ["driver's date of birth (for example 12 May 1990)"]),
    ];
    if (missing.length > 0 || !details.driverMobile) {
      return {
        resolution: 'validation_failed',
        note: `driver details without ${missing.join(', ') || 'a mobile'}`,
        confirmationText: REPLY_TEXTS.dispatchMissing(wonLoad.loadCode, missing),
        asksFor: 'dispatch',
      };
    }
    return this.write(wonLoad, async () => {
      const { checks } = await this.board.nameDriverFromWhatsapp(
        wonLoad.loadId,
        context.recipientRefId,
        {
          driverName: details.driverName,
          driverMobile: details.driverMobile!,
          licenceNumber: details.licenceNumber!,
          dateOfBirth: details.dateOfBirth!,
          ...(details.truckNumber ? { vehicleNumber: details.truckNumber } : {}),
        },
      );
      const failed = hardFailureOf(checks);
      return {
        resolution: 'details_received',
        note: `driver ${details.driverName}, DL ${details.licenceNumber}${
          checks.clear
            ? ' — checks clear, memo held for Placement'
            : ` — ${checks.blockers.join('; ')}`
        }`,
        confirmationText: failed
          ? REPLY_TEXTS.dispatchCheckFailed(wonLoad.loadCode, failed)
          : REPLY_TEXTS.dispatchWithPlacement(wonLoad.loadCode, details.driverName),
        ...(failed ? { asksFor: 'dispatch' as const } : {}),
      };
    });
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

  /** The load is off the board for this partner: say why when we know (given to another truck,
   *  cancelled, driver already confirmed), else the general "no longer open". */
  private async closedOutcomeFor(context: RecipientLoadContext): Promise<ActionOutcome> {
    const outcome = closedOutcome(context.loadRef);
    const reason = await this.whyNotAccepted(context, 'rate');
    return reason ? { ...outcome, confirmationText: reason } : outcome;
  }

  /** The load this partner won that still waits for the driver, if the context is one. */
  private async wonLoadFor(context: RecipientLoadContext): Promise<LoadBoardOffer | null> {
    if (context.recipientKind !== 'partner') return null;
    const wonLoads = await this.board.wonLoadsAwaitingDriver([context.recipientRefId]);
    if (context.loadId) return wonLoads.find((load) => load.loadId === context.loadId) ?? null;
    const byCode = wonLoads.filter((load) => load.loadCode === context.loadRef);
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

  /** The tap goes in the broker's history for Placement. Best effort: the broker's answer is
   *  already decided, so a history write that fails (e.g. the load just left the board) must not
   *  turn it into needs_review. */
  private async recordTap(
    boardLoad: LoadBoardOffer,
    context: RecipientLoadContext,
    response: 'declined' | 'negotiating',
  ): Promise<void> {
    try {
      await this.board.recordPartnerReplyFromWhatsapp(boardLoad.sourcingId, {
        partnerId: context.recipientRefId,
        response,
      });
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
    }
  }

  private async write(
    boardLoad: LoadBoardOffer,
    apply: () => Promise<ActionOutcome>,
  ): Promise<ActionOutcome> {
    try {
      return await apply();
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      const refusal = nameDriverRefusalText(error, boardLoad.loadCode);
      if (refusal) {
        return {
          resolution: 'validation_failed',
          note: writeErrorNote(error, boardLoad.loadCode),
          confirmationText: refusal,
          asksFor: 'dispatch',
        };
      }
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
