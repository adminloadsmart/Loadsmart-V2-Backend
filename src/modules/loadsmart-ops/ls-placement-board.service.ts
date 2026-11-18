import { DataSource, In, MoreThan } from 'typeorm';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadMemoEntity } from '../loads/memo/load-memo.entity';
import { LoadPostingEntity } from '../loads/load-posting/entities/load-posting.entity';
import { BID_WINDOW_MS, bidWindowClosesAt } from '../loads/bids/bid-rules';
import { OrganizationEntity } from '../organization/entities/organization.entity';
import { SettingsReader } from '../settings/settings.types';
import { ConsoleRepository } from './console.repository';
import { LsCallLogEntity } from './entities/ls-call-log.entity';
import { LsPartnerBidResponseEntity } from './entities/ls-partner-bid-response.entity';
import { LsSourcingBrokerEntity } from './entities/ls-sourcing-broker.entity';
import { LsSourcingEntity } from './entities/ls-sourcing.entity';
import { LoadsmartRepository } from './loadsmart.repository';
import { CallOutcome } from './loadsmart.types';
import { tripAmount } from './loadsmart-rules';
import { LsServiceBase } from './ls-base';
import { LsSourcingService } from './ls-sourcing.service';
import {
  MAX_BID_WINDOW_EXTENSION_HOURS,
  MemoState,
  PLACEMENT_TABS,
  PlacementTab,
  median,
  memoState,
  placementTabs,
  rateCeiling,
  requirementMessage,
  whatsappLink,
} from './placement-board-rules';
import { rankBrokers } from './placement-rules';

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** Carrier rates on the lane this recent make the "market rate". */
const MARKET_RATE_WINDOW_MS = 90 * DAY_MS;

/** Loads Placement works: not yet sourced, or placed and on their way to loading. */
const PLACEMENT_SOURCING_STATUSES = ['pending_approval', 'posted', 'bid_sent', 'won'] as const;
const PLACEMENT_LOAD_STATUSES = [
  'created',
  'bids_received',
  'truck_assigned',
  'in_transit_loading',
] as const;

export interface PlacementBoardQuery {
  tab?: PlacementTab;
  q?: string;
  tenantId?: string;
  page?: number;
  limit?: number;
}

export interface BrokerCallInput {
  partnerId: string;
  outcome: CallOutcome;
  quotedRate?: number;
  remarks?: string;
}

/** IST midnight of `now`, as a UTC instant. */
function istDayStart(now: Date): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

/**
 * Placement's work queue and load page (Figma "Placement Work Queue", "Details · Sourcing / Load
 * Memo / Call history / Activity"): the queue with its tabs and tiles, the load's requirements,
 * pricing guidance and bid window, the matched brokers (with ones added by hand), every response a
 * broker gave, the broker calls, extending the bid window, and the requirement sent to brokers.
 * Bids themselves are logged through LsSourcingService.recordPartnerBid.
 */
export class LsPlacementBoardService extends LsServiceBase {
  constructor(
    repository: LoadsmartRepository,
    loadActivityService: LoadActivityService,
    auditService: AuditService,
    private readonly dataSource: DataSource,
    private readonly settings: SettingsReader,
    private readonly consoleRepository: ConsoleRepository,
    private readonly sourcingService: LsSourcingService,
    now?: () => Date,
  ) {
    super(repository, loadActivityService, auditService, now);
  }

  // --- Work queue ----------------------------------------------------------------------------

