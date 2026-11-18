import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../../shared/errors';
import { LoadPostingHooks } from '../load-posting/utils/load-posting.interface';
import { AuditService } from '../../audit/audit.service';
import { TransporterService } from '../../masters/transporter/transporter.service';
import { LoadActivityService } from '../activity/load-activity.service';
import { LoadRepository } from '../core/load.repository';
import { LoadStageService } from '../core/load-stage.service';
import { LoadEntity } from '../entities/load.entity';
import { LoadBidEntity } from './load-bid.entity';
import { LoadBidRepository } from './load-bid.repository';
import {
  acceptBlocker,
  bidWindowClosesAt,
  effectiveBidStatus,
  manualRateError,
  rankBids,
} from './bid-rules';
import {
  LoadVerificationService,
  truckVerifiedOf,
} from '../verification/load-verification.service';
import {
  BidView,
  CounterAnswerInput,
  CounterBidInput,
  LoadBidsView,
  LoadsmartBidAcceptedHook,
  LoadsmartBidEventHook,
  LoadsmartBidInput,
  RecordBidInput,
  WhatsappBidInput,
} from '../utils/load-bid.interface';
import { BidChannel } from '../utils/loads.types';
import { LoadEventNotifier } from '../../notifications/notifications.interface';

const normalizePlate = (value: string) => value.replace(/\s+/g, '').toUpperCase();

/**
 * Bids on market loads (the shipper's own transporters and Loadsmart) and the contracted
 * transporter's acceptance of an indent. A bid answers one load — one truck. The first bid moves
 * the load to Bids received; accepting one keeps it there with the award on it (route
 * own_transporter, or a Loadsmart award) and rejects the other bids; the accepted load memo moves
 * it to Truck assigned (load-memo.service.ts). Expiry is applied whenever bids are read or accepted, so no scheduled
 * job is needed for it. Every stage move goes through LoadStageService as a trigger.
 *
 * Bids reach this service through the shipper's web entry and, since the WhatsApp integration,
 * from the transporter's own replies (recordWhatsappBid, channel `whatsapp`).
 */
export class LoadBidService {
  constructor(
    private readonly bidRepository: LoadBidRepository,
    private readonly loadRepository: LoadRepository,
    private readonly transporterService: TransporterService,
    private readonly stageService: LoadStageService,
    private readonly loadActivityService: LoadActivityService,
    private readonly auditService: AuditService,
    private readonly verification: LoadVerificationService,
    /** Filled in by the Loadsmart ops module: a rejected indent opens Loadsmart's sourcing. */
    private readonly postingHooks: LoadPostingHooks,
    // LS_N_0016 — optional; only queues a notification and never throws (see
    // notifications/load-alerts.ts).
    private readonly onLoadEvent?: LoadEventNotifier,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /** Set by the Loadsmart ops module (it is built after this service and itself posts bids
   *  through it) — marks the sourcing won and the partner on the truck. */
  private onLoadsmartBidAccepted?: LoadsmartBidAcceptedHook;

  setLoadsmartBidAcceptedHook(hook: LoadsmartBidAcceptedHook): void {
    this.onLoadsmartBidAccepted = hook;
  }

  /** Set by the Loadsmart ops module: the shipper countered or rejected Loadsmart's bid. */
  private onLoadsmartBidCountered?: LoadsmartBidEventHook;
  private onLoadsmartBidRejected?: LoadsmartBidEventHook;

  setLoadsmartBidEventHooks(hooks: {
    countered: LoadsmartBidEventHook;
    rejected: LoadsmartBidEventHook;
  }): void {
    this.onLoadsmartBidCountered = hooks.countered;
    this.onLoadsmartBidRejected = hooks.rejected;
  }

  /** Loadsmart's placement team sends one best bid: the partner's truck at Loadsmart's price,
   *  shown to the shipper as Loadsmart's, first and highlighted. A new one replaces Loadsmart's
   *  previous live bid. Market loads only, inside the same 4-hour window. */
  async recordLoadsmartBid(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: LoadsmartBidInput,
  ): Promise<LoadBidEntity> {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      if (load.postingType !== 'market_fleet')
        throw new ConflictError('Only market fleet loads take Loadsmart bids');
      if (load.status !== 'created' && load.status !== 'bids_received') {
        throw new ConflictError('This load already has a truck — it no longer takes bids');
      }
      const now = this.now();
      const window = await this.windowOf(load);
      const closesAt = bidWindowClosesAt(window.sentAt, window.extraMinutes);
      if (now >= closesAt) throw new ConflictError('Bidding on this load has closed');
      await this.assertTruckFree(load, input.vehicleNumber);

      const previous = await this.bidRepository.findLiveLoadsmart(tenantId, loadId);
      if (previous) await this.bidRepository.markRejected(previous, actorId);
      const created = await this.bidRepository.create({
        tenantId,
        loadId,
        recipientId: null,
        source: 'loadsmart',
        lsPartnerBidId: input.lsPartnerBidId,
        transporterId: null,
        rate: input.rate,
        vehicleNumber: input.vehicleNumber,
        channel: 'web',
        expiresAt: closesAt,
        enteredBy: actorId,
        entryReason: "Loadsmart's bid",
        rateHistory: [{ at: now.toISOString(), by: actorId, kind: 'bid', rate: input.rate }],
      });
      const bid =
        input.truckVerified === null
          ? created
          : await this.bidRepository.update(created, { truckVerified: input.truckVerified });
      await this.recordBidActivity(load, actorId, bid, { loadsmart: true });
      return bid;
    } catch (error) {
      rethrow(error, "Failed to record Loadsmart's bid");
    }
  }

