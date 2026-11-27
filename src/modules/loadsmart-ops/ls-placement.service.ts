import { whatsappFailureOf } from './placement-board-rules';
import { In, IsNull } from 'typeorm';
import { routeOf } from '../lane-matching';
import { ConflictError, NotFoundError, rethrow, ValidationError } from '../../shared/errors';
import { LS_MONEY_APPROVE } from '../../shared/constants/permissions';
import { ADMIN_TEAM, PLACEMENT_TEAM } from '../../shared/constants/roles';
import {
  hasPermission,
  PermissionHolder,
} from '../../shared/middleware/require-permission.middleware';
import { AuditService } from '../audit/audit.service';
import { LoadActivityService } from '../loads/activity/load-activity.service';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadMemoService } from '../loads/memo/load-memo.service';
import { SettingsReader } from '../settings/settings.types';
import { LsSourcingEntity } from './entities/ls-sourcing.entity';
import { LsServiceBase } from './ls-base';
import { LoadsmartRepository } from './loadsmart.repository';
import type {
  BrokerMatcher,
  BrokerWhatsappActivity,
  BrokerWhatsappReply,
} from './loadsmart.interface';
import {
  nextOnDuty,
  PLACEMENT_BUCKETS,
  PlacementBucket,
  placementBucket,
  RankedBroker,
  placementBrokerList,
} from './placement-rules';

const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
/** Midnight in India — the round robin resets then. */
const istMidnight = (now: Date) =>
  new Date(now.getTime() - ((now.getTime() + IST_OFFSET_MS) % DAY_MS));

const PLACEMENT_ROLES = [PLACEMENT_TEAM, ADMIN_TEAM];

export interface PartnerClaimsInput {
  lanes: { fromCity: string; toCity: string }[];
  truckTypes: { bodyType: string; capacityTons?: number }[];
}

export interface PartnerProfileInput {
  advancePercent?: number | null;
  noteForPlacement?: string | null;
  truckerSalesName?: string | null;
  truckerSalesPhone?: string | null;
}

export interface RosterInput {
  members: { userId: string; onDuty: boolean; turnOrder: number }[];
}

export interface MarkLostInput {
  reasonCode: string;
  note?: string;
  shipperRate?: number;
  brokerRate?: number;
}

export interface PlacementInboxItem {
  sourcingId: string;
  loadId: string;
  loadCode: string;
  tenantId: string;
  bucket: PlacementBucket;
  ownerId: string | null;
  postedAt: string;
  reportingAt: string | null;
  fromCity: string | null;
  toCity: string | null;
}

/**
 * Loadsmart's Placement team — from Created to Truck assigned: brokers matched to the load, the
 * round-robin owner, the inbox, the truck and driver (LsSourcingService.nameDriver), the memo
 * (sent once every check passes, withdrawn, or confirmed after a call) and Mark lost. Bids and
 * WhatsApp to brokers are not in this build.
 */
/** What the matched-brokers list adds from the broker master. */
export interface MatchedBrokerProfile {
  added: boolean;
  truckTypes: string[];
  region: string | null;
  contactName: string | null;
  /** The requirement sent to this broker on WhatsApp and their latest WhatsApp reply; null when
   *  it was never sent to them. */
  whatsapp: BrokerWhatsappActivity | null;
}

export class LsPlacementService extends LsServiceBase {
  constructor(
    repository: LoadsmartRepository,
    loadActivityService: LoadActivityService,
    auditService: AuditService,
    private readonly memoService: LoadMemoService,
    private readonly settings: SettingsReader,
    now?: () => Date,
  ) {
    super(repository, loadActivityService, auditService, now);
  }

  // --- Brokers -----------------------------------------------------------------------------

