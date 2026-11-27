import { DataSource, In, MoreThan } from 'typeorm';
import { ConflictError, NotFoundError, ValidationError, rethrow } from '../../shared/errors';
import { AuditService } from '../audit/audit.service';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadMemoEntity } from '../loads/memo/load-memo.entity';
import { LoadPostingEntity } from '../loads/load-posting/entities/load-posting.entity';
import { LoadRecipientEntity } from '../loads/load-posting/entities/load-recipient.entity';
import { PostAddress } from '../loads/load-posting/utils/load-posting.types';
import { BID_WINDOW_MS, bidWindowClosesAt } from '../loads/bids/bid-rules';
import { OrganizationEntity } from '../organization/entities/organization.entity';
import { SettingsReader } from '../settings/settings.types';
import { ConsoleRepository } from './console.repository';
import { LsCallLogEntity } from './entities/ls-call-log.entity';
import { LsPartnerBidResponseEntity } from './entities/ls-partner-bid-response.entity';
import { LsSourcingBrokerEntity } from './entities/ls-sourcing-broker.entity';
import { LsRequirementRecipientEntity } from './entities/ls-requirement-recipient.entity';
import { BrokerEntity } from '../loads/brokers/broker.entity';
import { LsSourcingEntity } from './entities/ls-sourcing.entity';
import { LoadsmartRepository } from './loadsmart.repository';
import { CallOutcome } from './loadsmart.types';
import { tripAmount } from './loadsmart-rules';
import { loadsmartBidEvents } from './bid-history-rules';
import { LoadBidEntity } from '../loads/bids/load-bid.entity';
import { LoadActivityEntity } from '../loads/entities/load-activity.entity';
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
  brokersClosedReason,
  whatsappFailureOf,
} from './placement-board-rules';
import { routeOf } from '../lane-matching';
import type { BrokerMatcher } from './loadsmart.interface';
import { GoogleRoutesClient, LatLng } from '../../adapters/google-routes.client';
import { GooglePlacesClient } from '../../adapters/google-places.client';
import { AddressPinLookup, pinForAddress } from '../places/address-pin';
import { TruckBodyType } from '../masters/truck-type/truck-type.types';

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

/** Most postings whose road distance is looked up on Google in one queue load — the rest are
 *  filled on a later load (each is looked up once, then kept on the posting). */
const MAX_DISTANCE_LOOKUPS_PER_CALL = 10;

/** Truck-master body classes → the picker's open/closed, for postings with no truckPick. */
const BODY_OF_FAMILY: Partial<Record<TruckBodyType, 'open' | 'closed'>> = {
  open_body: 'open',
  lcv_open_body: 'open',
  container: 'closed',
  lcv_container: 'closed',
};

/** Open or closed body of the truck the load asks for; null when neither the posting's picker
 *  choice nor the truck master row says. */
function truckBodyOf(load: LoadEntity): 'open' | 'closed' | null {
  const picked = load.posting?.truckPick?.body;
  if (picked === 'open' || picked === 'closed') return picked;
  const family = load.truckType?.bodyType;
  return (family && BODY_OF_FAMILY[family]) ?? null;
}

/** A posting address's point, when it has one. */
function pointOf(address: PostAddress | null | undefined): LatLng | null {
  const lat = Number(address?.latitude);
  const lng = Number(address?.longitude);
  return address?.latitude != null &&
    address?.longitude != null &&
    Number.isFinite(lat) &&
    Number.isFinite(lng)
    ? { lat, lng }
    : null;
}