  async board(actorId: string, query: PlacementBoardQuery) {
    try {
      const sourcings = await this.repository.sourcings.find({
        where: {
          status: In([...PLACEMENT_SOURCING_STATUSES]),
          ...(query.tenantId ? { tenantId: query.tenantId } : {}),
          load: { status: In([...PLACEMENT_LOAD_STATUSES]) },
        },
        relations: { load: { posting: true, truckType: true } },
        order: { createdAt: 'DESC' },
        take: 1000,
      });
      const rows = await this.rowsFor(sourcings);
      const now = this.now();
      const todayStart = istDayStart(now);
      const todayEnd = new Date(todayStart.getTime() + DAY_MS);
      const q = query.q?.toLowerCase();
      const searched = q
        ? rows.filter((row) =>
            [
              row.loadCode,
              row.lrNumber,
              row.shipperName,
              row.route.from,
              row.route.to,
              row.vehicleNumber,
            ].some((value) => value?.toLowerCase().includes(q)),
          )
        : rows;
      const withTabs = searched.map((row) => ({
        row,
        tabs: placementTabs(
          {
            placed: row.placed,
            activeBids: row.activeBids,
            ownerId: row.ownerId,
            reportingAt: row.reportingAt,
            memo: row.memo,
          },
          actorId,
          todayStart.toISOString(),
          todayEnd.toISOString(),
        ),
      }));
      const counts = Object.fromEntries(
        PLACEMENT_TABS.map((tab) => [
          tab,
          withTabs.filter((item) => item.tabs.includes(tab)).length,
        ]),
      ) as Record<PlacementTab, number>;
      const tab = query.tab ?? 'all';
      const shown = withTabs.filter((item) => item.tabs.includes(tab));
      const limit = Math.min(query.limit ?? 10, 200);
      const page = Math.max(query.page ?? 1, 1);
      return {
        tiles: {
          // Loads this Placement member owns.
          loadsWorked: rows.filter((row) => row.ownerId === actorId).length,
          placed: counts.placed,
          notPlaced: rows.length - counts.placed,
          memoConfirmed: counts.memo_confirmed,
        },
        counts,
        total: shown.length,
        page,
        limit,
        items: shown.slice((page - 1) * limit, page * limit).map(({ row, tabs }) => ({
          ...row,
          tabs,
        })),
      };
    } catch (error) {
      rethrow(error, "Failed to read Placement's queue");
    }
  }

  // --- Load page -----------------------------------------------------------------------------