  /** Approval records the lanes and truck types a broker claims ("preferred lanes"); replaces
   *  the lists. */
  async setPartnerClaims(actorId: string, partnerId: string, input: PartnerClaimsInput) {
    try {
      const partner = await this.repository.partners.findOneBy({ id: partnerId });
      if (!partner) throw new NotFoundError(`Partner ${partnerId} not found`);
      await this.repository.transaction(async (manager) => {
        const lanes = manager.getRepository(this.repository.lanes.target);
        const trucks = manager.getRepository(this.repository.partnerTruckTypes.target);
        await lanes.delete({ partnerId });
        await trucks.delete({ partnerId });
        if (input.lanes.length) {
          await lanes.insert(
            input.lanes.map((lane) => ({
              partnerId,
              fromCity: lane.fromCity.trim(),
              toCity: lane.toCity.trim(),
            })),
          );
        }
        if (input.truckTypes.length) {
          await trucks.insert(
            input.truckTypes.map((truck) => ({
              partnerId,
              bodyType: truck.bodyType,
              capacityTons: truck.capacityTons === undefined ? null : String(truck.capacityTons),
            })),
          );
        }
      });
      await this.auditService.log({
        tenantId: null,
        userId: actorId,
        action: 'LS_PARTNER_SAVED',
        resourceType: 'ls_partner',
        newData: { id: partnerId, lanes: input.lanes, truckTypes: input.truckTypes },
      });
      return await this.repository.partners.findOne({
        where: { id: partnerId },
        relations: { lanes: true, truckTypes: true },
      });
    } catch (error) {
      rethrow(error, "Failed to save the partner's lanes and trucks");
    }
  }

  /** What Approval adds that onboarding doesn't: the advance on loading (85% or 80% needs Super
   *  Admin — loadsmart.money.approve), a note for Placement, the trucker salesperson. */
  async updatePartnerProfile(
    actor: PermissionHolder & { id: string },
    partnerId: string,
    input: PartnerProfileInput,
  ) {
    try {
      const partner = await this.repository.partners.findOneBy({ id: partnerId });
      if (!partner) throw new NotFoundError(`Partner ${partnerId} not found`);
      if (input.advancePercent !== undefined && !hasPermission(actor, LS_MONEY_APPROVE)) {
        throw new ConflictError("Changing a carrier's advance % needs Super Admin");
      }
      const data = {
        ...(input.advancePercent !== undefined
          ? { advancePercent: input.advancePercent === null ? null : String(input.advancePercent) }
          : {}),
        ...(input.noteForPlacement !== undefined
          ? { noteForPlacement: input.noteForPlacement }
          : {}),
        ...(input.truckerSalesName !== undefined
          ? { truckerSalesName: input.truckerSalesName }
          : {}),
        ...(input.truckerSalesPhone !== undefined
          ? { truckerSalesPhone: input.truckerSalesPhone }
          : {}),
      };
      if (Object.keys(data).length) await this.repository.partners.update({ id: partnerId }, data);
      await this.auditService.log({
        tenantId: null,
        userId: actor.id,
        action: 'LS_PARTNER_SAVED',
        resourceType: 'ls_partner',
        oldData: { id: partnerId, advancePercent: partner.advancePercent },
        newData: { id: partnerId, ...data },
      });
      return (await this.repository.partners.findOneBy({ id: partnerId }))!;
    } catch (error) {
      rethrow(error, "Failed to save the partner's details");
    }
  }

  private brokerMatcher?: BrokerMatcher;

  /** Which of Loadsmart's brokers run a load's lane (modules/lane-matching). */
  setBrokerMatcher(matcher: BrokerMatcher): void {
    this.brokerMatcher = matcher;
  }