/** IST midnight of `now`, as a UTC instant. */
function istDayStart(now: Date): Date {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  ist.setUTCHours(0, 0, 0, 0);
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

/** A posting address as the load page shows it: "Plot 66, Gate 1" / "Focal point, Rajpura" /
 *  "Punjab – 140401", plus the raw parts. */
function fullAddress(address: PostAddress | null | undefined) {
  if (!address) return null;
  const join = (parts: (string | null | undefined)[], sep: string) =>
    parts.filter((part) => part && part.trim()).join(sep) || null;
  const line1 = address.addressLine1 ?? null;
  const line2 = join([address.areaLocality, address.city], ', ');
  const line3 = join([address.state, address.pinCode], ' – ');
  return {
    label: address.label ?? null,
    addressLine1: address.addressLine1 ?? null,
    areaLocality: address.areaLocality ?? null,
    city: address.city ?? null,
    state: address.state ?? null,
    pinCode: address.pinCode ?? null,
    latitude: address.latitude ?? null,
    longitude: address.longitude ?? null,
    line1,
    line2,
    line3,
    full: join([line1, line2, line3], ', '),
  };
}

/**
 * Placement's work queue and load page (Figma "Placement Work Queue", "Details · Sourcing / Load
 * Memo / Call history / Activity"): the queue with its tabs and tiles, the load's requirements,
 * pricing guidance and bid window, the matched brokers (with ones added by hand), every response a
 * broker gave, the broker calls, extending the bid window, and the requirement sent to brokers.
 * Bids themselves are logged through LsSourcingService.recordPartnerBid.
 */
/** Brokers are added only while Placement is still sourcing the load. */
function assertOpenForBrokers(sourcing: LsSourcingEntity): void {
  const closed = brokersClosedReason(sourcing.status);
  if (closed) throw new ConflictError(closed);
}

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

  private brokerMatcher?: BrokerMatcher;

  /** Road distance for postings that don't have one yet. */
  private readonly routes: Pick<GoogleRoutesClient, 'drivingRoute'> = new GoogleRoutesClient();

  /** Pins a posting address with no map point from its text (most addresses picked from the
   *  masters were saved without one). */
  private readonly pinLookup: AddressPinLookup = new GooglePlacesClient();

  /**
   * Looks up and keeps the road distance of postings that have no distance yet (at most
   * MAX_DISTANCE_LOOKUPS_PER_CALL per call), and sets it on the loaded entities so this call's
   * rows show it. An address without a map point is first pinned from its text and the point is
   * kept on the posting, so it is looked up only once. Fail-soft: a posting Google can't pin or
   * route stays null.
   */
  private async fillDistances(sourcings: LsSourcingEntity[]): Promise<void> {
    const pending = new Map<string, LoadPostingEntity>();
    for (const sourcing of sourcings) {
      if (pending.size >= MAX_DISTANCE_LOOKUPS_PER_CALL) break;
      const posting = sourcing.load?.posting;
      if (!posting || posting.distanceKm != null || pending.has(posting.id)) continue;
      if (!posting.pickupAddress || !posting.dropAddress) continue;
      pending.set(posting.id, posting);
    }
    if (!pending.size) return;
    const postings = this.dataSource.getRepository(LoadPostingEntity);
    await Promise.all(
      [...pending.values()].map(async (posting) => {
        try {
          const [pickup, drop] = await Promise.all([
            this.withPoint(posting.pickupAddress!),
            this.withPoint(posting.dropAddress!),
          ]);
          const from = pointOf(pickup);
          const to = pointOf(drop);
          const route = from && to ? await this.routes.drivingRoute(from, to) : null;
          const km = route ? Math.round(route.distanceM / 1000) : null;
          const pinned = {
            ...(pickup !== posting.pickupAddress ? { pickupAddress: pickup } : {}),
            ...(drop !== posting.dropAddress ? { dropAddress: drop } : {}),
          };
          if (km === null && !Object.keys(pinned).length) return;
          await postings.update({ id: posting.id }, { ...pinned, distanceKm: km });
          // One posting can sit under several sourcings (one per truck).
          for (const sourcing of sourcings) {
            const row = sourcing.load?.posting;
            if (row?.id === posting.id) Object.assign(row, pinned, { distanceKm: km });
          }
        } catch (error) {
          console.warn('[placement] could not fill posting distance', posting.id, error);
        }
      }),
    );
  }

  /** The address with a map point: as is when it has one, else pinned from its text (the same
   *  object back when Google can't match it). */
  private async withPoint(address: PostAddress): Promise<PostAddress> {
    if (pointOf(address)) return address;
    const pin = await pinForAddress(this.pinLookup, { ...address, title: address.label });
    return pin ? { ...address, ...pin } : address;
  }

  /** Which of Loadsmart's brokers run each load's lane (modules/lane-matching). */
  setBrokerMatcher(matcher: BrokerMatcher): void {
    this.brokerMatcher = matcher;
  }

  /** The brokers on each sourcing's lane, in the same order (empty without a matcher). */
  private async laneMatchesFor(sourcings: readonly LsSourcingEntity[]) {
    if (!this.brokerMatcher) return sourcings.map(() => []);
    return this.brokerMatcher.matchBrokersMany(
      sourcings.map((sourcing) =>
        routeOf(sourcing.load.posting?.pickupAddress, sourcing.load.posting?.dropAddress),
      ),
    );
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
      const [[row], terms, settings, placement, shipper, latestMemo, ownTransporters] =
        await Promise.all([
          this.rowsFor([sourcing]),
          this.sourcingService.getTerms(sourcing.tenantId),
          this.settings.forLoad(load),
          this.sourcingService.placement(sourcingId),
          this.consoleRepository.shipperDetails(sourcing.tenantId),
          this.dataSource.getRepository(LoadMemoEntity).findOne({
            where: { loadId: load.id },
            order: { sentAt: 'DESC' },
          }),
          // The shipper's own transporters the posting went to — who Loadsmart competes with.
          posting
            ? this.dataSource
                .getRepository(LoadRecipientEntity)
                .countBy({ postingId: posting.id, recipientType: 'transporter' })
            : Promise.resolve(0),
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
          pickupAddress: fullAddress(posting?.pickupAddress),
          dropAddress: fullAddress(posting?.dropAddress),
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
        postedAt: posting?.createdAt ?? null,
        competing: { ownTransporters },
        requirementSent: sourcing.requirementSentAt
          ? { at: sourcing.requirementSentAt, brokers: sourcing.requirementSentCount }
          : null,
        rateHandoff: {
          broker: sourcing.partner
            ? { id: sourcing.partner.id, name: sourcing.partner.name }
            : chosen
              ? chosen.partner
              : null,
          // Trip totals, as the broker quoted and the shipper is priced.
          chosenRate: sourcing.partnerRate
            ? this.tripRateOf(sourcing.partnerRate, load)
            : chosen
              ? chosen.tripRate
              : null,
          // Loadsmart's price to the shipper, once sent.
          shipperPrice: sourcing.shipperPrice ? shipperPrice : null,
          priceSentAt: sourcing.bidSentAt,
        },
        latestBids: placement.bids,
        // The shipper's counters on Loadsmart's bids, waiting for Placement (trip totals).
        shipperCounters: await this.sourcingService.shipperCounters(sourcing),
        callList: placement.callList,
        memo: {
          state: row.memo,
          latest: latestMemo,
          // What VAHAN and Sarathi answered, and what still keeps the memo from going out.
          checks: await this.sourcingService.checksOf(load, sourcing.tenantId),
          // The photos Placement uploaded with the driver — what a manual licence check is read
          // against; open them with the storage `by-key` endpoint.
          licencePhotos: {
            front: sourcing.licenceFrontFileKey ?? null,
            back: sourcing.licenceBackFileKey ?? null,
            rcCopy: sourcing.rcCopyFileKey ?? null,
          },
          licencePhotoUrls: await this.sourcingService.photoLinks({
            front: sourcing.licenceFrontFileKey,
            back: sourcing.licenceBackFileKey,
            rcCopy: sourcing.rcCopyFileKey,
          }),
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
  async addBroker(
    actorId: string,
    sourcingId: string,
    pick: { partnerId?: string; brokerId?: string },
  ) {
    try {
      const sourcing = await this.assertSourcing(sourcingId);
      assertOpenForBrokers(sourcing);
      // A broker from the broker master gets its partner row (where its bids are kept) first.
      const partnerId = pick.brokerId
        ? await this.brokerMatcher?.partnerForBroker(pick.brokerId)
        : pick.partnerId;
      if (!partnerId) throw new NotFoundError('Broker not found or not approved');
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

  /** Adds several broker-master brokers at once. One that is already listed or no longer
   *  approved lands in `failed` and does not stop the others. */
  async addBrokers(actorId: string, sourcingId: string, brokerIds: string[]) {
    assertOpenForBrokers(await this.assertSourcing(sourcingId));
    const added: { brokerId: string; partnerId: string; name: string }[] = [];
    const failed: { brokerId: string; reason: string }[] = [];
    for (const brokerId of new Set(brokerIds)) {
      try {
        const result = await this.addBroker(actorId, sourcingId, { brokerId });
        added.push({ brokerId, partnerId: result.partnerId, name: result.name });
      } catch (error) {
        failed.push({
          brokerId,
          reason: error instanceof Error ? error.message : 'Failed to add the broker',
        });
      }
    }
    return { added, failed };
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

  /** "Broker bid history", newest first: every response this broker gave on the load, and what
   *  happened to Loadsmart's bids built on theirs — sent to the shipper, countered, the counter
   *  taken to the broker, the answer, and rejected / lost / won. `source` tells them apart:
   *  `broker` rows are what the broker said; `loadsmart` rows are Loadsmart's side. Rates are
   *  trip totals. */
  async bidHistory(sourcingId: string, partnerId: string) {
    const sourcing = await this.assertSourcing(sourcingId);
    const partner = await this.repository.partners.findOneBy({ id: partnerId });
    if (!partner) throw new NotFoundError('Broker not found');
    const [responses, partnerBids, counters] = await Promise.all([
      this.dataSource.getRepository(LsPartnerBidResponseEntity).find({
        where: { sourcingId, partnerId },
        order: { createdAt: 'DESC' },
      }),
      this.repository.partnerBids.find({ where: { sourcingId, partnerId }, select: { id: true } }),
      // Every "Counter broker" Placement sent this broker on the load.
      this.dataSource.getRepository(LoadActivityEntity).find({
        where: { loadId: sourcing.loadId, action: 'LOADSMART_STEP', toValue: 'broker_countered' },
      }),
    ]);
    const loadsmartBids = partnerBids.length
      ? await this.dataSource.getRepository(LoadBidEntity).find({
          where: {
            loadId: sourcing.loadId,
            source: 'loadsmart',
            lsPartnerBidId: In(partnerBids.map((bid) => bid.id)),
          },
        })
      : [];
    const trip = (rate: string | null) => this.tripRateOf(rate, sourcing.load);
    const brokerRows = responses.map((response) => ({
      id: response.id,
      source: 'broker' as const,
      at: response.createdAt,
      response: response.response as string,
      // The trip total the broker gave.
      rate: trip(response.rate),
      channel: response.channel as string | null,
      note: response.note,
      vehicleNumber: response.vehicleNumber,
      enteredBy: response.enteredBy,
    }));
    const loadsmartRows = [...loadsmartBidEvents(loadsmartBids, sourcing.load.awardedBidId)].map(
      (event) => ({
        id: event.id,
        source: 'loadsmart' as const,
        at: event.at,
        response: event.event as string,
        rate: trip(event.rate),
        channel: null as string | null,
        note: event.note,
        vehicleNumber: null as string | null,
        enteredBy: null as string | null,
      }),
    );
    const counterRows = counters
      .filter((row) => row.metadata?.partnerId === partnerId)
      .map((row) => ({
        id: row.id,
        source: 'loadsmart' as const,
        at: row.createdAt,
        response: 'broker_countered',
        // Already a trip total, with Loadsmart's margin out.
        rate: Number(row.metadata?.brokerRate) || null,
        channel: null as string | null,
        note: (row.metadata?.note as string | null | undefined) ?? null,
        vehicleNumber: null as string | null,
        enteredBy: row.actorId,
      }));
    return {
      partner: { id: partner.id, name: partner.name },
      responses: [...brokerRows, ...loadsmartRows, ...counterRows].sort(
        (a, b) => b.at.getTime() - a.at.getTime(),
      ),
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

  /** "Send Requirement" (spec step 4): Placement sends the load's WhatsApp offer — LS_N_0105 with
   *  the partner rate, LS_N_0106 asking for rates — from Loadsmart's business number to the
   *  brokers it picked (without `partnerIds`, the matched brokers and any added by hand). A broker
   *  not on WhatsApp gets nothing and is saved `not_on_whatsapp` for Placement to call. A broker
   *  already sent to is skipped, so sending again only reaches the new ones; a failed send is
   *  tried again. Every broker's outcome is saved (ls_requirement_recipients). */
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

      const recipients = this.dataSource.getRepository(LsRequirementRecipientEntity);
      const earlier = await recipients.findBy({
        sourcingId,
        partnerId: In(partners.map((p) => p.id)),
      });
      const alreadySent = new Set(
        earlier.filter((row) => row.status === 'sent').map((row) => row.partnerId),
      );
      const toSend = partners.filter((partner) => !alreadySent.has(partner.id));

      // A broker-master broker marked not on WhatsApp gets no message; Placement calls them.
      const brokerIds = toSend.flatMap((partner) => (partner.brokerId ? [partner.brokerId] : []));
      const offWhatsapp = new Set(
        brokerIds.length
          ? (
              await this.dataSource
                .getRepository(BrokerEntity)
                .findBy({ id: In(brokerIds), isOnWhatsapp: false })
            ).map((broker) => broker.id)
          : [],
      );
      const notOnWhatsapp = toSend.filter(
        (partner) => partner.brokerId && offWhatsapp.has(partner.brokerId),
      );
      const onWhatsapp = toSend.filter((partner) => !notOnWhatsapp.includes(partner));
      const results = await this.sourcingService.sendRequirementOffer(
        sourcing,
        onWhatsapp.map((partner) => ({ id: partner.id, name: partner.name, phone: partner.phone })),
      );

      const now = this.now();
      const outcomes = [
        ...results.map((result) => ({
          partnerId: result.partnerId,
          status: result.status,
          messageLogId: result.messageLogId,
          failReason: result.failReason,
        })),
        ...notOnWhatsapp.map((partner) => ({
          partnerId: partner.id,
          status: 'not_on_whatsapp' as const,
          messageLogId: null,
          failReason: null,
        })),
      ];
      for (const outcome of outcomes) {
        await recipients.upsert(
          {
            sourcingId,
            ...outcome,
            deliveredAt: null,
            readAt: null,
            sentBy: actorId,
            createdAt: now,
          },
          ['sourcingId', 'partnerId'],
        );
      }
      const sentCount = (await recipients.countBy({ sourcingId, status: 'sent' })) ?? 0;
      await this.repository.sourcings.update(
        { id: sourcing.id },
        { requirementSentAt: now, requirementSentCount: sentCount },
      );
      await this.step(sourcing, actorId, 'requirement_sent', 'LS_REQUIREMENT_SENT', {
        sent: outcomes.filter((o) => o.status === 'sent').map((o) => o.partnerId),
        notOnWhatsapp: notOnWhatsapp.map((partner) => partner.id),
        failed: outcomes.filter((o) => o.status === 'failed').map((o) => o.partnerId),
        skippedAlreadySent: [...alreadySent],
        channel: 'whatsapp',
      });

      const byId = new Map(partners.map((partner) => [partner.id, partner]));
      const earlierById = new Map(earlier.map((row) => [row.partnerId, row]));
      return {
        sentAt: now,
        sentCount,
        recipients: [
          ...outcomes.map((outcome) => ({
            partnerId: outcome.partnerId,
            name: byId.get(outcome.partnerId)?.name ?? null,
            phone: byId.get(outcome.partnerId)?.phone ?? null,
            status: outcome.status,
            failReason: outcome.failReason,
            failure: outcome.status === 'failed' ? whatsappFailureOf(outcome.failReason) : null,
            sentAt: now,
            deliveredAt: null,
            readAt: null,
          })),
          // Not sent again: when it first went and what WhatsApp has reported since.
          ...[...alreadySent].map((partnerId) => ({
            partnerId,
            name: byId.get(partnerId)?.name ?? null,
            phone: byId.get(partnerId)?.phone ?? null,
            status: 'already_sent' as const,
            failReason: null,
            failure: null,
            sentAt: earlierById.get(partnerId)?.createdAt ?? null,
            deliveredAt: earlierById.get(partnerId)?.deliveredAt ?? null,
            readAt: earlierById.get(partnerId)?.readAt ?? null,
          })),
        ],
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

  /** Brokers on the load's lane (lane-matching), plus any added by hand. */
  private async matchedPartnerIds(sourcing: LsSourcingEntity): Promise<string[]> {
    const [[matches], added] = await Promise.all([
      this.laneMatchesFor([sourcing]),
      this.addedBrokers([sourcing.id]),
    ]);
    return [
      ...new Set([...matches.map((broker) => broker.partnerId), ...(added.get(sourcing.id) ?? [])]),
    ];
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
    const [orgs, bids, memos, added, laneMatches] = await Promise.all([
      this.dataSource
        .getRepository(OrganizationEntity)
        .find({ where: { id: In(tenantIds) }, select: { id: true, name: true } }),
      this.repository.partnerBids.findBy({ sourcingId: In(ids), status: In(['received', 'sent']) }),
      this.dataSource.getRepository(LoadMemoEntity).find({
        where: { loadId: In(loadIds) },
        order: { sentAt: 'DESC' },
      }),
      this.addedBrokers(ids),
      this.laneMatchesFor(sourcings),
      this.fillDistances(sourcings),
    ]);
    const now = this.now();
    return sourcings.map((sourcing, index) => {
      const load: LoadEntity = sourcing.load;
      const posting = load.posting;
      const tonnes = Number(load.plannedCapacityTonnes);
      const rate = load.expectedRate ?? load.freightValue;
      const matchedIds = new Set([
        ...laneMatches[index].map((broker) => broker.partnerId),
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
          distanceKm: posting?.distanceKm ?? null,
        },
        reportingAt: posting?.pickupAt?.toISOString() ?? null,
        truckType: load.truckType?.name ?? load.feetWheels ?? null,
        truckBody: truckBodyOf(load),
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