  /** Checks the bid's truck on VAHAN when it has a number not checked yet, and records the
   *  verdict on the bid — a failed truck keeps Accept off. */
  private async checkBidTruck(bid: LoadBidEntity): Promise<LoadBidEntity> {
    if (!bid.vehicleNumber || bid.truckVerified !== null) return bid;
    const check = await this.verification.verifyTruck(
      bid.tenantId,
      bid.loadId,
      bid.vehicleNumber,
      bid.id,
    );
    const truckVerified = truckVerifiedOf(check);
    return truckVerified === null ? bid : this.bidRepository.update(bid, { truckVerified });
  }

  private async assertLoad(tenantId: string, loadId: string): Promise<LoadEntity> {
    const load = await this.loadRepository.findById(tenantId, loadId);
    if (!load) throw new NotFoundError(`Load ${loadId} not found`);
    return load;
  }

  /** When the load went out to transporters — the posting time, or the load's own creation for
   *  a load planned from a requisition. */
  /** When the load went out for bids, and any hours Placement added to its window. */
  private async windowOf(load: LoadEntity): Promise<{ sentAt: Date; extraMinutes: number }> {
    if (!load.postingId) return { sentAt: load.createdAt, extraMinutes: 0 };
    const posting = await this.bidRepository.findPosting(load.tenantId, load.postingId);
    return {
      sentAt: posting?.createdAt ?? load.createdAt,
      extraMinutes: posting?.bidWindowExtraMinutes ?? 0,
    };
  }

  private async assertTruckFree(load: LoadEntity, vehicleNumber: string): Promise<void> {
    const clash = await this.loadRepository.findActiveByVehicleNumber(
      load.tenantId,
      vehicleNumber,
      load.id,
    );
    if (clash) {
      throw new ConflictError(
        `Vehicle ${vehicleNumber} is already on an active load elsewhere (load ${clash.code})`,
      );
    }
  }

  private async expireStale(tenantId: string, bids: LoadBidEntity[], now: Date) {
    const stale = bids.filter(
      (bid) => bid.status === 'received' && effectiveBidStatus(bid, now) === 'expired',
    );
    await this.bidRepository.markExpired(
      tenantId,
      stale.map((bid) => bid.id),
    );
  }

