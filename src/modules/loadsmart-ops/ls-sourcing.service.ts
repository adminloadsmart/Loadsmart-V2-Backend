import type { ExtraDocument } from '../loads/documents/load-document.types';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { LoadDocumentService } from '../loads/documents/load-document.service';
import { In } from 'typeorm';
import { AuditService } from '../audit/audit.service';
import { SALES_ROLE } from '../../shared/constants/roles';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadPostingEntity } from '../loads/load-posting/entities/load-posting.entity';
import { LoadBidEntity } from '../loads/bids/load-bid.entity';
import { LoadBidService } from '../loads/bids/load-bid.service';
import { LoadMemoService } from '../loads/memo/load-memo.service';
import { LoadService } from '../loads/core/load.service';
import { LoadStageService } from '../loads/core/load-stage.service';
import {
  LoadVerificationService,
  truckVerifiedOf,
} from '../loads/verification/load-verification.service';
import { LsPartnerBidEntity } from './entities/ls-partner-bid.entity';
import { LsPartnerEntity } from './entities/ls-partner.entity';
import { LsSourcingEntity } from './entities/ls-sourcing.entity';
import { LoadsmartRepository } from './loadsmart.repository';
import { DEFAULT_TDS_PERCENT, MIN_MARGIN_PERCENT, PARTNER_CALL_AFTER_MS } from './loadsmart.types';
import type { PartnerLoadStatus, WhatsappOnlyBrokerResponse } from './loadsmart.types';
import type { BrokerResponseChannel } from './placement-board-rules';
import {
  effectiveMarginPercent,
  marginError,
  missingSourcingFields,
  partnerTargetRate,
  shipperPriceFor,
  tripAmount,
  tripToLoadRate,
} from './loadsmart-rules';
import { LsServiceBase } from './ls-base';
import { LsStaffNotifier } from './ls-staff-notifier';
import { describeMatch, routeOf } from '../lane-matching';
import { LS_PLACEMENT } from '../../shared/constants/permissions';
import {
  AcceptMemoInput,
  NameDriverInput,
  NameDriverResult,
} from '../loads/utils/load-memo.interface';
import type {
  ManualDriverCheckInput,
  ManualTruckCheckInput,
} from '../loads/utils/load-verification.interface';
import {
  ApproveSourcingInput,
  BrokerMatcher,
  CommercialTermsInput,
  LoadBoardRow,
  BoardPartner,
  LoadBoardNotifier,
  LoadBoardOffer,
  RequirementSendResult,
  LoadsmartActor,
  PartnerBidInput,
  PartnerBidView,
  PartnerInput,
  PlacementView,
  SendBidInput,
  BrokerCounterInput,
  ShipperCounterView,
} from './loadsmart.interface';
import { ResolvedSettings, SettingsReader } from '../settings/settings.types';

const normalizePlate = (value: string) => value.replace(/\s+/g, '').toUpperCase();