  /** "Matched brokers come ticked, with why they matched, loads placed on this lane, rating."
   *  The brokers on the load's lane (lane-matching: runs the lane, or the load is on its way),
   *  best first, then any Placement added by hand. */
  async matchBrokers(
    sourcingId: string,
  ): Promise<{ lane: object; brokers: (RankedBroker & MatchedBrokerProfile)[] }> {
    try {
      const sourcing = await this.assertSourcing(sourcingId);
      const load = sourcing.load;
      const posting = load.postingId
        ? await this.repository.findPosting(load.tenantId, load.postingId)
        : null;
      const lane = {
        fromCity: posting?.pickupAddress?.city ?? null,
        fromState: posting?.pickupAddress?.state ?? null,
        toCity: posting?.dropAddress?.city ?? null,
        toState: posting?.dropAddress?.state ?? null,
      };
      const [matches, onLane, ratings, addedRows] = await Promise.all([
        this.brokerMatcher
          ? this.brokerMatcher.matchBrokers(routeOf(posting?.pickupAddress, posting?.dropAddress))
          : Promise.resolve([]),
        lane.fromCity && lane.toCity
          ? this.repository.loadsOnLane(lane.fromCity, lane.toCity)
          : Promise.resolve(new Map<string, number>()),
        this.repository.partnerRatings(),
        // Brokers Placement put on this load's list by hand ("Add broker").
        this.repository.sourcingBrokers.findBy({ sourcingId }),
      ]);
      const addedPartners = addedRows.length
        ? await this.repository.partners.findBy({ id: In(addedRows.map((row) => row.partnerId)) })
        : [];
      const brokers = placementBrokerList(
        matches,
        addedPartners.map((partner) => ({
          partnerId: partner.id,
          brokerId: partner.brokerId,
          name: partner.name,
          phone: partner.phone,
        })),
        onLane,
        ratings,
      );
      // What the list shows next to each broker — truck types, base region and the person to call
      // — comes from the broker master behind the partner.
      const brokerIds = brokers.map((broker) => broker.brokerId).filter(Boolean) as string[];
      const masters = brokerIds.length
        ? await this.repository.brokerMaster.findBy({ id: In(brokerIds) })
        : [];
      const whatsapp = await this.whatsappActivityByPartner(sourcingId);
      return {
        lane,
        brokers: brokers.map((broker) => {
          const master = masters.find((row) => row.id === broker.brokerId);
          return {
            ...broker,
            truckTypes: master?.truckSources ?? [],
            region: master?.base ?? null,
            contactName: master?.truckerName ?? null,
            whatsapp: whatsapp.get(broker.partnerId) ?? null,
          };
        }),
      };
    } catch (error) {
      rethrow(error, 'Failed to match brokers');
    }
  }

  /** Per broker: the load's WhatsApp requirement (sent / failed / not on WhatsApp, delivered and
   *  read times from WhatsApp's reports) and the newest response that came in on WhatsApp. */
  private async whatsappActivityByPartner(
    sourcingId: string,
  ): Promise<Map<string, BrokerWhatsappActivity>> {
    const [sourcing, sends, replies] = await Promise.all([
      this.assertSourcing(sourcingId),
      this.repository.requirementRecipients.findBy({ sourcingId }),
      this.repository.partnerBidResponses.find({
        where: { sourcingId, channel: 'whatsapp' },
        order: { createdAt: 'DESC' },
      }),
    ]);
    const lastReply = new Map<string, BrokerWhatsappReply>();
    for (const reply of replies) {
      if (lastReply.has(reply.partnerId)) continue;
      lastReply.set(reply.partnerId, {
        response: reply.response,
        // The trip total the broker gave.
        rate: this.tripRateOf(reply.rate, sourcing.load),
        at: reply.createdAt.toISOString(),
      });
    }
    return new Map(
      sends.map((send) => [
        send.partnerId,
        {
          status: send.status,
          sentAt: send.createdAt.toISOString(),
          deliveredAt: send.deliveredAt?.toISOString() ?? null,
          readAt: send.readAt?.toISOString() ?? null,
          failReason: send.failReason,
          failure: send.status === 'failed' ? whatsappFailureOf(send.failReason) : null,
          lastReply: lastReply.get(send.partnerId) ?? null,
        },
      ]),
    );
  }

  // --- Owner and roster ----------------------------------------------------------------------