  /** Header, Load requirements, Pricing guidance, bid window, rate handoff, team contacts and the
   *  latest bid per broker. The matched brokers, bid history, calls and activity have their own
   *  calls. */
  async page(sourcingId: string) {
    try {
      const sourcing = await this.repository.sourcings.findOne({
        where: { id: sourcingId },
        relations: { load: { posting: true, truckType: true }, partner: true },
      });
      if (!sourcing) throw new NotFoundError(`Loadsmart sourcing ${sourcingId} not found`);
      const load = sourcing.load;
      const posting = load.posting;
      const [[row], terms, settings, placement, shipper, latestMemo] = await Promise.all([
        this.rowsFor([sourcing]),
        this.sourcingService.getTerms(sourcing.tenantId),
        this.settings.forLoad(load),
        this.sourcingService.placement(sourcingId),
        this.consoleRepository.shipperDetails(sourcing.tenantId),
        this.dataSource.getRepository(LoadMemoEntity).findOne({
          where: { loadId: load.id },
          order: { sentAt: 'DESC' },
        }),
      ]);
      const staff = await this.consoleRepository.staffContacts([
        sourcing.placementOwnerId,
        shipper?.salesUserId ?? null,
        posting?.postedBy ?? null,
      ]);
      const contact = (id: string | null | undefined) => (id ? (staff.get(id) ?? null) : null);
      const tonnes = Number(load.plannedCapacityTonnes);
      const expected = row.expectedPrice;
      const shipperPrice = sourcing.shipperPrice
        ? tripAmount(Number(sourcing.shipperPrice), load.freightType, tonnes)
        : expected;
      const window = this.bidWindow(posting);
      const chosen = placement.bids.find((bid) => bid.status === 'sent' || bid.status === 'won');
      return {
        ...row,
        sourcingStatus: sourcing.status,
        requirements: {
          pickup: posting?.pickupAddress?.label ?? posting?.pickupAddress?.city ?? null,
          drop: posting?.dropAddress?.label ?? posting?.dropAddress?.city ?? null,
          truckType: load.truckType?.name ?? load.feetWheels ?? null,
          truckLengthFt: posting?.truckLengthFt ? Number(posting.truckLengthFt) : null,
          goods: posting?.commodityName ?? null,
          weightTonnes: Number.isFinite(tonnes) ? tonnes : null,
          reportBy: posting?.pickupAt ?? null,
          shipperBalanceTermsDays: terms.creditDays,
        },
        pricing: {
          expectedPrice: expected,
          shipperPrice,
          marketRate: await this.marketRate(row.route.from, row.route.to, sourcing.id),
          // The highest carrier rate that still leaves Settings' margin floor.
          rateCeiling:
            shipperPrice !== null
              ? rateCeiling(shipperPrice, settings.values.marginFloorPercent)
              : null,
          marginPercent: Number(sourcing.marginPercent),
          marginFloorPercent: settings.values.marginFloorPercent,
        },
        bidWindow: window,
        requirementSent: sourcing.requirementSentAt
          ? { at: sourcing.requirementSentAt, brokers: sourcing.requirementSentCount }
          : null,
        rateHandoff: {
          broker: sourcing.partner
            ? { id: sourcing.partner.id, name: sourcing.partner.name }
            : chosen
              ? chosen.partner
              : null,
          chosenRate: sourcing.partnerRate
            ? Number(sourcing.partnerRate)
            : chosen
              ? Number(chosen.rate)
              : null,
          // Loadsmart's price to the shipper, once sent.
          shipperPrice: sourcing.shipperPrice ? Number(sourcing.shipperPrice) : null,
          priceSentAt: sourcing.bidSentAt,
        },
        latestBids: placement.bids,
        callList: placement.callList,
        memo: {
          state: row.memo,
          latest: latestMemo,
          truckNumber: load.vehicleNumber,
          driverName: load.driverName,
          driverPhone: load.driverNumber,
          drivingLicence: load.driverLicenceNumber,
        },
        teamContacts: {
          placementOwner: contact(sourcing.placementOwnerId),
          driver: load.driverName ? { name: load.driverName, phone: load.driverNumber } : null,
          broker: sourcing.partner
            ? { name: sourcing.partner.name, phone: sourcing.partner.phone }
            : null,
          shipperOperations: contact(posting?.postedBy),
          unloadingContact: load.unloadingContactName
            ? { name: load.unloadingContactName, phone: load.unloadingContactPhone }
            : null,
          shipperSales: contact(shipper?.salesUserId),
        },
      };
    } catch (error) {
      rethrow(error, 'Failed to read the placement page');
    }
  }

  // --- Brokers -------------------------------------------------------------------------------

  /** "Add broker": puts a broker on this load's matched list by hand. */
  async addBroker(actorId: string, sourcingId: string, partnerId: string) {
    try {
      const sourcing = await this.assertSourcing(sourcingId);
      const partner = await this.repository.partners.findOneBy({ id: partnerId });
      if (!partner || partner.status !== 'active') throw new NotFoundError('Broker not found');
      const repo = this.dataSource.getRepository(LsSourcingBrokerEntity);
      if (await repo.findOneBy({ sourcingId, partnerId })) {
        throw new ConflictError(`${partner.name} is already on this load's list`);
      }
      await repo.save(repo.create({ sourcingId, partnerId, addedBy: actorId }));
      await this.step(sourcing, actorId, 'broker_added', 'LS_BROKER_ADDED', {
        partnerId,
        partnerName: partner.name,
      });
      return { partnerId, name: partner.name, phone: partner.phone, added: true };
    } catch (error) {
      rethrow(error, 'Failed to add the broker');
    }
  }