  private toView(bid: LoadBidEntity, now: Date, rank: number | null): BidView {
    const blocker = acceptBlocker(bid, now);
    return {
      id: bid.id,
      source: bid.source,
      highlighted: bid.source === 'loadsmart',
      transporter:
        bid.source === 'loadsmart'
          ? { id: null, name: 'Loadsmart' }
          : { id: bid.transporterId, name: bid.transporter?.name ?? '' },
      rate: bid.rate,
      vehicleNumber: bid.vehicleNumber,
      truckVerified: bid.truckVerified,
      channel: bid.channel,
      status: effectiveBidStatus(bid, now),
      rank,
      canAccept: blocker === null,
      acceptBlocker: blocker,
      enteredBy: bid.enteredBy,
      entryReason: bid.entryReason,
      expiresAt: bid.expiresAt?.toISOString() ?? null,
      createdAt: bid.createdAt.toISOString(),
      counter:
        bid.counterStatus && bid.counterRate && bid.counteredAt
          ? {
              rate: bid.counterRate,
              note: bid.counterNote,
              status: bid.counterStatus,
              at: bid.counteredAt.toISOString(),
              answeredAt: bid.counterAnsweredAt?.toISOString() ?? null,
            }
          : null,
      rejectionReason: bid.rejectionReason,
      history: bid.rateHistory ?? [],
    };
  }

  // --- Counter and reject -----------------------------------------------------------------

  /** The shipper counters a live bid with a rate of their own. It waits for the bidder's answer
   *  (Accept stays off meanwhile); a new counter replaces one still waiting. */
  async counterBid(
    tenantId: string,
    actorId: string,
    loadId: string,
    bidId: string,
    input: CounterBidInput,
  ): Promise<BidView> {
    try {
      const { load, bid, now } = await this.assertLiveBid(tenantId, loadId, bidId);
      const rate = String(input.rate);
      if (Number(rate) === Number(bid.rate)) {
        throw new ValidationError('The counter is the same as the bid — accept the bid instead');
      }
      const updated = await this.bidRepository.update(bid, {
        counterRate: rate,
        counterNote: input.note?.trim() || null,
        counterStatus: 'pending',
        counteredAt: now,
        counteredBy: actorId,
        counterAnsweredAt: null,
        counterAnsweredBy: null,
        rateHistory: [
          ...(bid.rateHistory ?? []),
          { at: now.toISOString(), by: actorId, kind: 'counter', rate },
        ] as never,
      });
      await this.bidStep(load, actorId, 'BID_COUNTERED', bid, { counterRate: rate });
      if (bid.source === 'loadsmart') await this.onLoadsmartBidCountered?.(updated, load);
      return this.toView(updated, now, null);
    } catch (error) {
      rethrow(error, 'Failed to counter the bid');
    }
  }

  /** The bidder's answer to the counter. A transporter answers by phone and the shipper records
   *  it; Loadsmart's own bid is answered by Placement on the console (`asLoadsmart`). Accepted:
   *  the counter becomes the bid's rate. */
  async answerCounter(
    tenantId: string,
    actorId: string,
    loadId: string,
    bidId: string,
    input: CounterAnswerInput,
    asLoadsmart = false,
  ): Promise<BidView> {
    try {
      const { load, bid, now } = await this.assertLiveBid(tenantId, loadId, bidId);
      if (bid.counterStatus !== 'pending' || !bid.counterRate) {
        throw new ConflictError('There is no counter waiting for an answer on this bid');
      }
      if ((bid.source === 'loadsmart') !== asLoadsmart) {
        throw new ConflictError(
          bid.source === 'loadsmart'
            ? 'Loadsmart answers a counter on its own bid from the console'
            : "Only the shipper records a transporter's answer",
        );
      }
      const rate = bid.counterRate;
      const updated = await this.bidRepository.update(bid, {
        counterStatus: input.accepted ? 'accepted' : 'declined',
        counterAnsweredAt: now,
        counterAnsweredBy: actorId,
        ...(input.accepted ? { rate } : {}),
        rateHistory: [
          ...(bid.rateHistory ?? []),
          {
            at: now.toISOString(),
            by: actorId,
            kind: input.accepted ? 'counter_accepted' : 'counter_declined',
            rate: input.accepted ? rate : bid.rate,
          },
        ] as never,
      });
      await this.bidStep(load, actorId, 'BID_COUNTER_ANSWERED', bid, {
        accepted: input.accepted,
        rate: updated.rate,
      });
      return this.toView(updated, now, null);
    } catch (error) {
      rethrow(error, 'Failed to record the answer to the counter');
    }
  }