  /** Posting hook, after the sourcing is opened: the load goes to the next Placement member on
   *  duty. A load already owned keeps its owner. */
  assignNew = async (loads: LoadEntity[]): Promise<void> => {
    for (const load of loads) {
      try {
        const sourcing = await this.repository.sourcings.findOneBy({ loadId: load.id });
        if (!sourcing || sourcing.placementOwnerId) continue;
        const now = this.now();
        const ownerId = nextOnDuty(
          await this.repository.roster.find(),
          await this.repository.lastPlacementAssignee(istMidnight(now)),
        );
        if (!ownerId) continue;
        await this.repository.updateSourcing(sourcing.id, {
          placementOwnerId: ownerId,
          placementAssignedAt: now,
        });
        await this.step(
          { ...sourcing },
          ownerId,
          'assigned_to_placement',
          'LS_PLACEMENT_ASSIGNED',
          {
            ownerId,
            by: 'round_robin',
          },
        );
      } catch (error) {
        console.warn(`[placement] could not assign load ${load.id}`, error);
      }
    }
  };

  getRoster() {
    return this.repository.roster.find({ order: { turnOrder: 'ASC' } });
  }

  /** Super Admin → Settings: who is on duty today and the turn order. Replaces the roster. */
  async saveRoster(actorId: string, input: RosterInput) {
    try {
      await this.assertPlacementUsers(input.members.map((member) => member.userId));
      await this.repository.transaction(async (manager) => {
        const roster = manager.getRepository(this.repository.roster.target);
        await roster.clear();
        if (input.members.length) {
          await roster.insert(input.members.map((member) => ({ ...member, updatedBy: actorId })));
        }
      });
      await this.auditService.log({
        tenantId: null,
        userId: actorId,
        action: 'LS_PLACEMENT_ROSTER_SAVED',
        resourceType: 'ls_sourcing',
        newData: { members: input.members },
      });
      return this.getRoster();
    } catch (error) {
      rethrow(error, 'Failed to save the Placement roster');
    }
  }

  /** A Placement member takes a load nobody owns ("self-claim"). An owned load stays with its owner
   *  until Super Admin moves it. */
  async claim(actorId: string, sourcingId: string) {
    try {
      const sourcing = await this.assertSourcing(sourcingId);
      const now = this.now();
      const result = await this.repository.sourcings.update(
        { id: sourcing.id, placementOwnerId: IsNull() },
        { placementOwnerId: actorId, placementAssignedAt: now },
      );
      if (!result.affected) {
        throw new ConflictError(
          sourcing.placementOwnerId === actorId
            ? 'This load is already yours'
            : 'Another Placement member already owns this load',
        );
      }
      await this.step(sourcing, actorId, 'placement_owner_claimed', 'LS_PLACEMENT_ASSIGNED', {
        from: null,
        to: actorId,
        by: 'self_claim',
      });
      return this.repository.findSourcing(sourcing.id);
    } catch (error) {
      rethrow(error, 'Failed to claim the load');
    }
  }

  /** "Super Admin can move a load by hand." */
  async moveOwner(actorId: string, sourcingId: string, ownerId: string) {
    try {
      const sourcing = await this.assertSourcing(sourcingId);
      await this.assertPlacementUsers([ownerId]);
      const updated = await this.repository.updateSourcing(sourcing.id, {
        placementOwnerId: ownerId,
        placementAssignedAt: this.now(),
      });
      await this.step(sourcing, actorId, 'placement_owner_moved', 'LS_PLACEMENT_ASSIGNED', {
        from: sourcing.placementOwnerId,
        to: ownerId,
        by: 'super_admin',
      });
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to move the load');
    }
  }

  private async assertPlacementUsers(userIds: string[]): Promise<void> {
    const roles = await this.repository.findStaffRoles(userIds);
    const wrong = userIds.filter((id) => !PLACEMENT_ROLES.includes(roles.get(id) ?? ''));
    if (wrong.length) {
      throw new ValidationError(`Not on the Placement team: ${wrong.join(', ')}`);
    }
  }

  // --- Inbox -------------------------------------------------------------------------------