  async removeBroker(actorId: string, sourcingId: string, partnerId: string) {
    try {
      const sourcing = await this.assertSourcing(sourcingId);
      const result = await this.dataSource
        .getRepository(LsSourcingBrokerEntity)
        .delete({ sourcingId, partnerId });
      if (!result.affected) throw new NotFoundError('That broker was not added to this load');
      await this.step(sourcing, actorId, 'broker_removed', 'LS_BROKER_ADDED', {
        partnerId,
        removed: true,
      });
    } catch (error) {
      rethrow(error, 'Failed to remove the broker');
    }
  }

  /** Brokers added by hand to these loads, by sourcing. */
  async addedBrokers(sourcingIds: string[]): Promise<Map<string, Set<string>>> {
    const rows = sourcingIds.length
      ? await this.dataSource
          .getRepository(LsSourcingBrokerEntity)
          .findBy({ sourcingId: In(sourcingIds) })
      : [];
    const bySourcing = new Map<string, Set<string>>();
    for (const row of rows) {
      const set = bySourcing.get(row.sourcingId) ?? new Set<string>();
      set.add(row.partnerId);
      bySourcing.set(row.sourcingId, set);
    }
    return bySourcing;
  }

  /** "Broker bid history": every response this broker gave on the load, newest first. */
  async bidHistory(sourcingId: string, partnerId: string) {
    await this.assertSourcing(sourcingId);
    const partner = await this.repository.partners.findOneBy({ id: partnerId });
    if (!partner) throw new NotFoundError('Broker not found');
    const responses = await this.dataSource.getRepository(LsPartnerBidResponseEntity).find({
      where: { sourcingId, partnerId },
      order: { createdAt: 'DESC' },
    });
    return {
      partner: { id: partner.id, name: partner.name },
      responses: responses.map((response) => ({
        id: response.id,
        at: response.createdAt,
        response: response.response,
        rate: response.rate === null ? null : Number(response.rate),
        channel: response.channel,
        note: response.note,
        vehicleNumber: response.vehicleNumber,
        enteredBy: response.enteredBy,
      })),
    };
  }

  // --- Broker calls --------------------------------------------------------------------------

  /** "Log broker call": outcome, quoted rate, remarks — on the load's call log. */
  async logBrokerCall(actorId: string, sourcingId: string, input: BrokerCallInput) {
    try {
      const sourcing = await this.assertSourcing(sourcingId);
      const partner = await this.repository.partners.findOneBy({ id: input.partnerId });
      if (!partner) throw new NotFoundError('Broker not found');
      const repo = this.dataSource.getRepository(LsCallLogEntity);
      const now = this.now();
      const saved = await repo.save(
        repo.create({
          tenantId: sourcing.tenantId,
          loadId: sourcing.loadId,
          sourcingId: sourcing.id,
          calledBy: actorId,
          calledAt: now,
          contact: 'broker',
          phone: partner.phone,
          outcome: input.outcome,
          note: input.remarks ?? null,
          partnerId: partner.id,
          quotedRate: input.quotedRate === undefined ? null : String(input.quotedRate),
        }),
      );
      await this.step(sourcing, actorId, 'broker_call', 'LS_BROKER_CALL_LOGGED', {
        partnerId: partner.id,
        partnerName: partner.name,
        outcome: input.outcome,
        quotedRate: input.quotedRate ?? null,
      });
      return { ...saved, partnerName: partner.name };
    } catch (error) {
      rethrow(error, 'Failed to log the broker call');
    }
  }

