import { DataSource, In, IsNull } from 'typeorm';
import { AppError } from '../../../shared/errors';
import { UserEntity } from '../../auth/entities/user.entity';
import { LoadBidEntity } from '../../loads/bids/load-bid.entity';
import { LoadEntity } from '../../loads/entities/load.entity';
import { WhatsappInboundEntity } from '../entities/whatsapp-inbound.entity';
import {
  LANE_LABEL_MAX_LENGTH,
  LIVE_BID_STATUS,
  MEMO_WAITING_LOAD_STATUS,
  OFFER_ANSWER_RESOLUTIONS,
  WHATSAPP_ANSWERABLE_LOAD_STATUSES,
} from '../messaging.constants';
import { InboundResolution, OfferAction, RecipientLoadStage } from '../messaging.types';
import {
  ActionOutcome,
  OpenRecipientLoad,
  RecipientLoadContext,
  ReplyActions,
  SenderIdentity,
} from '../router/reply-router.ports';
import { REPLY_TEXTS } from '../router/reply-texts';
import { storedPhoneVariantsOf } from './phone-variants';
import {
  LiveLoadsmartBid,
  MemoGateway,
  ShipperBidGateway,
  ShipperLoad,
  ShipperLoadStore,
  ShipperUser,
} from './load-notices.interface';

/**
 * ReplyActions for shipper users, as the user who posted the load (same rules as the app):
 * - Loadsmart's bid (LS_N_0067): Accept accepts it, Counter asks "Type your price in ₹" and the
 *   typed price counters it (Placement answers), Reject rejects it.
 * - The load memo (LS_N_0069): Accept memo accepts it (LoadMemoService.accept).
 * Which one a reply answers follows the load: a live Loadsmart bid before the award, the memo
 * after it. Trucks, details and attachments from a shipper go to review.
 */
export class ShipperReplyActions implements ReplyActions {
  constructor(
    private readonly store: ShipperLoadStore,
    private readonly memos: MemoGateway,
    private readonly bids: ShipperBidGateway,
  ) {}

  async findOpenLoadsForSender(sender: SenderIdentity): Promise<OpenRecipientLoad[]> {
    const users = await this.store.findUsersByPhone(storedPhoneVariantsOf(sender.phone));
    const open: OpenRecipientLoad[] = [];
    for (const user of users) {
      for (const load of await this.store.findLoadsWithLoadsmartBid(user)) {
        open.push({
          ...contextOf(load, user.id),
          stage: await this.bidStage(load, user.id),
          laneLabel: `Loadsmart's bid · ${load.loadCode}`.slice(0, LANE_LABEL_MAX_LENGTH),
        });
      }
      for (const load of await this.store.findLoadsAwaitingMemo(user)) {
        if ((await this.memoStatus(load)) !== 'sent') continue;
        open.push({ ...contextOf(load, user.id), stage: 'offered', laneLabel: memoLabelOf(load) });
      }
    }
    return open;
  }

  async stageOf(context: RecipientLoadContext): Promise<RecipientLoadStage> {
    const load = await this.loadFor(context);
    if (!load) return 'closed';
    if (await this.store.findLiveLoadsmartBid(load.tenantId, load.loadId)) {
      return this.bidStage(load, context.recipientRefId);
    }
    return (await this.memoStatus(load)) === 'sent' ? 'offered' : 'closed';
  }

