import { ConflictError, NotFoundError, rethrow } from '../../../shared/errors';
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
  LoadBidsView,
  LoadsmartBidAcceptedHook,
  LoadsmartBidInput,
  RecordBidInput,
} from '../utils/load-bid.interface';
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
 * Until WhatsApp arrives (Phase 4), bids reach this service through the shipper's web entry.
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
      const closesAt = bidWindowClosesAt(await this.sentAtOf(load));
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
  private async sentAtOf(load: LoadEntity): Promise<Date> {
    if (!load.postingId) return load.createdAt;
    const posting = await this.bidRepository.findPosting(load.tenantId, load.postingId);
    return posting?.createdAt ?? load.createdAt;
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
    };
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
            ? bidWindowClosesAt(await this.sentAtOf(load)).toISOString()
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
      const sentAt = await this.sentAtOf(load);
      const timingError = manualRateError(sentAt, now);
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
      const saved = live
        ? await this.bidRepository.update(live, {
            rate,
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
            expiresAt: bidWindowClosesAt(sentAt),
            enteredBy: actorId,
            entryReason: input.reason,
          });
      const bid = await this.checkBidTruck(saved);

      await this.recordBidActivity(load, actorId, bid, { revised: Boolean(live) });
      return this.toView(bid, now, null);
    } catch (error) {
      rethrow(error, 'Failed to record bid');
    }
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
    actorId: string,
    loadId: string,
    vehicleNumberInput: string,
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
        channel: 'web',
        expiresAt: null,
        enteredBy: actorId,
        entryReason: 'Indent accepted by the contracted transporter',
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
    actorId: string,
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