  /** "Broker call history": every broker call on the load, grouped by broker, newest first. */
  async brokerCalls(sourcingId: string) {
    await this.assertSourcing(sourcingId);
    const calls = await this.dataSource.getRepository(LsCallLogEntity).find({
      where: { sourcingId, contact: 'broker' },
      order: { calledAt: 'DESC' },
    });
    const partnerIds = [
      ...new Set(calls.map((call) => call.partnerId).filter(Boolean)),
    ] as string[];
    const partners = partnerIds.length
      ? await this.repository.partners.findBy({ id: In(partnerIds) })
      : [];
    const groups = new Map<
      string,
      { partnerId: string | null; name: string | null; calls: unknown[] }
    >();
    for (const call of calls) {
      const key = call.partnerId ?? 'unknown';
      const group = groups.get(key) ?? {
        partnerId: call.partnerId,
        name: partners.find((partner) => partner.id === call.partnerId)?.name ?? null,
        calls: [],
      };
      group.calls.push({
        id: call.id,
        at: call.calledAt,
        outcome: call.outcome,
        quotedRate: call.quotedRate === null ? null : Number(call.quotedRate),
        remarks: call.note,
        calledBy: call.calledBy,
      });
      groups.set(key, group);
    }
    return [...groups.values()];
  }

  // --- Bid window and requirement ------------------------------------------------------------

  /** "Extend bid window": adds hours to the load's bid window (it applies to every bidder). */
  async extendBidWindow(actorId: string, sourcingId: string, hours: number, reason?: string) {
    try {
      if (hours < 1 || hours > MAX_BID_WINDOW_EXTENSION_HOURS) {
        throw new ValidationError(
          `Add between 1 and ${MAX_BID_WINDOW_EXTENSION_HOURS} hours at a time`,
        );
      }
      const sourcing = await this.assertSourcing(sourcingId);
      const load = sourcing.load;
      if (load.postingType !== 'market_fleet') {
        throw new ConflictError('Only a market load has a bid window');
      }
      if (load.status !== 'created' && load.status !== 'bids_received') {
        throw new ConflictError('This load already has a truck — its bidding is over');
      }
      if (!load.postingId) throw new ConflictError('This load has no posting');
      const postings = this.dataSource.getRepository(LoadPostingEntity);
      const posting = await postings.findOneBy({ id: load.postingId });
      if (!posting) throw new NotFoundError('Posting not found');
      const before = bidWindowClosesAt(posting.createdAt, posting.bidWindowExtraMinutes);
      // A window that already closed reopens from now, not from its old end.
      const now = this.now();
      const extraFromNow = before < now ? Math.ceil((now.getTime() - before.getTime()) / 60000) : 0;
      const extraMinutes = posting.bidWindowExtraMinutes + extraFromNow + hours * 60;
      await postings.update({ id: posting.id }, { bidWindowExtraMinutes: extraMinutes });
      const closesAt = bidWindowClosesAt(posting.createdAt, extraMinutes);
      await this.step(sourcing, actorId, 'bid_window_extended', 'LS_BID_WINDOW_EXTENDED', {
        hours,
        reason: reason ?? null,
        closedAt: before.toISOString(),
        closesAt: closesAt.toISOString(),
      });
      return this.bidWindow({ ...posting, bidWindowExtraMinutes: extraMinutes });
    } catch (error) {
      rethrow(error, 'Failed to extend the bid window');
    }
  }