  /** The shipper rejects a live bid. Rejecting Loadsmart's bid lets Placement send another. */
  async rejectBid(
    tenantId: string,
    actorId: string,
    loadId: string,
    bidId: string,
    reason?: string,
  ): Promise<BidView> {
    try {
      const { load, bid, now } = await this.assertLiveBid(tenantId, loadId, bidId);
      await this.bidRepository.markRejected(bid, actorId);
      const updated = await this.bidRepository.update(bid, {
        rejectionReason: reason?.trim() || null,
      });
      await this.bidStep(load, actorId, 'BID_REJECTED', bid, { reason: reason ?? null });
      if (bid.source === 'loadsmart') await this.onLoadsmartBidRejected?.(updated, load);
      return this.toView(updated, now, null);
    } catch (error) {
      rethrow(error, 'Failed to reject the bid');
    }
  }

  /** One bid as stored — the Loadsmart ops module reads its partner bid from it. */
  findBid(tenantId: string, loadId: string, bidId: string): Promise<LoadBidEntity | null> {
    return this.bidRepository.findById(tenantId, loadId, bidId);
  }

  private async assertLiveBid(tenantId: string, loadId: string, bidId: string) {
    const load = await this.assertLoad(tenantId, loadId);
    if (load.status !== 'bids_received' || load.awardedBidId) {
      throw new ConflictError('Bids are countered or rejected only before one is accepted');
    }
    const bid = await this.bidRepository.findById(tenantId, loadId, bidId);
    if (!bid) throw new NotFoundError(`Bid ${bidId} not found on load ${loadId}`);
    const now = this.now();
    const status = effectiveBidStatus(bid, now);
    if (status !== 'received') throw new ConflictError(`This bid is ${status}`);
    return { load, bid, now };
  }

  private async bidStep(
    load: LoadEntity,
    actorId: string,
    action: 'BID_COUNTERED' | 'BID_COUNTER_ANSWERED' | 'BID_REJECTED',
    bid: LoadBidEntity,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.loadActivityService.record(load.tenantId, load.id, actorId, action, null, bid.id, {
      bidId: bid.id,
      source: bid.source,
      transporterId: bid.transporterId,
      bidRate: bid.rate,
      ...metadata,
    });
    await this.auditService.log({
      tenantId: load.tenantId,
      userId: actorId,
      action:
        action === 'BID_COUNTERED'
          ? 'LOAD_BID_COUNTERED'
          : action === 'BID_REJECTED'
            ? 'LOAD_BID_REJECTED'
            : 'LOAD_BID_COUNTER_ANSWERED',
      resourceType: 'load_bid',
      newData: { id: bid.id, loadId: load.id, ...metadata },
    });
  }

