import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { SALES_ROLE } from '../../shared/constants/roles';
import { LoadActivityService } from '../loads/load-activity.service';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadBidEntity } from '../loads/bids/load-bid.entity';
import { LoadBidService } from '../loads/bids/load-bid.service';
import { LoadMemoService } from '../loads/memo/load-memo.service';
import { LoadService } from '../loads/load.service';
import { LoadStageService } from '../loads/load-stage.service';
import { hasLoadingPapers } from '../loads/utils/load-stages';
import {
  LoadVerificationService,
  truckVerifiedOf,
} from '../loads/verification/load-verification.service';
import { LsPartnerBidEntity } from './entities/ls-partner-bid.entity';
import { LsPartnerEntity } from './entities/ls-partner.entity';
import { LsSourcingEntity } from './entities/ls-sourcing.entity';
import { LsPartnerPaymentEntity } from './entities/ls-partner-payment.entity';
import { LoadsmartRepository } from './loadsmart.repository';
import {
  DEFAULT_MARGIN_PERCENT,
  DEFAULT_TDS_PERCENT,
  DEFAULT_TRUCKER_ADVANCE_PERCENT,
  MIN_MARGIN_PERCENT,
  PARTNER_CALL_AFTER_MS,
} from './loadsmart.types';
import {
  effectiveMarginPercent,
  marginError,
  missingSourcingFields,
  partnerAdvance,
  partnerTargetRate,
  shipperPriceFor,
} from './loadsmart-rules';
import { LsServiceBase } from './ls-base';
import { NameDriverInput } from '../loads/utils/load-memo.interface';
import {
  ApprovePapersInput,
  ApproveSourcingInput,
  ApproveVerificationInput,
  CommercialTermsInput,
  LoadBoardRow,
  LoadsmartActor,
  PartnerBidInput,
  PartnerBidView,
  PartnerInput,
  PlacementView,
  SendBidInput,
  UtrInput,
} from './loadsmart.interface';

const normalizePlate = (value: string) => value.replace(/\s+/g, '').toUpperCase();

/**
 * Loadsmart load, part 1 — posting to loaded, run by the ops console:
 * - every market posting opens a sourcing with the shipper's margin and trucker advance;
 * - the Approval team posts it on the load board (partners see the rate with the margin out);
 * - Placement records partner bids (never from salespeople), calls the ones who haven't bid in
 *   5 minutes, and sends the shipper one best bid as Loadsmart's — no partner name, priced with
 *   the margin, a note required under 6%;
 * - once the shipper accepts it, Placement names the partner's driver, the Verification team
 *   approves truck and driver, and the memo goes out;
 * - the Tracking team marks the truck, uploads papers for the driver and approves them (the
 *   e-way bill must name Loadsmart) — only then is the load Loaded;
 * - charges are raised for the shipper to approve, and the team lead releases the partner's
 *   advance less TDS.
 * WhatsApp to partners and the shipper is out of scope until a provider is wired in.
 */
export class LsSourcingService extends LsServiceBase {
  constructor(
    repository: LoadsmartRepository,
    loadActivityService: LoadActivityService,
    auditService: AuditService,
    private readonly loadService: LoadService,
    private readonly stageService: LoadStageService,
    private readonly bidService: LoadBidService,
    private readonly memoService: LoadMemoService,
    private readonly verification: LoadVerificationService,
    now?: () => Date,
  ) {
    super(repository, loadActivityService, auditService, now);
  }

  // --- Partners and commercial terms -------------------------------------------------------

  listPartners(): Promise<LsPartnerEntity[]> {
    return this.repository.partners.find({ order: { name: 'ASC' } });
  }