  /** "Send Requirement": the message for brokers (no shipper name, no price) and a WhatsApp link
   *  per broker — the console opens them; nothing is sent from the server. Records who it went to.
   *  Without `partnerIds`, the load's matched brokers (and any added by hand). */
  async sendRequirement(actorId: string, sourcingId: string, partnerIds?: string[]) {
    try {
      const sourcing = await this.repository.sourcings.findOne({
        where: { id: sourcingId },
        relations: { load: { posting: true, truckType: true } },
      });
      if (!sourcing) throw new NotFoundError(`Loadsmart sourcing ${sourcingId} not found`);
      if (!['posted', 'bid_sent'].includes(sourcing.status)) {
        throw new ConflictError('The requirement goes out while the load is on the load board');
      }
      const ids = partnerIds?.length ? partnerIds : await this.matchedPartnerIds(sourcing);
      if (!ids.length) throw new ConflictError('No broker to send it to — add a broker first');
      const partners = await this.repository.partners.findBy({ id: In(ids), status: 'active' });
      if (!partners.length) throw new NotFoundError('None of those brokers is active');
      const load = sourcing.load;
      const posting = load.posting;
      const message = requirementMessage({
        loadCode: load.code,
        from: posting?.pickupAddress?.city ?? null,
        to: posting?.dropAddress?.city ?? null,
        reportingAt: posting?.pickupAt ?? null,
        truck:
          [load.truckType?.name, posting?.truckLengthFt ? `${posting.truckLengthFt} ft` : null]
            .filter(Boolean)
            .join(' · ') || null,
        goods: posting?.commodityName ?? null,
        tonnes: Number(load.plannedCapacityTonnes) || null,
      });
      const now = this.now();
      await this.repository.sourcings.update(
        { id: sourcing.id },
        { requirementSentAt: now, requirementSentCount: partners.length },
      );
      await this.step(sourcing, actorId, 'requirement_sent', 'LS_REQUIREMENT_SENT', {
        partnerIds: partners.map((partner) => partner.id),
        channel: 'whatsapp',
      });
      return {
        message,
        sentAt: now,
        recipients: partners.map((partner) => ({
          partnerId: partner.id,
          name: partner.name,
          phone: partner.phone,
          whatsappUrl: whatsappLink(partner.phone, message),
        })),
      };
    } catch (error) {
      rethrow(error, 'Failed to send the requirement');
    }
  }

  // --- Helpers -------------------------------------------------------------------------------

  private bidWindow(
    posting: Pick<LoadPostingEntity, 'createdAt' | 'bidWindowExtraMinutes'> | null,
  ) {
    if (!posting) return null;
    const closesAt = bidWindowClosesAt(posting.createdAt, posting.bidWindowExtraMinutes);
    return {
      hours: Math.round(((BID_WINDOW_MS / 60000 + posting.bidWindowExtraMinutes) / 60) * 10) / 10,
      extendedByMinutes: posting.bidWindowExtraMinutes,
      opensAt: posting.createdAt,
      closesAt,
      closed: this.now() >= closesAt,
    };
  }

  /** Brokers matched by truck type or lane, plus any added by hand. */
  private async matchedPartnerIds(sourcing: LsSourcingEntity): Promise<string[]> {
    const [{ brokers }, added] = await Promise.all([
      this.matchFor(sourcing),
      this.addedBrokers([sourcing.id]),
    ]);
    return [
      ...new Set([
        ...brokers.filter((broker) => broker.matched).map((broker) => broker.partnerId),
        ...(added.get(sourcing.id) ?? []),
      ]),
    ];
  }

  private async matchFor(sourcing: LsSourcingEntity) {
    const load = sourcing.load;
    const lane = {
      fromCity: load.posting?.pickupAddress?.city ?? null,
      toCity: load.posting?.dropAddress?.city ?? null,
      bodyType: load.truckType?.bodyType ?? null,
      capacityTons: load.truckType?.capacityTons ?? null,
    };
    const partners = await this.repository.listBrokersWithClaims();
    const brokers = rankBrokers(
      lane,
      partners.map((partner) => ({
        partnerId: partner.id,
        name: partner.name,
        phone: partner.phone,
        lanes: partner.lanes ?? [],
        truckTypes: partner.truckTypes ?? [],
      })),
      new Map(),
      new Map(),
    );
    return { lane, brokers };
  }