  async applyOfferAction(
    context: RecipientLoadContext,
    action: OfferAction,
    _inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome> {
    const load = await this.loadFor(context);
    if (!load) return closed(context.loadRef);
    const bid = await this.store.findLiveLoadsmartBid(load.tenantId, load.loadId);
    return bid
      ? this.answerBid(load, bid, context.recipientRefId, action)
      : this.answerMemo(load, context.recipientRefId, action);
  }

  /** A typed price: the shipper's counter to Loadsmart's live bid. */
  async applyRate(
    context: RecipientLoadContext,
    rate: number,
    _truckNumber: string | null,
    _inbound: WhatsappInboundEntity,
  ): Promise<ActionOutcome> {
    const load = await this.loadFor(context);
    const bid = load ? await this.store.findLiveLoadsmartBid(load.tenantId, load.loadId) : null;
    if (!load || !bid) return { resolution: 'needs_review', note: 'price from a shipper user' };
    return this.attempt(load, async () => {
      await this.bids.counterBid(load.tenantId, context.recipientRefId, load.loadId, bid.id, {
        rate,
      });
      return {
        resolution: 'bid_recorded',
        note: "shipper's counter to Loadsmart's bid",
        confirmationText: REPLY_TEXTS.counterRecorded(load.loadCode, rate),
      };
    });
  }

  async applyTruck(): Promise<ActionOutcome> {
    return { resolution: 'needs_review', note: 'truck number from a shipper user' };
  }

  async applyDispatch(): Promise<ActionOutcome> {
    return { resolution: 'needs_review', note: 'truck details from a shipper user' };
  }

  async applySlip(): Promise<ActionOutcome> {
    return { resolution: 'needs_review', note: 'attachment from a shipper user' };
  }

  // ------------------------------------------------------------------ Loadsmart's bid

  private async answerBid(
    load: ShipperLoad,
    bid: LiveLoadsmartBid,
    userId: string,
    action: OfferAction,
  ): Promise<ActionOutcome> {
    switch (action) {
      case 'accept':
        return this.attempt(load, async () => {
          await this.bids.acceptBid(load.tenantId, userId, load.loadId, bid.id);
          return {
            resolution: 'accepted',
            note: "Loadsmart's bid accepted on WhatsApp",
            confirmationText: REPLY_TEXTS.loadsmartBidAccepted(load.loadCode),
          };
        });
      case 'negotiate':
        // Counter: the typed price comes next (applyRate).
        return { resolution: 'negotiating', nextPrompt: 'price_request' };
      case 'reject':
        return this.attempt(load, async () => {
          await this.bids.rejectBid(load.tenantId, userId, load.loadId, bid.id);
          return {
            resolution: 'rejected',
            note: "Loadsmart's bid rejected on WhatsApp",
            confirmationText: REPLY_TEXTS.loadsmartBidRejected(load.loadCode),
          };
        });
      default:
        return { resolution: 'needs_review', note: `"${action}" on Loadsmart's bid` };
    }
  }

  private async bidStage(load: ShipperLoad, userId: string): Promise<RecipientLoadStage> {
    return (await this.store.latestAnswer(load.loadId, userId)) === 'negotiating'
      ? 'awaiting_rate'
      : 'offered';
  }

  // ------------------------------------------------------------------ the load memo

  private async answerMemo(
    load: ShipperLoad,
    userId: string,
    action: OfferAction,
  ): Promise<ActionOutcome> {
    if (action !== 'accept') {
      return { resolution: 'needs_review', note: `"${action}" on a load memo` };
    }
    const status = await this.memoStatus(load);
    if (status === 'expired') {
      return {
        resolution: 'late',
        note: 'load memo expired',
        confirmationText: REPLY_TEXTS.memoExpired(load.loadCode),
      };
    }
    if (status === null) return closed(load.loadCode);
    return this.attempt(load, async () => {
      await this.memos.accept(load.tenantId, userId, load.loadId, {});
      const memo = await this.memos.getCurrent(load.tenantId, load.loadId);
      return {
        resolution: 'accepted',
        note: 'load memo accepted on WhatsApp',
        confirmationText: REPLY_TEXTS.memoAccepted(load.loadCode, memo.vehicleNumber),
      };
    });
  }

  /** The latest memo's status ('sent', 'expired', 'accepted'…), or null when there is none. */
  private async memoStatus(load: ShipperLoad): Promise<string | null> {
    try {
      return (await this.memos.getCurrent(load.tenantId, load.loadId)).status;
    } catch (error) {
      if (error instanceof AppError) return null;
      throw error;
    }
  }

  // ------------------------------------------------------------------ helpers

  private async loadFor(context: RecipientLoadContext): Promise<ShipperLoad | null> {
    if (context.recipientKind !== 'shipper_user') return null;
    const user = await this.store.findUser(context.recipientRefId);
    if (!user) return null;
    return this.store.findLoad(user, context.loadId, context.loadRef);
  }

  /** Runs a load service action; its refusal (closed, expired, changed…) comes back as late with
   *  the same reason the app shows, not as an error. */
  private async attempt(
    load: ShipperLoad,
    action: () => Promise<ActionOutcome>,
  ): Promise<ActionOutcome> {
    try {
      return await action();
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      return {
        resolution: 'late',
        note: error.message,
        confirmationText: REPLY_TEXTS.notRecorded(load.loadCode),
      };
    }
  }
}

function closed(loadRef: string): ActionOutcome {
  return {
    resolution: 'late',
    note: 'no longer open',
    confirmationText: REPLY_TEXTS.loadClosed(loadRef),
  };
}

function contextOf(load: ShipperLoad, userId: string): RecipientLoadContext {
  return {
    tenantId: load.tenantId,
    loadId: load.loadId,
    loadRef: load.loadCode,
    recipientKind: 'shipper_user',
    recipientRefId: userId,
    messageLogId: null,
  };
}

function memoLabelOf(load: ShipperLoad): string {
  return `Memo · ${load.vehicleNumber ?? 'truck'} · ${load.driverName ?? 'driver'}`.slice(
    0,
    LANE_LABEL_MAX_LENGTH,
  );
}

function toShipperLoad(load: LoadEntity): ShipperLoad {
  return {
    tenantId: load.tenantId,
    loadId: load.id,
    loadCode: load.code,
    vehicleNumber: load.vehicleNumber,
    driverName: load.driverName,
  };
}

/** Users, their loads and Loadsmart's live bids, through TypeORM. */
export class TypeormShipperLoadStore implements ShipperLoadStore {
  constructor(private readonly dataSource: DataSource) {}