  async savePartner(actorId: string, input: PartnerInput, id?: string): Promise<LsPartnerEntity> {
    try {
      const data = {
        name: input.name,
        phone: input.phone,
        partnerType: input.partnerType,
        ...(input.status ? { status: input.status } : {}),
        tdsPercent: String(input.tdsPercent ?? DEFAULT_TDS_PERCENT),
        bankAccountNumber: input.bankAccountNumber ?? null,
        bankIfsc: input.bankIfsc ?? null,
        upiId: input.upiId ?? null,
      };
      let partner: LsPartnerEntity;
      if (id) {
        const existing = await this.repository.partners.findOneBy({ id });
        if (!existing) throw new NotFoundError(`Partner ${id} not found`);
        await this.repository.partners.update({ id }, data);
        partner = (await this.repository.partners.findOneBy({ id }))!;
      } else {
        partner = await this.repository.partners.save(
          this.repository.partners.create({ ...data, createdBy: actorId }),
        );
      }
      await this.auditService.log({
        tenantId: null,
        userId: actorId,
        action: 'LS_PARTNER_SAVED',
        resourceType: 'ls_partner',
        newData: { id: partner.id, name: partner.name, partnerType: partner.partnerType },
      });
      return partner;
    } catch (error) {
      rethrow(error, 'Failed to save the partner');
    }
  }

  async getTerms(tenantId: string) {
    const terms = await this.repository.terms.findOneBy({ tenantId });
    return {
      tenantId,
      marginPercent: Number(terms?.marginPercent ?? DEFAULT_MARGIN_PERCENT),
      truckerAdvancePercent: Number(
        terms?.truckerAdvancePercent ?? DEFAULT_TRUCKER_ADVANCE_PERCENT,
      ),
      isDefault: !terms,
    };
  }