/**
 * Loadsmart load, part 1 — posting to loaded, run by the ops console:
 * - every market posting opens a sourcing with the shipper's margin and trucker advance;
 * - the Approval team posts it on the load board (partners see the rate with the margin out);
 * - Placement records partner bids (never from salespeople), calls the ones who haven't bid in
 *   5 minutes, and sends the shipper one best bid as Loadsmart's — no partner name, priced with
 *   the margin, a note required under 5%;
 * - once the shipper accepts it, Placement names the partner's driver, the Verification team
 *   approves truck and driver, and the memo goes out;
 * - the Tracking team marks the truck, uploads papers for the driver and approves them (the
 *   e-way bill must name Loadsmart) — only then is the load Loaded;
 * - charges, the e-LR and the carrier advance are the Tracking service's (ls-tracking.service);
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
    /** Super Admin → Settings: the central margin and default carrier advance a shipper without
     *  terms of its own gets. */
    private readonly settings: SettingsReader,
    private readonly documents: LoadDocumentService,
    now?: () => Date,
  ) {
    super(repository, loadActivityService, auditService, now);
  }

  private boardNotifier?: LoadBoardNotifier;
  private brokerMatcher?: BrokerMatcher;
  private staffNotifier?: Pick<LsStaffNotifier, 'notifyPermission'>;

  /** WhatsApp offers to partners when a load is posted on the board (messaging module). */
  setLoadBoardNotifier(notifier: LoadBoardNotifier): void {
    this.boardNotifier = notifier;
  }

  /** Lane matching: a board offer goes only to the brokers on the load's lane; with none,
   *  Placement is told instead (modules/lane-matching). */
  setBrokerMatching(
    matcher: BrokerMatcher,
    staffNotifier: Pick<LsStaffNotifier, 'notifyPermission'>,
  ): void {
    this.brokerMatcher = matcher;
    this.staffNotifier = staffNotifier;
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

  /** A shipper's margin and carrier advance %; without terms of its own, the settings' central
   *  margin and default carrier advance (`defaults`: a load's own version, else the latest). */
  async getTerms(tenantId: string, defaults?: ResolvedSettings) {
    const terms = await this.repository.terms.findOneBy({ tenantId });
    const { values } = defaults ?? (await this.settings.current());
    return {
      tenantId,
      marginPercent: Number(terms?.marginPercent ?? values.centralMarginPercent),
      truckerAdvancePercent: Number(
        terms?.truckerAdvancePercent ?? values.defaultCarrierAdvancePercent,
      ),
      preapprovedCharges: terms?.preapprovedCharges ?? [],
      creditDays: terms?.creditDays ?? values.defaultShipperCreditDays,
      podType: terms?.podType ?? 'image',
      billingInstructions: terms?.billingInstructions ?? [],
      billingNote: terms?.billingNote ?? null,
      // Null: the load's own advance % (what the shipper posted), else the settings' default.
      shipperAdvancePercent:
        terms?.shipperAdvancePercent != null ? Number(terms.shipperAdvancePercent) : null,
      defaultShipperAdvancePercent: values.defaultShipperAdvancePercent,
      balancePayer: terms?.balancePayer ?? 'shipper',
      shipperAdvanceDays: terms?.shipperAdvanceDays ?? null,
      physicalLr: terms?.physicalLr ?? false,
      physicalLrNote: terms?.physicalLrNote ?? null,
      isDefault: !terms,
    };
  }

  async saveTerms(actorId: string, tenantId: string, input: CommercialTermsInput) {
    try {
      // Margin is optional (only the Admin team may send it — see LoadsmartOpsController); left
      // out, the shipper's current margin (or the default) is kept.
      const marginPercent =
        input.marginPercent ?? Number((await this.getTerms(tenantId)).marginPercent);
      if (input.creditDays !== undefined && input.creditDays !== null) {
        const { values } = await this.settings.current();
        if (input.creditDays > values.maxShipperCreditDays) {
          throw new ValidationError(
            `Credit is at most ${values.maxShipperCreditDays} days (Super Admin → Settings)`,
          );
        }
      }
      await this.repository.terms.save({
        tenantId,
        marginPercent: String(marginPercent),
        truckerAdvancePercent: String(input.truckerAdvancePercent),
        ...(input.preapprovedCharges
          ? {
              preapprovedCharges: input.preapprovedCharges.map((charge) => ({
                head: charge.head,
                maxAmount: charge.maxAmount ?? null,
              })),
            }
          : {}),
        ...(input.creditDays !== undefined ? { creditDays: input.creditDays } : {}),
        ...(input.podType ? { podType: input.podType } : {}),
        ...(input.billingInstructions ? { billingInstructions: input.billingInstructions } : {}),
        ...(input.billingNote !== undefined ? { billingNote: input.billingNote } : {}),
        ...(input.shipperAdvancePercent !== undefined
          ? {
              shipperAdvancePercent:
                input.shipperAdvancePercent === null ? null : String(input.shipperAdvancePercent),
            }
          : {}),
        ...(input.balancePayer ? { balancePayer: input.balancePayer } : {}),
        ...(input.shipperAdvanceDays !== undefined
          ? { shipperAdvanceDays: input.shipperAdvanceDays }
          : {}),
        ...(input.physicalLr !== undefined ? { physicalLr: input.physicalLr } : {}),
        ...(input.physicalLrNote !== undefined ? { physicalLrNote: input.physicalLrNote } : {}),
        updatedBy: actorId,
      });
      await this.auditService.log({
        tenantId,
        userId: actorId,
        action: 'LS_TERMS_SAVED',
        resourceType: 'ls_sourcing',
        newData: { tenantId, ...input, marginPercent },
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
      if (load.postingType !== 'market_fleet') continue;
      const existing = await this.repository.sourcings.findOneBy({ loadId: load.id });
      if (existing) continue;
      const terms = await this.getTerms(load.tenantId, await this.settings.forLoad(load));
      const posting = load.postingId
        ? await this.repository.findPosting(load.tenantId, load.postingId)
        : null;
      const created = await this.repository.sourcings.save(
        this.repository.sourcings.create({
          tenantId: load.tenantId,
          loadId: load.id,
          status: 'pending_approval',
          marginPercent: String(terms.marginPercent),
          truckerAdvancePercent: String(terms.truckerAdvancePercent),
          missingFields: missingSourcingFields(posting),
        }),
      );
      // A posted load lands in Placement's inbox and goes straight onto the load board; there
      // is no per-load approval (Approval verifies onboarding and posts on a shipper's behalf).
      // Never fails the posting — a load that could not be posted stays `pending_approval`.
      try {
        const fresh = await this.repository.findSourcing(created.id);
        if (fresh) await this.postToBoard(fresh, null);
      } catch (error) {
        console.error(`[sourcing] could not post ${load.id} to the load board`, error);
      }
    }
  };

  /** Posting hook: the shipper edited the load before any bid — what it is missing is checked
   *  again, while Approval still has it. */
  refreshForEditedLoads = async (loads: LoadEntity[]): Promise<void> => {
    for (const load of loads) {
      const sourcing = await this.repository.sourcings.findOneBy({ loadId: load.id });
      if (!sourcing || sourcing.status !== 'pending_approval') continue;
      const posting = load.postingId
        ? await this.repository.findPosting(load.tenantId, load.postingId)
        : null;
      await this.repository.updateSourcing(sourcing.id, {
        missingFields: missingSourcingFields(posting),
      });
    }
  };

  /** Stage hook: the load was cancelled — its sourcing is closed (a lost one stays lost). */
  markCancelled = async (load: LoadEntity): Promise<void> => {
    const sourcing = await this.repository.sourcings.findOneBy({ loadId: load.id });
    if (!sourcing || sourcing.status === 'lost' || sourcing.status === 'cancelled') return;
    await this.repository.updateSourcing(sourcing.id, { status: 'cancelled' });
    await this.loadActivityService.record(
      load.tenantId,
      load.id,
      load.updatedBy,
      'LOADSMART_STEP',
      sourcing.status,
      'sourcing_cancelled',
      {},
    );
  };

  /** Spec step 3, "finds matching brokers": counts the brokers whose lane covers the load. Nothing
   *  is sent — Placement picks the brokers and sends the requirement (step 4,
   *  sendRequirementOffer). With none on WhatsApp, Placement is told so it can add brokers by hand.
   *  Never throws — the load is already posted. */
  private async checkBrokersOnLane(
    offer: LoadBoardOffer,
    posting: LoadPostingEntity | null,
  ): Promise<{ matched: number; onWhatsapp: number }> {
    if (!this.brokerMatcher) return { matched: 0, onWhatsapp: 0 };
    try {
      const matches = await this.brokerMatcher.matchBrokers(
        routeOf(posting?.pickupAddress, posting?.dropAddress),
      );
      const onWhatsapp = matches.filter((match) => match.onWhatsapp);
      if (!onWhatsapp.length) {
        await this.staffNotifier?.notifyPermission([LS_PLACEMENT], {
          type: 'placement.no_broker_on_lane',
          title: `${offer.loadCode}: no broker on this lane`,
          body: `No approved broker${matches.length ? ' on WhatsApp' : ''} runs ${offer.pickupLabel} → ${offer.dropLabel}, so there is no one to send the requirement to. Add brokers to the load by hand, then send it.`,
          loadId: offer.loadId,
          metadata: { sourcingId: offer.sourcingId, brokersOnLane: matches.length },
        });
        return { matched: matches.length, onWhatsapp: 0 };
      }
      console.info(
        `[lane-matching] ${offer.loadCode}: ${onWhatsapp.length} broker(s) on the lane, waiting for Placement to send: ${onWhatsapp
          .map((match) => `${match.name} (${describeMatch(match.match)})`)
          .join(', ')}`,
      );
      return { matched: matches.length, onWhatsapp: onWhatsapp.length };
    } catch (error) {
      console.error(`[lane-matching] could not match brokers for ${offer.loadCode}`, error);
      return { matched: 0, onWhatsapp: 0 };
    }
  }

  /** Puts a sourcing on the load board: fixes the partner-facing rate (the shipper's target with
   *  the margin taken out), checks for brokers on the lane and records the step. No broker is
   *  messaged here — Placement sends the requirement. Shared by
   *  the shipper's own posting (no actor — the system posts it) and a manual approval. */
  private async postToBoard(
    sourcing: LsSourcingEntity,
    actorId: string | null,
    overrides: { marginPercent?: number; truckerAdvancePercent?: number } = {},
  ): Promise<LsSourcingEntity> {
    const marginPercent = overrides.marginPercent ?? Number(sourcing.marginPercent);
    const posting = sourcing.load.postingId
      ? await this.repository.findPosting(sourcing.tenantId, sourcing.load.postingId)
      : null;
    const target = posting?.rate ? Number(posting.rate) : null;
    const partnerRate = partnerTargetRate(target, marginPercent);
    const updated = await this.repository.updateSourcing(sourcing.id, {
      status: 'posted',
      marginPercent: String(marginPercent),
      truckerAdvancePercent: String(
        overrides.truckerAdvancePercent ?? Number(sourcing.truckerAdvancePercent),
      ),
      partnerTargetRate: partnerRate === null ? null : String(partnerRate),
      approvedBy: actorId,
      postedAt: this.now(),
    });
    const offer = boardOfferOf(
      updated,
      sourcing.load,
      posting,
      partnerRate === null ? null : String(partnerRate),
    );
    const lane = await this.checkBrokersOnLane(offer, posting);
    await this.step(updated, actorId, 'posted_on_load_board', 'LS_SOURCING_APPROVED', {
      marginPercent,
      partnerTargetRate: partnerRate,
      brokersOnLane: lane.matched,
      brokersOnWhatsapp: lane.onWhatsapp,
    });
    return updated;
  }

  /** "Send requirement" (spec step 4): the WhatsApp offer — LS_N_0105 with the partner rate, or
   *  LS_N_0106 asking for rates — to these partners, from Loadsmart's business number. Each send
   *  is logged against the load and the partner, so their replies route back to this load. */
  async sendRequirementOffer(
    sourcing: LsSourcingEntity,
    partners: BoardPartner[],
  ): Promise<RequirementSendResult[]> {
    if (!partners.length) return [];
    if (!this.boardNotifier) {
      return partners.map((partner) => ({
        partnerId: partner.id,
        status: 'failed' as const,
        messageLogId: null,
        failReason: 'WhatsApp is not set up',
      }));
    }
    const posting = sourcing.load.postingId
      ? await this.repository.findPosting(sourcing.tenantId, sourcing.load.postingId)
      : null;
    return this.boardNotifier.sendRequirement({
      ...boardOfferOf(sourcing, sourcing.load, posting, sourcing.partnerTargetRate),
      partners,
    });
  }

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
      return await this.postToBoard(sourcing, actorId, {
        marginPercent: input.marginPercent,
        truckerAdvancePercent: input.truckerAdvancePercent,
      });
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
        // The trip total, as brokers quote.
        partnerRate: sourcing.partnerTargetRate
          ? String(
              tripAmount(
                Number(sourcing.partnerTargetRate),
                sourcing.load.freightType,
                Number(sourcing.load.plannedCapacityTonnes),
              ),
            )
          : null,
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
    if (actor.role === SALES_ROLE) throw new ConflictError('Bids from salespeople are not taken');
    return this.savePartnerBid(actor.id, sourcingId, input);
  }

  /** The partner's own WhatsApp reply (Accept at the board rate, a typed rate, the truck number or
   *  both) — no entering user. A truck with no rate keeps the live bid's rate; the truck is checked
   *  on VAHAN at once (savePartnerBid). */
  async recordPartnerBidFromWhatsapp(
    sourcingId: string,
    input: { partnerId: string; rate?: number; vehicleNumber?: string },
  ): Promise<PartnerBidView> {
    let rate = input.rate;
    if (rate === undefined) {
      const live = await this.findLivePartnerBid(sourcingId, input.partnerId);
      if (!live) throw new ConflictError('The truck number came before any rate for this load');
      const sourcing = await this.assertSourcing(sourcingId);
      rate = tripAmount(
        Number(live.rate),
        sourcing.load.freightType,
        Number(sourcing.load.plannedCapacityTonnes),
      );
    }
    return this.savePartnerBid(null, sourcingId, { ...input, rate, channel: 'whatsapp' });
  }

  /** The partner's WhatsApp tap that isn't a rate — Reject (`declined`) or Negotiate / Give rate
   *  (`negotiating`) — saved in their history so Placement sees it. Their live bid is untouched. */
  async recordPartnerReplyFromWhatsapp(
    sourcingId: string,
    input: { partnerId: string; response: 'declined' | WhatsappOnlyBrokerResponse },
  ): Promise<PartnerBidView> {
    return this.savePartnerBid(null, sourcingId, { ...input, channel: 'whatsapp' });
  }

  /** The partner's live bid on a board load, if any. */
  findLivePartnerBid(sourcingId: string, partnerId: string): Promise<LsPartnerBidEntity | null> {
    return this.repository.partnerBids.findOneBy({ sourcingId, partnerId, status: 'received' });
  }

  /** Partners on the board this phone belongs to (active only). */
  findActivePartnersByPhones(phones: string[]): Promise<LsPartnerEntity[]> {
    return this.repository.partners.find({ where: { phone: In(phones), status: 'active' } });
  }

  /** Every active partner — who a newly posted load goes to. */
  listActivePartners(): Promise<LsPartnerEntity[]> {
    return this.repository.partners.find({ where: { status: 'active' }, order: { name: 'ASC' } });
  }

  /** Loads on the board that still take partner bids, as partners may see them. */
  async openBoardLoads(): Promise<LoadBoardOffer[]> {
    const sourcings = await this.repository.listSourcings(
      ['posted', 'bid_sent'],
      ['created', 'bids_received'],
    );
    const offers: LoadBoardOffer[] = [];
    for (const sourcing of sourcings) {
      const posting = sourcing.load.postingId
        ? await this.repository.findPosting(sourcing.tenantId, sourcing.load.postingId)
        : null;
      offers.push(boardOfferOf(sourcing, sourcing.load, posting, sourcing.partnerTargetRate));
    }
    return offers;
  }

  private async savePartnerBid(
    actorId: string | null,
    sourcingId: string,
    input: PartnerBidInput,
  ): Promise<PartnerBidView> {
    try {
      const sourcing = await this.assertSourcing(sourcingId);
      if (sourcing.status !== 'posted' && sourcing.status !== 'bid_sent') {
        throw new ConflictError('This load is not on the load board');
      }
      const partner = await this.repository.partners.findOneBy({ id: input.partnerId });
      if (!partner || partner.status !== 'active') throw new NotFoundError('Partner not found');

      const response = input.response ?? 'bid';
      const vehicleNumber = input.vehicleNumber ? normalizePlate(input.vehicleNumber) : null;
      // A broker's rate is always the total freight for the trip — never per tonne. It is kept in
      // the load's own basis (÷ tonnes on a per-tonne load), which every price rule reads.
      const rate =
        input.rate === undefined
          ? null
          : tripToLoadRate(
              input.rate,
              sourcing.load.freightType,
              Number(sourcing.load.plannedCapacityTonnes),
            );
      if (input.rate !== undefined && rate === null) {
        throw new ValidationError(
          "This load is priced per tonne but has no weight, so the broker's trip rate can't be used",
        );
      }
      // Every response goes in the broker's history ("older offers remain in broker history").
      const history = await this.repository.partnerBidResponses.save(
        this.repository.partnerBidResponses.create({
          sourcingId,
          partnerId: partner.id,
          response,
          rate: rate === null ? null : String(rate),
          channel: input.channel ?? 'manual_entry',
          note: input.note?.trim() || null,
          vehicleNumber,
          enteredBy: actorId,
        }),
      );
      if (response !== 'bid') {
        // A decline, no truck or call back doesn't change the broker's live bid.
        await this.step(sourcing, actorId, 'partner_response', 'LS_PARTNER_BID_RECORDED', {
          responseId: history.id,
          partnerId: partner.id,
          response,
          note: history.note,
        });
        const live = await this.repository.partnerBids.findOneBy({
          sourcingId,
          partnerId: partner.id,
          status: 'received',
        });
        return {
          ...(live ? this.partnerBidView({ ...live, partner }, sourcing) : null),
          response: { id: history.id, response, channel: history.channel, note: history.note },
        } as PartnerBidView;
      }
      if (rate === null) throw new ValidationError('A bid needs a rate');

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
            rate: String(rate),
            vehicleNumber: vehicleNumber ?? live.vehicleNumber,
            truckVerified: vehicleNumber ? truckVerified : live.truckVerified,
            enteredBy: actorId,
          })
        : await this.repository.partnerBids.save(
            this.repository.partnerBids.create({
              sourcingId,
              partnerId: input.partnerId,
              rate: String(rate),
              vehicleNumber,
              truckVerified,
              enteredBy: actorId,
            }),
          );
      await this.step(sourcing, actorId, 'partner_bid', 'LS_PARTNER_BID_RECORDED', {
        partnerBidId: saved.id,
        partnerId: partner.id,
        rate,
        tripRate: input.rate,
        vehicleNumber,
        truckVerified,
      });
      return this.partnerBidView({ ...saved, partner }, sourcing, history.channel);
    } catch (error) {
      rethrow(error, 'Failed to record the partner bid');
    }
  }

  private partnerBidView(
    bid: LsPartnerBidEntity,
    sourcing: LsSourcingEntity,
    channel: BrokerResponseChannel | null = null,
    /** The price of Loadsmart's live bid on this broker bid (load basis), when one is with the
     *  shipper — it can differ from the margin price when Placement set it. */
    sentRate: string | null = null,
  ): PartnerBidView {
    const { freightType, plannedCapacityTonnes } = sourcing.load;
    const tonnes = Number(plannedCapacityTonnes);
    const shipperPrice = shipperPriceFor(Number(bid.rate), Number(sourcing.marginPercent));
    return {
      id: bid.id,
      partner: { id: bid.partner.id, name: bid.partner.name, partnerType: bid.partner.partnerType },
      rate: bid.rate,
      vehicleNumber: bid.vehicleNumber,
      truckVerified: bid.truckVerified,
      status: bid.status,
      shipperPrice,
      tripRate: tripAmount(Number(bid.rate), freightType, tonnes),
      shipperTripPrice: tripAmount(shipperPrice, freightType, tonnes),
      sentTripPrice: sentRate === null ? null : tripAmount(Number(sentRate), freightType, tonnes),
      channel,
      createdAt: bid.createdAt.toISOString(),
      updatedAt: bid.updatedAt.toISOString(),
    };
  }

  /** Placement's view of one load: partner bids ranked (a truck that can go first, then the
   *  lowest rate) and the partners to call. */
  async placement(sourcingId: string): Promise<PlacementView> {
    const sourcing = await this.assertSourcing(sourcingId);
    const bids = await this.repository.listPartnerBids(sourcingId);
    // The price each broker bid is with the shipper at, from Loadsmart's live bids on it.
    const sentRates = new Map(
      (await this.bidService.listLiveLoadsmartBids(sourcing.tenantId, sourcing.loadId))
        .filter((bid) => bid.lsPartnerBidId)
        .map((bid) => [bid.lsPartnerBidId!, bid.rate]),
    );
    // How each broker's latest rate came in: their newest `bid` response.
    const bidResponses = await this.repository.partnerBidResponses.find({
      where: { sourcingId, response: 'bid' },
      order: { createdAt: 'DESC' },
    });
    const bidChannels = new Map<string, BrokerResponseChannel>();
    for (const response of bidResponses) {
      if (!bidChannels.has(response.partnerId))
        bidChannels.set(response.partnerId, response.channel);
    }
    const usable = (bid: LsPartnerBidEntity) => bid.truckVerified !== false;
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
      bids: ranked.map((bid) =>
        this.partnerBidView(
          bid,
          sourcing,
          bidChannels.get(bid.partnerId),
          sentRates.get(bid.id) ?? null,
        ),
      ),
      callList,
    };
  }

  placementQueue(): Promise<LsSourcingEntity[]> {
    return this.repository.listSourcings(['posted', 'bid_sent'], ['created', 'bids_received']);
  }

  /** The broker-counter fields on a partner bid, cleared. */
  private static readonly NO_BROKER_COUNTER = {
    brokerCounterRate: null,
    brokerCounterSentAt: null,
    brokerCounterSentBy: null,
  };

  /** The shipper countered one of Loadsmart's bids — the step goes on the timeline for
   *  Placement. A new counter replaces any offer Placement made the broker on the last one. */
  onLoadsmartBidCountered = async (bid: LoadBidEntity, load: LoadEntity): Promise<void> => {
    const sourcing = await this.repository.sourcings.findOneBy({ loadId: load.id });
    if (!sourcing) return;
    if (bid.lsPartnerBidId) {
      await this.repository.partnerBids.update(
        { id: bid.lsPartnerBidId },
        LsSourcingService.NO_BROKER_COUNTER,
      );
    }
    await this.step(
      sourcing,
      load.updatedBy ?? bid.enteredBy ?? sourcing.bidSentBy!,
      'shipper_countered',
      'LS_BID_SENT',
      {
        bidId: bid.id,
        counterRate: bid.counterRate,
      },
    );
  };

  /** The shipper rejected one of Loadsmart's bids — the broker bid behind it can be sent again.
   *  The load goes back on the board only when no other Loadsmart bid is still with the
   *  shipper. */
  onLoadsmartBidRejected = async (bid: LoadBidEntity, load: LoadEntity): Promise<void> => {
    const sourcing = await this.repository.sourcings.findOneBy({ loadId: load.id });
    if (!sourcing || sourcing.status !== 'bid_sent') return;
    if (bid.lsPartnerBidId) {
      await this.repository.partnerBids.update(
        { id: bid.lsPartnerBidId, status: 'sent' },
        { status: 'received', ...LsSourcingService.NO_BROKER_COUNTER },
      );
    }
    const stillLive = await this.bidService.listLiveLoadsmartBids(sourcing.tenantId, load.id);
    const updated = stillLive.length
      ? sourcing
      : await this.repository.updateSourcing(sourcing.id, { status: 'posted' });
    await this.step(
      updated,
      bid.decidedBy ?? sourcing.bidSentBy!,
      'shipper_rejected_bid',
      'LS_BID_SENT',
      {
        bidId: bid.id,
        reason: bid.rejectionReason,
        bidsStillWithShipper: stillLive.length,
      },
    );
  };

  /** Placement answers the shipper's counter on one of Loadsmart's bids. Accepting it is a new
   *  price to the shipper, so the margin rules apply again (a note under the minimum margin,
   *  never at a loss). */
  async answerShipperCounter(
    actorId: string,
    loadId: string,
    bidId: string,
    input: { accepted: boolean; negotiationNote?: string; brokerRate?: number },
  ) {
    try {
      const sourcing = await this.repository.findSourcingByLoad(loadId);
      if (!sourcing || sourcing.status !== 'bid_sent') {
        throw new ConflictError("Loadsmart's bid on this load is not with the shipper");
      }
      const bid = await this.bidService.findBid(sourcing.tenantId, loadId, bidId);
      if (!bid || bid.source !== 'loadsmart' || !bid.lsPartnerBidId) {
        throw new NotFoundError("Loadsmart's bid not found on this load");
      }
      let margin: number | null = null;
      if (input.accepted) {
        if (!bid.counterRate) throw new ConflictError('There is no counter waiting on this bid');
        let partnerBid = await this.repository.partnerBids.findOneBy({ id: bid.lsPartnerBidId });
        if (!partnerBid) throw new NotFoundError('Partner bid not found');
        // The broker agreed to come down (usually to the counter Placement sent them): their bid
        // moves to that rate first, so the margin is read against what they'll actually charge.
        if (input.brokerRate !== undefined) {
          partnerBid = await this.reviseBrokerRateForCounter(
            sourcing,
            partnerBid,
            input.brokerRate,
            actorId,
          );
        }
        margin = effectiveMarginPercent(Number(bid.counterRate), Number(partnerBid.rate));
        const error = marginError(margin, MIN_MARGIN_PERCENT, input.negotiationNote);
        if (error) throw new ConflictError(error);
      }
      const view = await this.bidService.answerCounter(
        sourcing.tenantId,
        actorId,
        loadId,
        bidId,
        { accepted: input.accepted },
        true,
      );
      // The counter is answered — Placement's offer to the broker is done with either way.
      await this.repository.partnerBids.update(
        { id: bid.lsPartnerBidId },
        LsSourcingService.NO_BROKER_COUNTER,
      );
      if (input.accepted && input.negotiationNote) {
        await this.repository.updateSourcing(sourcing.id, {
          negotiationNote: input.negotiationNote,
        });
      }
      await this.step(
        sourcing,
        actorId,
        input.accepted ? 'counter_accepted' : 'counter_declined',
        'LS_BID_SENT',
        {
          bidId,
          rate: view.rate,
          marginPercent: margin,
        },
      );
      return view;
    } catch (error) {
      rethrow(error, "Failed to answer the shipper's counter");
    }
  }

  /** The shipper's counters waiting on Loadsmart's live bids, as Placement sees them — trip
   *  totals, with each counter less the margin as what its broker is offered. Newest first. */
  async shipperCounters(sourcing: LsSourcingEntity): Promise<ShipperCounterView[]> {
    if (sourcing.status !== 'bid_sent') return [];
    const bids = (
      await this.bidService.listLiveLoadsmartBids(sourcing.tenantId, sourcing.loadId)
    ).filter((bid) => bid.counterStatus === 'pending' && bid.counterRate && bid.lsPartnerBidId);
    if (!bids.length) return [];
    const partnerBids = await this.repository.partnerBids.find({
      where: { id: In(bids.map((bid) => bid.lsPartnerBidId!)) },
      relations: { partner: true },
    });
    const trip = (rate: string | number) =>
      tripAmount(
        Number(rate),
        sourcing.load.freightType,
        Number(sourcing.load.plannedCapacityTonnes),
      );
    const marginPercent = Number(sourcing.marginPercent);
    return bids.map((bid) => {
      const partnerBid = partnerBids.find((row) => row.id === bid.lsPartnerBidId) ?? null;
      const rate = trip(bid.counterRate!);
      return {
        bidId: bid.id,
        loadId: sourcing.loadId,
        partnerBidId: bid.lsPartnerBidId!,
        rate,
        bidPrice: trip(bid.rate),
        note: bid.counterNote,
        at: bid.counteredAt?.toISOString() ?? null,
        marginPercent,
        suggestedBrokerRate: partnerTargetRate(rate, marginPercent) ?? rate,
        broker: partnerBid?.partner
          ? {
              id: partnerBid.partner.id,
              name: partnerBid.partner.name,
              phone: partnerBid.partner.phone,
            }
          : null,
        brokerRate: partnerBid ? trip(partnerBid.rate) : null,
        sentToBroker:
          partnerBid?.brokerCounterRate && partnerBid.brokerCounterSentAt
            ? {
                rate: Number(partnerBid.brokerCounterRate),
                at: partnerBid.brokerCounterSentAt.toISOString(),
              }
            : null,
      };
    });
  }

  /** Placement takes the shipper's counter on one of Loadsmart's bids to the broker behind it: by
   *  default the counter less Loadsmart's margin (₹7,800 at 5% → ₹7,410), as a trip total. Saved
   *  on the broker's bid until the counter is answered; the broker's reply comes back as a new
   *  bid. */
  async counterToBroker(
    actorId: string,
    sourcingId: string,
    input: BrokerCounterInput,
  ): Promise<ShipperCounterView> {
    try {
      const sourcing = await this.assertSourcing(sourcingId);
      const counter = (await this.shipperCounters(sourcing)).find(
        (row) => row.bidId === input.bidId,
      );
      if (!counter) throw new ConflictError("The shipper hasn't countered this bid");
      if (!counter.broker) throw new ConflictError("No broker is behind Loadsmart's bid");
      const rate = input.rate ?? counter.suggestedBrokerRate;
      if (rate >= counter.rate) {
        throw new ConflictError(
          `Offer the broker less than the shipper's counter of ₹${counter.rate.toLocaleString('en-IN')} — otherwise Loadsmart makes no margin`,
        );
      }
      const now = this.now();
      await this.repository.partnerBids.update(
        { id: counter.partnerBidId },
        { brokerCounterRate: String(rate), brokerCounterSentAt: now, brokerCounterSentBy: actorId },
      );
      await this.step(sourcing, actorId, 'broker_countered', 'LS_BID_SENT', {
        bidId: counter.bidId,
        partnerId: counter.broker.id,
        shipperCounter: counter.rate,
        brokerRate: rate,
        note: input.note?.trim() || null,
      });
      // TODO(notifications team): send the broker the counter on WhatsApp here — to
      // counter.broker.phone, for load sourcing.load.code: "Shipper counter: ₹<rate> for the trip"
      // (`rate` already has Loadsmart's margin out — never show the shipper's counter) with
      // Accept / Reject. Their Accept should come back as a bid at `rate` via
      // recordPartnerBidFromWhatsapp, after which Placement accepts the shipper's counter.
      return {
        ...counter,
        sentToBroker: { rate, at: now.toISOString() },
      };
    } catch (error) {
      rethrow(error, 'Failed to send the counter to the broker');
    }
  }

  /** The broker agreed to the counter: their bid behind Loadsmart's moves to this trip rate,
   *  with the change in their history. */
  private async reviseBrokerRateForCounter(
    sourcing: LsSourcingEntity,
    partnerBid: LsPartnerBidEntity,
    tripRate: number,
    actorId: string,
  ): Promise<LsPartnerBidEntity> {
    const rate = tripToLoadRate(
      tripRate,
      sourcing.load.freightType,
      Number(sourcing.load.plannedCapacityTonnes),
    );
    if (rate === null) {
      throw new ValidationError('This load is priced per tonne but has no weight');
    }
    const saved = await this.repository.partnerBids.save({ ...partnerBid, rate: String(rate) });
    await this.repository.partnerBidResponses.save(
      this.repository.partnerBidResponses.create({
        sourcingId: sourcing.id,
        partnerId: partnerBid.partnerId,
        response: 'bid',
        rate: String(rate),
        channel: 'manual_entry',
        note: "Agreed to the shipper's counter",
        vehicleNumber: null,
        enteredBy: actorId,
      }),
    );
    return saved;
  }

  /** "Send to shipper" for several broker bids at once — each goes as its own Loadsmart bid,
   *  priced at the margin unless Placement set its price. One that can't go (margin, truck)
   *  lands in `failed` and does not stop the others. */
  async sendBids(
    actorId: string,
    sourcingId: string,
    bids: SendBidInput[],
  ): Promise<{
    sent: { partnerBidId: string; bidId: string }[];
    failed: { partnerBidId: string; reason: string }[];
  }> {
    const sent: { partnerBidId: string; bidId: string }[] = [];
    const failed: { partnerBidId: string; reason: string }[] = [];
    for (const input of bids) {
      try {
        const bid = await this.sendBid(actorId, sourcingId, input);
        sent.push({ partnerBidId: input.partnerBidId, bidId: bid.id });
      } catch (error) {
        failed.push({
          partnerBidId: input.partnerBidId,
          reason: error instanceof Error ? error.message : "Failed to send Loadsmart's bid",
        });
      }
    }
    return { sent, failed };
  }

  /** Sends one broker bid to the shipper as Loadsmart's, without the partner's name. Loadsmart
   *  can have several with the shipper at once; sending the same broker bid again replaces only
   *  its own earlier price. Priced at the margin unless Placement sets the price; under 5% needs
   *  the negotiation note. */
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
      // No truck is needed to send the price: the truck and driver are entered on the load memo
      // once the shipper accepts, and checked there. A truck already on the bid still must pass.
      if (bid.truckVerified === false) {
        throw new ConflictError(
          `${bid.partner.name}'s truck failed the govt portal checks — ask them for another`,
        );
      }
      const partnerRate = Number(bid.rate);
      // Placement's price, like the broker's rate, is the trip total — kept in the load's basis.
      const typedPrice =
        input.shipperPrice === undefined
          ? null
          : tripToLoadRate(
              input.shipperPrice,
              sourcing.load.freightType,
              Number(sourcing.load.plannedCapacityTonnes),
            );
      const price = typedPrice ?? shipperPriceFor(partnerRate, Number(sourcing.marginPercent));
      const margin = effectiveMarginPercent(price, partnerRate);
      const error = marginError(margin, MIN_MARGIN_PERCENT, input.negotiationNote);
      if (error) throw new ConflictError(`${bid.partner.name}: ${error}`);

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
      // Only this broker bid is now with the shipper; Loadsmart's other bids stay as they are. A
      // new price replaces any counter in flight on it.
      await this.repository.partnerBids.update(
        { id: bid.id },
        { status: 'sent', ...LsSourcingService.NO_BROKER_COUNTER },
      );
      // The sourcing keeps the latest price sent; the accepted bid's price replaces it on win.
      const updated = await this.repository.updateSourcing(sourcingId, {
        status: 'bid_sent',
        shipperPrice: String(price),
        effectiveMarginPercent: String(margin),
        negotiationNote: input.negotiationNote ?? sourcing.negotiationNote,
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

  /** LoadBidService hook: the shipper accepted one of Loadsmart's bids — the partner behind it is
   *  on the truck, at the price the shipper accepted (Loadsmart's other bids are rejected by the
   *  award). */
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
      shipperPrice: bid.rate,
      effectiveMarginPercent: String(
        effectiveMarginPercent(Number(bid.rate), Number(partnerBid.rate)),
      ),
    });
    await this.step(updated, actorId, 'bid_won', 'LS_BID_WON', {
      partnerId: partnerBid.partnerId,
      partnerRate: partnerBid.rate,
      shipperPrice: bid.rate,
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

  /** Links to the licence and RC photos uploaded with the driver, for the Load Memo tab. */
  async photoLinks(keys: { front?: string | null; back?: string | null; rcCopy?: string | null }) {
    const [front, back, rcCopy] = await Promise.all([
      this.memoService.downloadUrlForKey(keys.front),
      this.memoService.downloadUrlForKey(keys.back),
      this.memoService.downloadUrlForKey(keys.rcCopy),
    ]);
    return { front, back, rcCopy };
  }

  /** The truck (VAHAN) and driver (Sarathi) checks on the load, with the portals' answers — what
   *  Placement reads on the Load Memo tab. Null while the load has no truck yet. */
  async checksOf(load: Pick<LoadEntity, 'id' | 'vehicleNumber'>, tenantId: string) {
    if (!load.vehicleNumber) return null;
    return this.memoService.getChecks(tenantId, load.id);
  }

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
      // Papers first: the memo goes out inside nameDriver and carries these photos.
      await this.saveDriverDocuments(sourcing, actorId, {
        licenceFrontFileKey,
        licenceBackFileKey,
        rcCopyFileKey,
      });
      await this.repository.updateSourcing(sourcing.id, { driverNamedAt: this.now() });
      const result = await this.memoService.nameDriver(
        sourcing.tenantId,
        actorId,
        loadId,
        driver,
        true,
      );
      await this.step(sourcing, actorId, 'driver_named', 'LS_DRIVER_NAMED', {
        driverName: driver.driverName,
        checksClear: result.checks.clear,
      });
      return result;
    } catch (error) {
      rethrow(error, 'Failed to name the driver');
    }
  }

  /** Loads a partner won (the shipper accepted Loadsmart's bid on their rate) that still wait
   *  for the truck and driver — until the memo is accepted. LS_N_0107 asked them for these on
   *  WhatsApp; the shape is the board offer's, so WhatsApp replies route the same way. */
  async wonLoadsAwaitingDriver(partnerIds: string[]): Promise<LoadBoardOffer[]> {
    if (!partnerIds.length) return [];
    const sourcings = await this.repository.sourcings.find({
      where: { status: 'won', partnerId: In(partnerIds) },
      relations: { load: true },
    });
    const offers: LoadBoardOffer[] = [];
    for (const sourcing of sourcings) {
      const load = sourcing.load;
      if (!load || load.status !== 'bids_received' || load.memoAcceptedAt) continue;
      const posting = load.postingId
        ? await this.repository.findPosting(sourcing.tenantId, load.postingId)
        : null;
      offers.push(boardOfferOf(sourcing, load, posting, sourcing.partnerRate));
    }
    return offers;
  }

  /** Where this load stands for this partner (PARTNER_LOAD_STATUSES); null when it isn't a
   *  Loadsmart load or isn't on the board yet. */
  async partnerLoadStatus(loadId: string, partnerId: string): Promise<PartnerLoadStatus | null> {
    const sourcing = await this.repository.findSourcingByLoad(loadId);
    if (!sourcing) return null;
    if (sourcing.status === 'cancelled' || sourcing.load?.status === 'cancelled') {
      return 'cancelled';
    }
    if (sourcing.status === 'lost') return 'given_to_other';
    if (sourcing.status === 'won') {
      if (sourcing.partnerId !== partnerId) return 'given_to_other';
      const load = sourcing.load;
      return load && load.status === 'bids_received' && !load.memoAcceptedAt
        ? 'awaiting_driver'
        : 'driver_confirmed';
    }
    return sourcing.status === 'posted' || sourcing.status === 'bid_sent' ? 'bidding' : null;
  }

  /** The winning partner sent the truck and driver on WhatsApp (answer to LS_N_0107): saved on
   *  the load and checked on VAHAN / Sarathi like Placement's "Name driver", but the memo is held
   *  — Placement adds the licence and RC photos and sends it (re-run checks or a manual pass).
   *  No entering user. */
  async nameDriverFromWhatsapp(
    loadId: string,
    partnerId: string,
    driver: NameDriverInput,
  ): Promise<NameDriverResult> {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      if (sourcing.partnerId !== partnerId) {
        throw new ConflictError('This load is placed with another partner');
      }
      await this.repository.updateSourcing(sourcing.id, { driverNamedAt: this.now() });
      const result = await this.memoService.nameDriver(
        sourcing.tenantId,
        null,
        loadId,
        driver,
        true,
        { holdMemo: true },
      );
      await this.step(sourcing, null, 'driver_named', 'LS_DRIVER_NAMED', {
        driverName: driver.driverName,
        checksClear: result.checks.clear,
        channel: 'whatsapp',
        partnerId,
      });
      return result;
    } catch (error) {
      rethrow(error, 'Failed to name the driver');
    }
  }

  /** Registers the driver's papers on the load's documents register and on the sourcing. */
  private async saveDriverDocuments(
    sourcing: Awaited<ReturnType<LsSourcingService['assertWonLoad']>>,
    actorId: string,
    keys: { licenceFrontFileKey?: string; licenceBackFileKey?: string; rcCopyFileKey?: string },
  ) {
    const extras: ExtraDocument[] = [];
    if (keys.licenceFrontFileKey)
      extras.push({ docType: 'driver_licence_front', fileKey: keys.licenceFrontFileKey });
    if (keys.licenceBackFileKey)
      extras.push({ docType: 'driver_licence_back', fileKey: keys.licenceBackFileKey });
    if (keys.rcCopyFileKey) extras.push({ docType: 'rc_copy', fileKey: keys.rcCopyFileKey });
    if (!extras.length) return;
    await this.documents.save(
      sourcing.tenantId,
      sourcing.load,
      { updatedBy: actorId },
      { userId: actorId, source: 'console' },
      extras,
    );
    await this.repository.updateSourcing(sourcing.id, {
      ...(keys.licenceFrontFileKey ? { licenceFrontFileKey: keys.licenceFrontFileKey } : {}),
      ...(keys.licenceBackFileKey ? { licenceBackFileKey: keys.licenceBackFileKey } : {}),
      ...(keys.rcCopyFileKey ? { rcCopyFileKey: keys.rcCopyFileKey } : {}),
    });
  }

  /** Placement replaces / adds the licence photos or RC copy without naming the driver again. */
  async updateDriverDocuments(
    actorId: string,
    loadId: string,
    input: { licenceFrontFileKey?: string; licenceBackFileKey?: string; rcCopyFileKey?: string },
  ) {
    try {
      const sourcing = await this.assertWonLoad(loadId);
      await this.saveDriverDocuments(sourcing, actorId, input);
      return {
        licencePhotos: {
          front: input.licenceFrontFileKey ?? sourcing.licenceFrontFileKey ?? null,
          back: input.licenceBackFileKey ?? sourcing.licenceBackFileKey ?? null,
          rcCopy: input.rcCopyFileKey ?? sourcing.rcCopyFileKey ?? null,
        },
      };
    } catch (error) {
      rethrow(error, 'Failed to update the driver documents');
    }
  }

  /** Placement runs the truck and driver checks again on a Loadsmart load. */
  async rerunChecks(actorId: string, loadId: string) {
    const sourcing = await this.assertWonLoad(loadId);
    return this.memoService.rerunChecks(sourcing.tenantId, actorId, loadId, true);
  }

  /** VAHAN is down for the truck on a Loadsmart load — the Admin team verifies it by hand. */
  async verifyTruckManually(actorId: string, loadId: string, input: ManualTruckCheckInput) {
    const sourcing = await this.assertWonLoad(loadId);
    return this.memoService.verifyTruckManually(sourcing.tenantId, actorId, loadId, input, true);
  }

  /** Sarathi can't confirm the driver's licence on a Loadsmart load — the Admin team checks it by
   *  hand. */
  async verifyDriverManually(actorId: string, loadId: string, input: ManualDriverCheckInput) {
    const sourcing = await this.assertWonLoad(loadId);
    return this.memoService.verifyDriverManually(sourcing.tenantId, actorId, loadId, input, true);
  }

  /** "Shipper accepted on a call → mark confirmed" — Placement records the memo acceptance. */
  async confirmMemoOnCall(actorId: string, loadId: string, input: AcceptMemoInput) {
    const sourcing = await this.assertWonLoad(loadId);
    return this.memoService.accept(sourcing.tenantId, actorId, loadId, input, 'ls_team');
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
}