  async findUser(userId: string): Promise<ShipperUser | null> {
    const user = await this.dataSource
      .getRepository(UserEntity)
      .findOneBy({ id: userId, deletedAt: IsNull() });
    return user ? { id: user.id, tenantId: user.tenantId } : null;
  }

  async findUsersByPhone(phones: string[]): Promise<ShipperUser[]> {
    const users = await this.dataSource
      .getRepository(UserEntity)
      .find({ where: { phoneNumber: In(phones), deletedAt: IsNull() } });
    return users
      .filter((user) => user.tenantId)
      .map((user) => ({ id: user.id, tenantId: user.tenantId }));
  }

  async findLoadsAwaitingMemo(user: ShipperUser): Promise<ShipperLoad[]> {
    if (!user.tenantId) return [];
    const loads = await this.dataSource.getRepository(LoadEntity).find({
      where: {
        tenantId: user.tenantId,
        createdBy: user.id,
        status: MEMO_WAITING_LOAD_STATUS,
        memoAcceptedAt: IsNull(),
      },
      order: { code: 'ASC' },
    });
    return loads.filter((load) => load.awardedBidId).map(toShipperLoad);
  }

  async findLoadsWithLoadsmartBid(user: ShipperUser): Promise<ShipperLoad[]> {
    if (!user.tenantId) return [];
    const loads = await this.dataSource.getRepository(LoadEntity).find({
      where: {
        tenantId: user.tenantId,
        createdBy: user.id,
        postingType: 'market_fleet',
        status: In([...WHATSAPP_ANSWERABLE_LOAD_STATUSES]),
        awardedBidId: IsNull(),
      },
      order: { code: 'ASC' },
    });
    if (loads.length === 0) return [];
    const bids = await this.dataSource.getRepository(LoadBidEntity).find({
      where: {
        tenantId: user.tenantId,
        loadId: In(loads.map((load) => load.id)),
        source: 'loadsmart',
        status: LIVE_BID_STATUS,
      },
      select: { id: true, loadId: true },
    });
    const withBid = new Set(bids.map((bid) => bid.loadId));
    return loads.filter((load) => withBid.has(load.id)).map(toShipperLoad);
  }

  async findLoad(
    user: ShipperUser,
    loadId: string | null,
    loadRef: string,
  ): Promise<ShipperLoad | null> {
    if (!user.tenantId) return null;
    const load = await this.dataSource.getRepository(LoadEntity).findOneBy({
      tenantId: user.tenantId,
      createdBy: user.id,
      ...(loadId ? { id: loadId } : { code: loadRef }),
    });
    return load ? toShipperLoad(load) : null;
  }

  async findLiveLoadsmartBid(tenantId: string, loadId: string): Promise<LiveLoadsmartBid | null> {
    const bid = await this.dataSource.getRepository(LoadBidEntity).findOne({
      where: { tenantId, loadId, source: 'loadsmart', status: LIVE_BID_STATUS },
      select: { id: true, rate: true },
    });
    return bid ? { id: bid.id, rate: bid.rate } : null;
  }

  async latestAnswer(loadId: string, userId: string): Promise<InboundResolution | null> {
    const latest = await this.dataSource.getRepository(WhatsappInboundEntity).findOne({
      where: { loadId, recipientRefId: userId, resolution: In([...OFFER_ANSWER_RESOLUTIONS]) },
      order: { receivedAt: 'DESC' },
      select: { id: true, resolution: true },
    });
    return latest?.resolution ?? null;
  }
}