  async saveTerms(actorId: string, tenantId: string, input: CommercialTermsInput) {
    try {
      await this.repository.terms.save({
        tenantId,
        marginPercent: String(input.marginPercent),
        truckerAdvancePercent: String(input.truckerAdvancePercent),
        updatedBy: actorId,
      });
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LS_TERMS_SAVED',
        resourceType: 'ls_sourcing',
        newData: { tenantId, ...input },
      });
      return this.getTerms(tenantId);
    } catch (error) {
      rethrow(error, 'Failed to save the commercial terms');
    }
  }

  // --- 1–3 · Readies the load, Approval posts it -------------------------------------------

  /** Posting hook: "Readies the load — adds the margin and the trucker advance from the masters
   *  and flags anything missing." One sourcing per market load (truck). */
  createForLoads = async (loads: LoadEntity[]): Promise<void> => {
    for (const load of loads) {
      if (load.sourceType !== 'market') continue;
      const existing = await this.repository.sourcings.findOneBy({ loadId: load.id });
      if (existing) continue;
      const terms = await this.getTerms(load.tenantId);
      const posting = load.postingId
        ? await this.repository.findPosting(load.tenantId, load.postingId)
        : null;
      await this.repository.sourcings.save(
        this.repository.sourcings.create({
          tenantId: load.tenantId,
          loadId: load.id,
          status: 'pending_approval',
          marginPercent: String(terms.marginPercent),
          truckerAdvancePercent: String(terms.truckerAdvancePercent),
          missingFields: missingSourcingFields(posting),
        }),
      );
    }
  };

  approvalQueue(): Promise<LsSourcingEntity[]> {
    return this.repository.listSourcings(['pending_approval']);
  }

  /** "Checks the load is complete and real, then posts it on the load board." Anything flagged
   *  missing has to be acknowledged. */
  async approve(
    actorId: string,
    sourcingId: string,
    input: ApproveSourcingInput,
  ): Promise<LsSourcingEntity> {
    try {
      const sourcing = await this.assertSourcing(sourcingId);
      if (sourcing.status !== 'pending_approval') {
        throw new ConflictError(`This load is already ${sourcing.status.replace('_', ' ')}`);
      }
      if (sourcing.load.status !== 'created' && sourcing.load.status !== 'bids_received') {
        throw new ConflictError('The shipper has already assigned a truck to this load');
      }
      if (sourcing.missingFields.length && !input.acknowledgeMissing) {
        throw new ValidationError(
          `This load is missing: ${sourcing.missingFields.join(', ')}. Acknowledge to post it anyway`,
        );
      }
      const marginPercent = input.marginPercent ?? Number(sourcing.marginPercent);
      const posting = sourcing.load.postingId
        ? await this.repository.findPosting(sourcing.tenantId, sourcing.load.postingId)
        : null;
      const target = posting?.rate ? Number(posting.rate) : null;
      const partnerRate = partnerTargetRate(target, marginPercent);
      const updated = await this.repository.updateSourcing(sourcingId, {
        status: 'posted',
        marginPercent: String(marginPercent),
        truckerAdvancePercent: String(
          input.truckerAdvancePercent ?? Number(sourcing.truckerAdvancePercent),
        ),
        partnerTargetRate: partnerRate === null ? null : String(partnerRate),
        approvedBy: actorId,
        postedAt: this.now(),
      });
      await this.step(updated, actorId, 'posted_on_load_board', 'LS_SOURCING_APPROVED', {
        marginPercent,
        partnerTargetRate: partnerRate,
      });
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to approve the load');
    }
  }

  async reject(actorId: string, sourcingId: string, reason: string): Promise<LsSourcingEntity> {
    try {
      const sourcing = await this.assertSourcing(sourcingId);
      if (sourcing.status !== 'pending_approval') {
        throw new ConflictError('Only a load waiting for approval can be rejected');
      }
      const updated = await this.repository.updateSourcing(sourcingId, {
        status: 'cancelled',
        rejectionReason: reason,
        approvedBy: actorId,
      });
      await this.step(updated, actorId, 'rejected_by_approval', 'LS_SOURCING_REJECTED', { reason });
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to reject the load');
    }
  }

  /** "Partners see the load — with Loadsmart's margin taken out." */
  async loadBoard(): Promise<LoadBoardRow[]> {
    const sourcings = await this.repository.listSourcings(
      ['posted', 'bid_sent'],
      ['created', 'bids_received'],
    );
    const rows: LoadBoardRow[] = [];
    for (const sourcing of sourcings) {
      const posting = sourcing.load.postingId
        ? await this.repository.findPosting(sourcing.tenantId, sourcing.load.postingId)
        : null;
      rows.push({
        sourcingId: sourcing.id,
        loadCode: sourcing.load.code,
        partnerRate: sourcing.partnerTargetRate,
        pickupAt: posting?.pickupAt?.toISOString() ?? null,
        route: {
          from: posting?.pickupAddress?.city ?? null,
          to: posting?.dropAddress?.city ?? null,
        },
        truckTypeId: sourcing.load.truckTypeId,
        weightTonnes: sourcing.load.plannedCapacityTonnes,
      });
    }
    return rows;
  }

  // --- 4–7 · Partner bids and Placement ----------------------------------------------------

  /** Placement records a partner's rate and truck. "Bids from salespeople are not taken." The
   *  truck is checked on VAHAN straight away. */
  async recordPartnerBid(
    actor: LoadsmartActor,
    sourcingId: string,
    input: PartnerBidInput,
  ): Promise<PartnerBidView> {
    try {
      if (actor.role === SALES_ROLE) throw new ConflictError('Bids from salespeople are not taken');
      const sourcing = await this.assertSourcing(sourcingId);
      if (sourcing.status !== 'posted' && sourcing.status !== 'bid_sent') {
        throw new ConflictError('This load is not on the load board');
      }
      const partner = await this.repository.partners.findOneBy({ id: input.partnerId });
      if (!partner || partner.status !== 'active') throw new NotFoundError('Partner not found');

      const vehicleNumber = input.vehicleNumber ? normalizePlate(input.vehicleNumber) : null;
      let truckVerified: boolean | null = null;
      if (vehicleNumber) {
        const check = await this.verification.verifyTruck(
          sourcing.tenantId,
          sourcing.loadId,
          vehicleNumber,
        );
        truckVerified = truckVerifiedOf(check);
      }
      const live = await this.repository.partnerBids.findOneBy({
        sourcingId,
        partnerId: input.partnerId,
        status: 'received',
      });
      const saved = live
        ? await this.repository.partnerBids.save({
            ...live,
            rate: String(input.rate),
            vehicleNumber: vehicleNumber ?? live.vehicleNumber,
            truckVerified: vehicleNumber ? truckVerified : live.truckVerified,
            enteredBy: actor.id,
          })
        : await this.repository.partnerBids.save(
            this.repository.partnerBids.create({
              sourcingId,
              partnerId: input.partnerId,
              rate: String(input.rate),
              vehicleNumber,
              truckVerified,
              enteredBy: actor.id,
            }),
          );
      await this.step(sourcing, actor.id, 'partner_bid', 'LS_PARTNER_BID_RECORDED', {
        partnerBidId: saved.id,
        partnerId: partner.id,
        rate: input.rate,
        vehicleNumber,
        truckVerified,
      });
      return this.partnerBidView({ ...saved, partner }, Number(sourcing.marginPercent));
    } catch (error) {
      rethrow(error, 'Failed to record the partner bid');
    }
  }

  private partnerBidView(bid: LsPartnerBidEntity, marginPercent: number): PartnerBidView {
    return {
      id: bid.id,
      partner: { id: bid.partner.id, name: bid.partner.name, partnerType: bid.partner.partnerType },
      rate: bid.rate,
      vehicleNumber: bid.vehicleNumber,
      truckVerified: bid.truckVerified,
      status: bid.status,
      shipperPrice: shipperPriceFor(Number(bid.rate), marginPercent),
      createdAt: bid.createdAt.toISOString(),
    };
  }

  /** Placement's view of one load: partner bids ranked (a truck that can go first, then the
   *  lowest rate) and the partners to call. */
  async placement(sourcingId: string): Promise<PlacementView> {
    const sourcing = await this.assertSourcing(sourcingId);
    const bids = await this.repository.listPartnerBids(sourcingId);
    const usable = (bid: LsPartnerBidEntity) =>
      Boolean(bid.vehicleNumber) && bid.truckVerified !== false;
    const ranked = [...bids].sort(
      (a, b) =>
        Number(usable(b)) - Number(usable(a)) ||
        Number(a.rate) - Number(b.rate) ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );
    const callDue =
      sourcing.postedAt &&
      this.now().getTime() - sourcing.postedAt.getTime() >= PARTNER_CALL_AFTER_MS;
    const callList = callDue
      ? (await this.repository.partnersWithoutBid(sourcingId)).map((partner) => ({
          id: partner.id,
          name: partner.name,
          phone: partner.phone,
        }))
      : [];
    return {
      sourcing,
      bids: ranked.map((bid) => this.partnerBidView(bid, Number(sourcing.marginPercent))),
      callList,
    };
  }

  placementQueue(): Promise<LsSourcingEntity[]> {
    return this.repository.listSourcings(['posted', 'bid_sent'], ['created', 'bids_received']);
  }

  /** "Sends the shipper one best bid, without the partner's name." Priced at the margin unless
   *  Placement sets the price; under 6% needs the negotiation note. */
  async sendBid(actorId: string, sourcingId: string, input: SendBidInput): Promise<LoadBidEntity> {
    try {
      const sourcing = await this.assertSourcing(sourcingId);
      if (sourcing.status !== 'posted' && sourcing.status !== 'bid_sent') {
        throw new ConflictError('This load is not on the load board');
      }
      const bid = await this.repository.partnerBids.findOne({
        where: { id: input.partnerBidId, sourcingId },
        relations: { partner: true },
      });
      if (!bid || (bid.status !== 'received' && bid.status !== 'sent')) {
        throw new NotFoundError('Partner bid not found');
      }
      if (!bid.vehicleNumber)
        throw new ConflictError('No truck number, no bid — ask the partner for it');
      if (bid.truckVerified === false) {
        throw new ConflictError(
          'The truck failed the govt portal checks — ask the partner for another',
        );
      }
      const partnerRate = Number(bid.rate);
      const price =
        input.shipperPrice ?? shipperPriceFor(partnerRate, Number(sourcing.marginPercent));
      const margin = effectiveMarginPercent(price, partnerRate);
      const error = marginError(margin, MIN_MARGIN_PERCENT, input.negotiationNote);
      if (error) throw new ConflictError(error);

      const loadBid = await this.bidService.recordLoadsmartBid(
        sourcing.tenantId,
        actorId,
        sourcing.loadId,
        {
          rate: String(price),
          vehicleNumber: bid.vehicleNumber,
          truckVerified: bid.truckVerified,
          lsPartnerBidId: bid.id,
        },
      );
      await this.repository.partnerBids.update(
        { sourcingId, status: 'sent' },
        { status: 'received' },
      );
      await this.repository.partnerBids.update({ id: bid.id }, { status: 'sent' });
      const updated = await this.repository.updateSourcing(sourcingId, {
        status: 'bid_sent',
        shipperPrice: String(price),
        effectiveMarginPercent: String(margin),
        negotiationNote: input.negotiationNote ?? null,
        bidSentBy: actorId,
        bidSentAt: this.now(),
      });
      await this.step(updated, actorId, 'bid_sent_to_shipper', 'LS_BID_SENT', {
        partnerBidId: bid.id,
        shipperPrice: price,
        marginPercent: margin,
      });
      return loadBid;
    } catch (error) {
      rethrow(error, "Failed to send Loadsmart's bid");
    }
  }

  /** LoadBidService hook: the shipper accepted Loadsmart's bid — the partner behind it is on
   *  the truck. */
  onLoadsmartBidAccepted = async (bid: LoadBidEntity, load: LoadEntity, actorId: string) => {
    const sourcing = await this.repository.findSourcingByLoad(load.id);
    if (!sourcing || !bid.lsPartnerBidId) return;
    const partnerBid = await this.repository.partnerBids.findOneBy({ id: bid.lsPartnerBidId });
    if (!partnerBid) return;
    await this.repository.partnerBids.update({ id: partnerBid.id }, { status: 'won' });
    await this.repository.markOtherPartnerBidsLost(sourcing.id, partnerBid.id);
    const updated = await this.repository.updateSourcing(sourcing.id, {
      status: 'won',
      partnerId: partnerBid.partnerId,
      partnerBidId: partnerBid.id,
      partnerRate: partnerBid.rate,
    });
    await this.step(updated, actorId, 'bid_won', 'LS_BID_WON', {
      partnerId: partnerBid.partnerId,
      partnerRate: partnerBid.rate,
    });
  };

  /** Another bid won, or the shipper assigned a truck themselves — Loadsmart lost the load. */
  async markLostIfAssignedElsewhere(load: LoadEntity): Promise<void> {
    const sourcing = await this.repository.findSourcingByLoad(load.id);
    if (sourcing && ['pending_approval', 'posted', 'bid_sent'].includes(sourcing.status)) {
      await this.repository.updateSourcing(sourcing.id, { status: 'lost' });
    }
  }

  // --- 9–12 · Driver, Verification, memo ---------------------------------------------------

  /** "Partner names the driver" — name, mobile, licence (checked on Sarathi with the date of
   *  birth), the licence photo front and back, and the RC copy. */
  async nameDriver(
    actorId: string,
    loadId: string,
    input: NameDriverInput & {
      licenceFrontFileKey: string;
      licenceBackFileKey: string;
      rcCopyFileKey: string;
    },
  ) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const { licenceFrontFileKey, licenceBackFileKey, rcCopyFileKey, ...driver } = input;
      const result = await this.memoService.nameDriver(
        sourcing.tenantId,
        actorId,
        loadId,
        driver,
        true,
      );
      await this.repository.updateSourcing(sourcing.id, {
        licenceFrontFileKey,
        licenceBackFileKey,
        rcCopyFileKey,
        driverNamedAt: this.now(),
        verificationApprovedBy: null,
      });
      await this.step(sourcing, actorId, 'driver_named', 'LS_DRIVER_NAMED', {
        driverName: driver.driverName,
        checksClear: result.checks.clear,
      });
      return result;
    } catch (error) {
      rethrow(error, 'Failed to name the driver');
    }
  }

  /** Loads waiting for the Verification team, with their portal checks. */
  async verificationQueue() {
    const sourcings = await this.repository.listLoadsAt(['truck_assigned']);
    const waiting = sourcings.filter(
      (sourcing) => sourcing.driverNamedAt && !sourcing.load.lsVerificationApprovedAt,
    );
    return Promise.all(
      waiting.map(async (sourcing) => ({
        sourcing,
        checks: await this.verification.checksForLoad(sourcing.tenantId, sourcing.load),
      })),
    );
  }

  /** "Verification team approves the truck and driver after the portal checks. Asks the shipper
   *  for the loading contact if it is missing." Then the memo goes to the shipper. */
  async approveVerification(actorId: string, loadId: string, input: ApproveVerificationInput) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      if (!sourcing.driverNamedAt)
        throw new ConflictError('The partner has not named the driver yet');
      const checks = await this.verification.checksForLoad(sourcing.tenantId, sourcing.load);
      if (!checks.clear) {
        throw new ConflictError('A truck or driver check failed — fix it before approving', {
          checks,
        });
      }
      if (!checks.driver) throw new ConflictError('The driver has not been checked yet');
      await this.loadService.markLoadsmartVerified(sourcing.tenantId, actorId, loadId);
      await this.repository.updateSourcing(sourcing.id, { verificationApprovedBy: actorId });
      const memo = await this.memoService.resend(sourcing.tenantId, actorId, loadId, {
        name: input.loadingContactName,
        phone: input.loadingContactPhone,
      });
      await this.step(sourcing, actorId, 'verification_approved', 'LS_VERIFICATION_APPROVED', {
        memoId: memo.id,
      });
      return memo;
    } catch (error) {
      rethrow(error, 'Failed to approve the truck and driver');
    }
  }

  // --- 13–22 · Tracking team, papers, charges, trucker advance -----------------------------

  trackingQueue() {
    return this.repository.listLoadsAt([
      'truck_assigned',
      'in_transit_loading',
      'reached_loading',
      'loaded',
      'in_transit_unloading',
      'reached_unloading',
    ]);
  }

  /** "Truck waits for approval": the shipper checks invoice, e-way bill and signed LR are on the
   *  load, and the e-way bill names Loadsmart as transporter. Only then is the load Loaded. */
  async approvePapers(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: ApprovePapersInput,
  ) {
    try {
      const sourcing = await this.assertWonLoad(loadId, tenantId);
      const load = sourcing.load;
      if (load.status !== 'reached_loading') {
        throw new ConflictError('Papers are approved at the loading point');
      }
      if (!hasLoadingPapers(load)) {
        throw new ConflictError('Invoice, e-way bill and signed LR are all needed');
      }
      if (!input.ewayBillNamesLoadsmart) {
        throw new ConflictError('The e-way bill must name Loadsmart as transporter');
      }
      await this.loadService.markLoadsmartPapersApproved(sourcing.tenantId, actorId, loadId);
      await this.repository.updateSourcing(sourcing.id, { papersApprovedBy: actorId });
      const loaded = await this.stageService.transition({
        tenantId: sourcing.tenantId,
        loadId,
        to: 'loaded',
        actorId,
        auditAction: 'LOAD_LOADING_CONFIRMED',
        fields: { loadingConfirmedBy: actorId },
      });
      await this.step(sourcing, actorId, 'papers_approved', 'LS_PAPERS_APPROVED', {});
      return loaded;
    } catch (error) {
      rethrow(error, 'Failed to approve the papers');
    }
  }

  /** "The team lead releases the advance, less TDS" — from Loaded. */
  async payPartnerAdvance(
    actorId: string,
    loadId: string,
    input: UtrInput,
  ): Promise<LsPartnerPaymentEntity> {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      const load = sourcing.load;
      if (!load.loadingConfirmedAt)
        throw new ConflictError('The trucker advance is paid once Loaded');
      if (await this.repository.findPartnerPayment(sourcing.id, 'advance')) {
        throw new ConflictError("The partner's advance is already paid");
      }
      const amounts = partnerAdvance(
        this.partnerTrip(sourcing, load),
        Number(sourcing.truckerAdvancePercent),
        Number(sourcing.partner?.tdsPercent ?? DEFAULT_TDS_PERCENT),
      );
      const payment = await this.repository.partnerPayments.save(
        this.repository.partnerPayments.create({
          sourcingId: sourcing.id,
          loadId,
          partnerId: sourcing.partnerId!,
          paymentType: 'advance',
          grossAmount: String(amounts.gross),
          tdsAmount: String(amounts.tds),
          deductionAmount: '0',
          netAmount: String(amounts.net),
          utrReference: input.utrReference,
          paidBy: actorId,
          paidAt: this.now(),
        }),
      );
      await this.step(sourcing, actorId, 'partner_advance_paid', 'LS_PARTNER_PAID', {
        ...amounts,
        utrReference: input.utrReference,
      });
      return payment;
    } catch (error) {
      rethrow(error, "Failed to pay the partner's advance");
    }
  }
}