  /** The shipper's bid list — live bids ranked best first, then the decided/expired ones. */
  async listForLoad(tenantId: string, loadId: string): Promise<LoadBidsView> {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      const now = this.now();
      const bids = await this.bidRepository.listByLoad(tenantId, loadId);
      await this.expireStale(tenantId, bids, now);

      const ranked = rankBids(bids, now);
      const rest = bids.filter((bid) => !ranked.includes(bid));
      return {
        loadId,
        loadStatus: load.status,
        biddingClosesAt:
          load.postingType === 'market_fleet'
            ? await this.windowOf(load).then((window) =>
                bidWindowClosesAt(window.sentAt, window.extraMinutes).toISOString(),
              )
            : null,
        bids: [
          ...ranked.map((bid, index) => this.toView(bid, now, index + 1)),
          ...rest.map((bid) => this.toView(bid, now, null)),
        ],
      };
    } catch (error) {
      rethrow(error, 'Failed to list bids');
    }
  }

  /** The shipper types in a rate one of their transporters gave by phone — allowed from 30
   *  minutes after the load was sent until bidding closes at 4 hours, with a reason. A transporter
   *  quoting again revises its live bid. */
  async recordBid(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: RecordBidInput,
  ): Promise<BidView> {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      if (load.postingType === 'indent') {
        throw new ConflictError(
          "An indent has no bidding — record the contracted transporter's acceptance instead",
        );
      }
      if (load.postingType !== 'market_fleet') {
        throw new ConflictError('Only market fleet loads take bids');
      }
      if (load.status !== 'created' && load.status !== 'bids_received') {
        throw new ConflictError('This load already has a truck — it no longer takes bids');
      }

      const now = this.now();
      const { sentAt, extraMinutes } = await this.windowOf(load);
      const timingError = manualRateError(sentAt, now, extraMinutes);
      if (timingError) throw new ConflictError(timingError);

      await this.transporterService.getTransporter(tenantId, input.transporterId);
      let recipientId: string | null = null;
      if (load.postingId) {
        const recipient = await this.bidRepository.findTransporterRecipient(
          tenantId,
          load.postingId,
          input.transporterId,
        );
        if (!recipient) throw new ConflictError("This load wasn't sent to that transporter");
        recipientId = recipient.id;
      }

      const vehicleNumber = input.vehicleNumber ? normalizePlate(input.vehicleNumber) : null;
      if (vehicleNumber) await this.assertTruckFree(load, vehicleNumber);

      const rate = String(input.rate);
      const live = await this.bidRepository.findLive(tenantId, loadId, input.transporterId);
      const step = {
        at: now.toISOString(),
        by: actorId,
        kind: live ? ('revised' as const) : ('bid' as const),
        rate,
      };
      const saved = live
        ? await this.bidRepository.update(live, {
            rate,
            rateHistory: [...(live.rateHistory ?? []), step] as never,
            // A new rate from the transporter replaces any counter still waiting.
            ...(live.counterStatus === 'pending' ? { counterStatus: null, counterRate: null } : {}),
            vehicleNumber: vehicleNumber ?? live.vehicleNumber,
            truckVerified:
              vehicleNumber && vehicleNumber !== live.vehicleNumber ? null : live.truckVerified,
            enteredBy: actorId,
            entryReason: input.reason,
          })
        : await this.bidRepository.create({
            tenantId,
            loadId,
            recipientId,
            source: 'transporter',
            lsPartnerBidId: null,
            transporterId: input.transporterId,
            rate,
            vehicleNumber,
            channel: 'web',
            expiresAt: bidWindowClosesAt(sentAt, extraMinutes),
            enteredBy: actorId,
            entryReason: input.reason,
            rateHistory: [step],
          });
      const bid = await this.checkBidTruck(saved);

      await this.recordBidActivity(load, actorId, bid, { revised: Boolean(live) });
      return this.toView(bid, now, null);
    } catch (error) {
      rethrow(error, 'Failed to record bid');
    }
  }

  /** The transporter's own WhatsApp reply (Accept at the target rate, or a typed rate). Same bid
   *  as a web quote, with channel `whatsapp` and no entering user. Unlike a phone rate the shipper
   *  types in there is no 30-minute wait — the transporter is quoting directly — but the 4-hour
   *  window still applies. A transporter quoting again revises its live bid; the truck number is
   *  still asked for and entered as today (setBidTruck). */
  async recordWhatsappBid(
    tenantId: string,
    loadId: string,
    input: WhatsappBidInput,
  ): Promise<BidView> {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      if (load.postingType !== 'market_fleet')
        throw new ConflictError('Only market fleet loads take bids');
      if (load.status !== 'created' && load.status !== 'bids_received') {
        throw new ConflictError('This load already has a truck — it no longer takes bids');
      }
      const now = this.now();
      const sentAt = await this.sentAtOf(load);
      const closesAt = bidWindowClosesAt(sentAt);
      if (now >= closesAt) throw new ConflictError('Bidding on this load has closed');

      let recipientId: string | null = null;
      if (load.postingId) {
        const recipient = await this.bidRepository.findTransporterRecipient(
          tenantId,
          load.postingId,
          input.transporterId,
        );
        if (!recipient) throw new ConflictError("This load wasn't sent to that transporter");
        recipientId = recipient.id;
      }
      const vehicleNumber = input.vehicleNumber ? normalizePlate(input.vehicleNumber) : null;
      if (vehicleNumber) await this.assertTruckFree(load, vehicleNumber);
      const live = await this.bidRepository.findLive(tenantId, loadId, input.transporterId);
      if (!live && input.rate === undefined) {
        throw new ConflictError('The truck number came before any rate for this load');
      }
      const rate = input.rate === undefined ? live!.rate : String(input.rate);
      const rateChanged = !live || rate !== live.rate;
      // No entering user: the transporter quoted on WhatsApp (channel `whatsapp`).
      const step = {
        at: now.toISOString(),
        by: null,
        kind: live ? ('revised' as const) : ('bid' as const),
        rate,
      };
      const saved = live
        ? await this.bidRepository.update(live, {
            rate,
            ...(rateChanged
              ? {
                  rateHistory: [...(live.rateHistory ?? []), step] as never,
                  // A new rate from the transporter replaces any counter still waiting.
                  ...(live.counterStatus === 'pending'
                    ? { counterStatus: null, counterRate: null }
                    : {}),
                }
              : {}),
            vehicleNumber: vehicleNumber ?? live.vehicleNumber,
            truckVerified:
              vehicleNumber && vehicleNumber !== live.vehicleNumber ? null : live.truckVerified,
          })
        : await this.bidRepository.create({
            tenantId,
            loadId,
            recipientId,
            source: 'transporter',
            lsPartnerBidId: null,
            transporterId: input.transporterId,
            rate,
            vehicleNumber,
            channel: 'whatsapp',
            expiresAt: closesAt,
            enteredBy: null,
            entryReason: 'Quoted by the transporter on WhatsApp',
            rateHistory: [step],
          });
      // The truck is checked on VAHAN at once, as for a web bid ("Vahan runs at once").
      const bid = await this.checkBidTruck(saved);
      await this.recordBidActivity(load, null, bid, {
        revised: Boolean(live),
        channel: 'whatsapp',
      });
      return this.toView(bid, now, null);
    } catch (error) {
      rethrow(error, 'Failed to record the WhatsApp bid');
    }
  }

  /** The transporter's live bid on a load, if any (expired ones excluded). */
  async findLiveTransporterBid(
    tenantId: string,
    loadId: string,
    transporterId: string,
  ): Promise<LoadBidEntity | null> {
    const live = await this.bidRepository.findLive(tenantId, loadId, transporterId);
    return live && effectiveBidStatus(live, this.now()) === 'received' ? live : null;
  }

  /** "Ask for the number" — the transporter's truck number arrives after its rate. */
  async setBidTruck(
    tenantId: string,
    actorId: string,
    loadId: string,
    bidId: string,
    vehicleNumberInput: string,
  ): Promise<BidView> {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      const bid = await this.bidRepository.findById(tenantId, loadId, bidId);
      if (!bid) throw new NotFoundError(`Bid ${bidId} not found on load ${loadId}`);
      const now = this.now();
      if (effectiveBidStatus(bid, now) !== 'received') {
        throw new ConflictError(`This bid is ${effectiveBidStatus(bid, now)}`);
      }
      const vehicleNumber = normalizePlate(vehicleNumberInput);
      await this.assertTruckFree(load, vehicleNumber);
      const updated = await this.checkBidTruck(
        await this.bidRepository.update(bid, { vehicleNumber, truckVerified: null }),
      );
      await this.loadActivityService.record(tenantId, loadId, actorId, 'BID_RECORDED', null, null, {
        bidId,
        transporterId: bid.transporterId,
        vehicleNumber,
        truckAdded: true,
      });
      return this.toView(updated, now, null);
    } catch (error) {
      rethrow(error, 'Failed to set the bid truck');
    }
  }

  /** The contracted transporter accepts the indent and sends the truck number, at the contract
   *  rate — or the shipper enters an acceptance given by phone. That is the award: the load moves
   *  to Bids received on the indent route (`indent_accepted`), and the memo follows. */
  async recordIndentAcceptance(
    tenantId: string,
    actorId: string | null,
    loadId: string,
    vehicleNumberInput: string,
    /** `whatsapp` when the contracted transporter accepted on WhatsApp (no entering user). */
    channel: BidChannel = 'web',
  ): Promise<BidView> {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      if (load.postingType !== 'indent') throw new ConflictError('This load is not an indent');
      if (load.status !== 'created') {
        throw new ConflictError('The indent has already been accepted');
      }
      if (!load.transporterId || !load.freightValue) {
        throw new ConflictError('This indent has no contracted transporter or contract rate');
      }

      let recipientId: string | null = null;
      if (load.postingId) {
        const recipient = await this.bidRepository.findTransporterRecipient(
          tenantId,
          load.postingId,
          load.transporterId,
        );
        recipientId = recipient?.id ?? null;
      }
      const vehicleNumber = normalizePlate(vehicleNumberInput);
      await this.assertTruckFree(load, vehicleNumber);

      const created = await this.bidRepository.create({
        tenantId,
        loadId,
        recipientId,
        source: 'transporter',
        lsPartnerBidId: null,
        transporterId: load.transporterId,
        rate: load.freightValue,
        vehicleNumber,
        channel,
        expiresAt: null,
        enteredBy: actorId,
        entryReason:
          channel === 'whatsapp'
            ? 'Indent accepted by the contracted transporter on WhatsApp'
            : 'Indent accepted by the contracted transporter',
      });
      const bid = await this.checkBidTruck(created);
      await this.stageService.transition({
        tenantId,
        loadId,
        trigger: 'indent_accepted',
        actorId,
        load,
        auditAction: 'LOAD_BID_ACCEPTED',
        fields: {
          vehicleNumber,
          freightType: load.freightType ?? 'flat',
          awardedBidId: bid.id,
        },
        metadata: { bidId: bid.id, transporterId: bid.transporterId, rate: bid.rate },
      });
      await this.bidRepository.accept(bid, actorId);
      await this.recordBidActivity(load, actorId, bid, { indent: true });
      return this.toView({ ...bid, status: 'accepted' }, this.now(), 1);
    } catch (error) {
      rethrow(error, 'Failed to record indent acceptance');
    }
  }

  /** The contracted transporter rejected the indent — recorded by the shipper. "The load goes to
   *  the open market (Loadsmart included) and the contract's non-placement penalty applies, if
   *  any": the load becomes a market load at Created (`indent_rejected`), the contract rate is
   *  kept as the expected price, the shipper's active transporters become recipients and Loadsmart
   *  opens its sourcing. The change and the penalty are kept in load_route_changes. */
  async recordIndentRejection(
    tenantId: string,
    actorId: string,
    loadId: string,
    reason: string,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      if (load.postingType !== 'indent') throw new ConflictError('This load is not an indent');
      if (load.status !== 'created') {
        throw new ConflictError('The indent was already accepted');
      }
      const posting = load.postingId
        ? await this.bidRepository.findPosting(tenantId, load.postingId)
        : null;
      const contractId = posting?.contractId ?? null;
      const penalty = contractId
        ? await this.bidRepository.findContractPenalty(tenantId, contractId)
        : null;

      const updated = await this.stageService.transition({
        tenantId,
        loadId,
        trigger: 'indent_rejected',
        actorId,
        load,
        auditAction: 'LOAD_INDENT_REJECTED',
        fields: {
          transporterId: null,
          freightValue: null,
          expectedRate: load.expectedRate ?? load.freightValue,
        },
        metadata: { reason, contractId, penalty },
      });
      await this.bidRepository.recordRouteChange({
        tenantId,
        loadId,
        fromPostingType: 'indent',
        toPostingType: 'market_fleet',
        reason,
        contractId,
        transporterId: load.transporterId,
        penaltyAmount: penalty,
        changedBy: actorId,
      });
      const recipients = load.postingId
        ? await this.bidRepository.addTransporterRecipients(tenantId, load.postingId)
        : 0;
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'INDENT_REJECTED',
        'indent',
        'market_fleet',
        { reason, transporterId: load.transporterId, penalty, recipientsAdded: recipients },
      );
      // "Loadsmart included" — Loadsmart opens its sourcing as for any market post.
      await this.postingHooks.onMarketLoadsPosted?.([updated], actorId);
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to record the indent rejection');
    }
  }

  private async recordBidActivity(
    load: LoadEntity,
    actorId: string | null,
    bid: LoadBidEntity,
    extra: Record<string, unknown>,
  ): Promise<void> {
    const metadata = {
      bidId: bid.id,
      transporterId: bid.transporterId,
      rate: bid.rate,
      vehicleNumber: bid.vehicleNumber,
      reason: bid.entryReason,
      ...extra,
    };
    // The first bid on a market load moves it to Bids received. An indent's acceptance already
    // moved it (indent_accepted).
    if (load.status === 'created' && load.postingType === 'market_fleet') {
      await this.stageService.transition({
        tenantId: load.tenantId,
        loadId: load.id,
        trigger: 'first_bid',
        actorType: bid.source === 'loadsmart' ? 'ls_team' : 'shipper',
        actorId,
        load,
        metadata,
      });
    }
    await this.loadActivityService.record(
      load.tenantId,
      load.id,
      actorId,
      'BID_RECORDED',
      null,
      null,
      metadata,
    );
    await this.auditService.log({
      tenantId: load.tenantId,
      userId: actorId,
      action: 'LOAD_BID_RECORDED',
      resourceType: 'load_bid',
      newData: { id: bid.id, loadId: load.id, ...metadata },
    });
  }

  /** The shipper accepts a bid — only a live bid with a truck that hasn't failed its check, and
   *  only once per load. The load stays at Bids received with the award on it
   *  (`transporter_awarded`, or `loadsmart_awarded` for Loadsmart's bid) and the load's other live
   *  bids are rejected; the accepted load memo moves it to Truck assigned. */
  async acceptBid(
    tenantId: string,
    actorId: string,
    loadId: string,
    bidId: string,
  ): Promise<LoadEntity> {
    try {
      const load = await this.assertLoad(tenantId, loadId);
      if (load.status !== 'bids_received') {
        throw new ConflictError('Only a load with bids received can have a bid accepted');
      }
      if (load.awardedBidId) throw new ConflictError('A bid is already accepted on this load');
      const bid = await this.bidRepository.findById(tenantId, loadId, bidId);
      if (!bid) throw new NotFoundError(`Bid ${bidId} not found on load ${loadId}`);

      const now = this.now();
      const blocker = acceptBlocker(bid, now);
      if (blocker) {
        await this.expireStale(tenantId, [bid], now);
        throw new ConflictError(blocker);
      }
      await this.assertTruckFree(load, bid.vehicleNumber!);

      const toLoadsmart = bid.source === 'loadsmart';
      const awarded = await this.stageService.transition({
        tenantId,
        loadId,
        trigger: toLoadsmart ? 'loadsmart_awarded' : 'transporter_awarded',
        actorId,
        load,
        auditAction: 'LOAD_BID_ACCEPTED',
        fields: {
          transporterId: bid.transporterId,
          vehicleNumber: bid.vehicleNumber,
          freightValue: bid.rate,
          freightType: load.freightType ?? 'flat',
          driverName: null,
          driverNumber: null,
          awardedBidId: bid.id,
        },
        metadata: { bidId, transporterId: bid.transporterId, rate: bid.rate },
      });
      await this.bidRepository.accept(bid, actorId);
      await this.bidRepository.rejectOthers(tenantId, loadId, bid.id, actorId);
      if (toLoadsmart) await this.onLoadsmartBidAccepted?.(bid, awarded, actorId);
      await this.loadActivityService.record(
        tenantId,
        loadId,
        actorId,
        'BID_ACCEPTED',
        null,
        bid.id,
        { transporterId: bid.transporterId, rate: bid.rate, vehicleNumber: bid.vehicleNumber },
      );
      // LS_N_0016 — truck assigned through the accepted bid. The bid's truck is typed in by the
      // transporter and its driver is named later (load memo), so neither was checked against
      // the masters.
      await this.onLoadEvent?.({
        kind: 'assigned',
        tenantId,
        loadId,
        at: now,
        vehicleChecked: false,
        driverChecked: false,
      });
      return awarded;
    } catch (error) {
      rethrow(error, 'Failed to accept bid');
    }
  }
}