/** A board load as partners may see it — cities and truck only, never the shipper's name. The
 *  rate is the trip total: brokers quote and accept the whole trip, never per tonne. */
function boardOfferOf(
  sourcing: Pick<LsSourcingEntity, 'id' | 'tenantId'>,
  load: Pick<LoadEntity, 'id' | 'code' | 'freightType' | 'plannedCapacityTonnes'>,
  posting: LoadPostingEntity | null,
  loadBasisRate: string | null,
): LoadBoardOffer {
  const partnerRate = loadBasisRate
    ? String(
        tripAmount(Number(loadBasisRate), load.freightType, Number(load.plannedCapacityTonnes)),
      )
    : null;
  return {
    sourcingId: sourcing.id,
    tenantId: sourcing.tenantId,
    loadId: load.id,
    loadCode: load.code,
    partnerRate,
    pickupLabel: posting?.pickupAddress?.city ?? posting?.pickupAddress?.label ?? 'Pickup',
    dropLabel: posting?.dropAddress?.city ?? posting?.dropAddress?.label ?? 'Drop',
    truckLabel: posting?.truckLengthFt ? `${posting.truckLengthFt} ft` : 'Truck',
    weightTonnes: posting?.weightTonnes ?? null,
    pickupAt: posting?.pickupAt ?? null,
    partners: [],
  };
}