  /** "Buckets in work order … plus Reporting today and Waiting on me counts. Each card shows time
   *  since posting." Sorted by reporting time, soonest first. */
  async inbox(actorId: string, filters: { mine?: boolean; tenantId?: string }) {
    try {
      const now = this.now();
      const sourcings = (await this.repository.listPlacementLoads()).filter(
        (sourcing) =>
          (!filters.mine || sourcing.placementOwnerId === actorId) &&
          (!filters.tenantId || sourcing.tenantId === filters.tenantId),
      );
      const open = await this.repository.loadsWithOpenMemo(
        sourcings.map((sourcing) => sourcing.loadId),
        now,
      );
      const items: PlacementInboxItem[] = [];
      for (const sourcing of sourcings) {
        const bucket = placementBucket(
          sourcing.status,
          sourcing.load.status,
          open.has(sourcing.loadId),
        );
        if (!bucket) continue;
        items.push(this.inboxItem(sourcing, bucket));
      }
      items.sort((a, b) => (a.reportingAt ?? '9999').localeCompare(b.reportingAt ?? '9999'));

      const todayEnd = new Date(istMidnight(now).getTime() + DAY_MS).toISOString();
      const counts = Object.fromEntries(
        PLACEMENT_BUCKETS.map((bucket) => [
          bucket,
          items.filter((i) => i.bucket === bucket).length,
        ]),
      ) as Record<PlacementBucket, number>;
      return {
        counts: {
          ...counts,
          reportingToday: items.filter((item) => item.reportingAt && item.reportingAt < todayEnd)
            .length,
          waitingOnMe: items.filter((item) => item.ownerId === actorId).length,
        },
        items,
      };
    } catch (error) {
      rethrow(error, "Failed to read Placement's inbox");
    }
  }

  private inboxItem(sourcing: LsSourcingEntity, bucket: PlacementBucket): PlacementInboxItem {
    const posting = sourcing.load.posting;
    return {
      sourcingId: sourcing.id,
      loadId: sourcing.loadId,
      loadCode: sourcing.load.code,
      tenantId: sourcing.tenantId,
      bucket,
      ownerId: sourcing.placementOwnerId,
      postedAt: sourcing.load.createdAt.toISOString(),
      reportingAt: posting?.pickupAt?.toISOString() ?? null,
      fromCity: posting?.pickupAddress?.city ?? null,
      toCity: posting?.dropAddress?.city ?? null,
    };
  }

  // --- Lost and memo -------------------------------------------------------------------------

  /** "Mark load lost with reason and both rates." Before Loadsmart wins it. */
  async markLost(actorId: string, sourcingId: string, input: MarkLostInput) {
    try {
      const sourcing = await this.assertSourcing(sourcingId);
      if (!['pending_approval', 'posted', 'bid_sent'].includes(sourcing.status)) {
        throw new ConflictError(`This load is already ${sourcing.status}`);
      }
      const { values } = await this.settings.forLoad(sourcing.load);
      const reason = values.reasonCodes.find(
        (code) => code.code === input.reasonCode && code.active,
      );
      if (!reason) throw new ValidationError(`"${input.reasonCode}" is not an active reason code`);
      const updated = await this.repository.updateSourcing(sourcing.id, {
        status: 'lost',
        lostReasonCode: reason.code,
        lostNote: input.note?.trim() || null,
        lostShipperRate: input.shipperRate === undefined ? null : String(input.shipperRate),
        lostBrokerRate: input.brokerRate === undefined ? null : String(input.brokerRate),
        lostBy: actorId,
        lostAt: this.now(),
      });
      await this.step(sourcing, actorId, 'marked_lost', 'LS_SOURCING_LOST', {
        reasonCode: reason.code,
        reason: reason.label,
        shipperRate: input.shipperRate ?? null,
        brokerRate: input.brokerRate ?? null,
      });
      return updated;
    } catch (error) {
      rethrow(error, 'Failed to mark the load lost');
    }
  }

  /** "Withdraw memo" — the open memo can no longer be accepted; a new version can go out. */
  async withdrawMemo(actorId: string, loadId: string, reason: string) {
    const sourcing = await this.assertWonLoad(loadId);
    return this.memoService.withdraw(sourcing.tenantId, actorId, loadId, reason, true);
  }
}