  /** The median carrier trip amount on this lane over the last 90 days, from won loads. */
  private async marketRate(from: string | null, to: string | null, excludeId: string) {
    if (!from || !to) return null;
    const won = await this.repository.sourcings.find({
      where: {
        status: 'won',
        postedAt: MoreThan(new Date(this.now().getTime() - MARKET_RATE_WINDOW_MS)),
      },
      relations: { load: { posting: true } },
      take: 1000,
    });
    const same = (a: string | null | undefined, b: string) =>
      !!a && a.trim().toLowerCase() === b.trim().toLowerCase();
    const rates = won
      .filter(
        (row) =>
          row.id !== excludeId &&
          row.partnerRate &&
          same(row.load.posting?.pickupAddress?.city, from) &&
          same(row.load.posting?.dropAddress?.city, to),
      )
      .map((row) =>
        tripAmount(
          Number(row.partnerRate),
          row.load.freightType,
          Number(row.load.plannedCapacityTonnes),
        ),
      );
    return median(rates);
  }

  /** One queue row per sourcing, with what every tab and column needs. */
  private async rowsFor(sourcings: LsSourcingEntity[]) {
    if (!sourcings.length) return [];
    const ids = sourcings.map((sourcing) => sourcing.id);
    const loadIds = sourcings.map((sourcing) => sourcing.loadId);
    const tenantIds = [...new Set(sourcings.map((sourcing) => sourcing.tenantId))];
    const [orgs, bids, memos, added, brokerPool] = await Promise.all([
      this.dataSource
        .getRepository(OrganizationEntity)
        .find({ where: { id: In(tenantIds) }, select: { id: true, name: true } }),
      this.repository.partnerBids.findBy({ sourcingId: In(ids), status: In(['received', 'sent']) }),
      this.dataSource.getRepository(LoadMemoEntity).find({
        where: { loadId: In(loadIds) },
        order: { sentAt: 'DESC' },
      }),
      this.addedBrokers(ids),
      this.repository.listBrokersWithClaims(),
    ]);
    const now = this.now();
    const candidates = brokerPool.map((partner) => ({
      partnerId: partner.id,
      name: partner.name,
      phone: partner.phone,
      lanes: partner.lanes ?? [],
      truckTypes: partner.truckTypes ?? [],
    }));
    return sourcings.map((sourcing) => {
      const load: LoadEntity = sourcing.load;
      const posting = load.posting;
      const tonnes = Number(load.plannedCapacityTonnes);
      const rate = load.expectedRate ?? load.freightValue;
      const matched = rankBrokers(
        {
          fromCity: posting?.pickupAddress?.city ?? null,
          toCity: posting?.dropAddress?.city ?? null,
          bodyType: load.truckType?.bodyType ?? null,
          capacityTons: load.truckType?.capacityTons ?? null,
        },
        candidates,
        new Map(),
        new Map(),
      ).filter((broker) => broker.matched);
      const matchedIds = new Set([
        ...matched.map((broker) => broker.partnerId),
        ...(added.get(sourcing.id) ?? []),
      ]);
      const latestMemo = memos.find((memo) => memo.loadId === load.id) ?? null;
      const memo: MemoState = memoState(load.memoAcceptedAt ?? null, latestMemo, now);
      return {
        sourcingId: sourcing.id,
        loadId: load.id,
        loadCode: load.code,
        lrNumber: load.elrNumber,
        loadStatus: load.status,
        tenantId: sourcing.tenantId,
        shipperName: orgs.find((org) => org.id === sourcing.tenantId)?.name ?? null,
        goods: posting?.commodityName ?? null,
        route: {
          from: posting?.pickupAddress?.city ?? null,
          to: posting?.dropAddress?.city ?? null,
          // Not stored on the posting yet.
          distanceKm: null as number | null,
        },
        reportingAt: posting?.pickupAt?.toISOString() ?? null,
        truckType: load.truckType?.name ?? load.feetWheels ?? null,
        expectedPrice: rate ? tripAmount(Number(rate), load.freightType, tonnes) : null,
        brokersMatched: matchedIds.size,
        activeBids: bids.filter((bid) => bid.sourcingId === sourcing.id).length,
        placed: sourcing.status === 'won' && Boolean(load.vehicleNumber),
        vehicleNumber: load.vehicleNumber,
        ownerId: sourcing.placementOwnerId,
        memo,
      };
    });
  }
}
