import {
  And,
  ArrayContains,
  Brackets,
  DataSource,
  EntityManager,
  FindOperator,
  FindOptionsRelations,
  FindOptionsWhere,
  ILike,
  In,
  IsNull,
  LessThan,
  MoreThan,
  LessThanOrEqual,
  MoreThanOrEqual,
  Between,
  Not,
  Or,
  Repository,
} from 'typeorm';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import {
  DriverInviteEvent,
  DriverInviteSendEvent,
  DriverTenantRelationEntity,
} from './entities/driver-tenant-relation.entity';
import { DriverOperationalStatusEntity } from './entities/driver-operational-status.entity';
import { DriverEntity } from './entities/driver.entity';
import { DriverSessionEntity } from './entities/driver-session.entity';
import { DriverVerificationEntity } from './entities/driver-verification.entity';
import { toDateString } from '../../shared/utils/date';
import {
  CreateDriverTenantRelationData,
  DriverRelationPage,
  DriverRosterCounts,
  DriverSearchPatterns,
  InviteSendColumns,
  ListDriversFilters,
  ListInvitationsInput,
  ListJoinRequestsInput,
  RosterQueryFilters,
  UpdateDriverTenantRelationData,
  UnavailableRelationIds,
} from './drivers.interface';
import {
  DRIVER_INVITE_TTL_DAYS,
  DRIVER_ROSTER_SEGMENTS,
  DriverLicenceClassFilter,
  DriverLicenceValidityFilter,
  DriverRosterEmploymentFilter,
  DRIVER_INVITE_SEND_STEPS,
  DriverInviteSendStep,
  DriverInviteWhatsAppReportStatus,
  DriverRosterSegment,
} from './drivers.types';

/** When an invite sent at `sentAt` stops being acceptable. */
export function inviteExpiryFrom(sentAt: Date): Date {
  return new Date(sentAt.getTime() + DRIVER_INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Everything a fresh send (first invite or Resend) stamps on the relation: the clock restarts,
 * the previous send's "viewed" is cleared, and every channel goes back to `pending`. SMS and
 * WhatsApp stay `pending` — recorded, not sent — until the notification-branch sending is wired in
 * here; push is overwritten with the real FCM result via setPushDeliveryStatus right after.
 */
export function inviteSendColumns(actorId: string | null, now: Date): InviteSendColumns {
  return {
    inviteSentAt: now,
    inviteExpiresAt: inviteExpiryFrom(now),
    inviteSentBy: actorId,
    inviteViewedAt: null,
    inviteViewedDevice: null,
    smsDeliveryStatus: 'pending',
    smsDeliveryStatusAt: now,
    whatsappDeliveryStatus: 'pending',
    whatsappDeliveryStatusAt: now,
    pushDeliveryStatus: 'pending',
    pushDeliveryStatusAt: now,
  };
}

/** What a roster row needs loaded — verifications only feed DriverService's licenseClass and are
 *  stripped from the list response. */
const ROSTER_ROW_RELATIONS: FindOptionsRelations<DriverTenantRelationEntity> = {
  driver: { verifications: true },
  operationalStatus: true,
  tripMetrics: true,
  vehicleLinks: { vehicle: { truckType: true } },
};

/** Whether a timeline entry is a send of the invite (`sent` or `resent`). */
export function isInviteSendEvent(event: DriverInviteEvent): event is DriverInviteSendEvent {
  return (DRIVER_INVITE_SEND_STEPS as readonly string[]).includes(event.step);
}

/** The relation's timeline with `events` added at the end — the log is append-only. */
function withTimelineEvents(
  relation: DriverTenantRelationEntity,
  ...events: DriverInviteEvent[]
): DriverInviteEvent[] {
  return [...relation.inviteTimeline, ...events];
}

/** A send's timeline entry: `sent` the first time this row's invite goes out, `resent` after. */
function inviteSendEvent(
  relation: DriverTenantRelationEntity,
  sentAt: Date,
  sentBy: string | null,
): DriverInviteSendEvent {
  const step: DriverInviteSendStep = relation.inviteTimeline.some((event) => event.step === 'sent')
    ? 'resent'
    : 'sent';
  return { step, at: sentAt.toISOString(), by: sentBy };
}

/** `expired` (at the old expiry) when a pending invite that ran out is sent again — until then
 *  the drawer only derives it. */
function lapsedExpiryEvents(relation: DriverTenantRelationEntity, now: Date): DriverInviteEvent[] {
  const lapsed =
    relation.status === 'pending_driver_review' &&
    relation.inviteExpiresAt !== null &&
    relation.inviteExpiresAt <= now;
  return lapsed ? [{ step: 'expired', at: relation.inviteExpiresAt!.toISOString() }] : [];
}

/**
 * ILIKE patterns for the "Search by name, mobile, or DL number" box, normalised to how each column
 * is stored: phones are digits only (normalizePhoneNumber / driver.validators.ts), so "+91 98720
 * 44102" must become "9872044102" — the "91" country code dropped so it matches numbers stored
 * with or without it; licence numbers have whitespace stripped. `phone` is null when the term
 * has no digits, since an empty pattern would match every row.
 */
function driverSearchPatterns(search: string): DriverSearchPatterns {
  let digits = search.replace(/\D+/g, '');
  if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
  return {
    name: `%${search}%`,
    phone: digits ? `%${digits}%` : null,
    license: `%${search.replace(/\s+/g, '')}%`,
  };
}

/**
 * A roster segment as extra where-conditions on the relation, or null when it can't match any
 * row (an empty In() list). Every segment is a slice of the Active Roster, so each one also pins
 * the relation to `active` — on_trip comes from the loads table alone, which knows nothing about
 * the link's status, so without this a pending/rejected link with an open load leaked into the
 * tab (and every count).
 */
function rosterSegmentWhere(
  segment: DriverRosterSegment,
  onLoadDriverIds: readonly string[],
  unavailable: UnavailableRelationIds,
): FindOptionsWhere<DriverTenantRelationEntity> | null {
  const where = segmentConditions(segment, onLoadDriverIds, unavailable);
  return where && { ...where, status: 'active' };
}

/** Status-based segments match on relation ids rather than a nested `operationalStatus`
 *  condition, because a driver with no status row at all must still count as available/on the
 *  roster, and a nested condition drops them. */

function segmentConditions(
  segment: DriverRosterSegment,
  onLoadDriverIds: readonly string[],
  { notAvailable, left }: UnavailableRelationIds,
): FindOptionsWhere<DriverTenantRelationEntity> | null {
  const notLeft = left.length ? { id: Not(In(left)) } : {};
  const today = new Date().toISOString().slice(0, 10);
  switch (segment) {
    case 'all':
      return notLeft;
    case 'on_trip':
      return onLoadDriverIds.length ? { ...notLeft, driverId: In([...onLoadDriverIds]) } : null;
    case 'available': {
      const unavailable = [...notAvailable, ...left];
      return {
        ...(unavailable.length ? { id: Not(In(unavailable)) } : {}),
        ...(onLoadDriverIds.length ? { driverId: Not(In([...onLoadDriverIds])) } : {}),
      };
    }
    case 'not_available':
      return notAvailable.length ? { id: In(notAvailable) } : null;
    case 'left_company':
      return left.length ? { id: In(left) } : null;
    case 'licence_expired':
      return { ...notLeft, driver: { licenseExpiry: LessThan(today) } };
    case 'not_verified':
      return { ...notLeft, driver: { licenseVerified: false } };
    case 'hazmat_endorsed':
      return { ...notLeft, driver: { licenseEndorsements: ArrayContains(['hazmat']) } };
  }
}

/**
 * `licenceValidity` options as one condition on drivers.license_expiry. The three options are
 * adjacent ranges (expired < today <= expiring <= today + 30 < valid), so every combination is a
 * single range — or, for expired + valid, the gap between them. A driver with no expiry on file
 * matches none of them, as the roster shows no validity for one.
 */
function licenceExpiryCondition(options: DriverLicenceValidityFilter[]): FindOperator<string> {
  const today = toDateString(new Date());
  const in30Days = toDateString(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
  const expired = options.includes('expired');
  const expiring = options.includes('expiring');
  const valid = options.includes('valid');

  if (expired && expiring && valid) return Not(IsNull());
  if (expired && expiring) return LessThanOrEqual(in30Days);
  if (expiring && valid) return MoreThanOrEqual(today);
  if (expired && valid) return Not(Between(today, in30Days));
  if (expired) return LessThan(today);
  if (expiring) return Between(today, in30Days);
  return MoreThan(in30Days);
}

/**
 * `employmentType` options as OR'd driver conditions — `fixed`/`per_trip`/`per_km` are how a
 * company driver is paid (salaryType), `vendor` is a vendor's driver (engagementType), and a
 * vendor's driver only ever matches `vendor`: the same split the roster's Pay column shows.
 */
function employmentConditions(
  options: DriverRosterEmploymentFilter[],
): FindOptionsWhere<DriverEntity>[] {
  const paidAs = options.filter((option) => option !== 'vendor');
  const branches: FindOptionsWhere<DriverEntity>[] = [];
  if (paidAs.length) {
    branches.push({ salaryType: In(paidAs), engagementType: Or(IsNull(), Not('vendor')) });
  }
  if (options.includes('vendor')) branches.push({ engagementType: 'vendor' });
  return branches;
}

/** A licence-class list ("MCWG, LMV, HGMV") holds one of `classes` as a whole code. */
function hasLicenceClass(licenseClass: string, classes: DriverLicenceClassFilter[]): boolean {
  const codes = licenseClass.toUpperCase().split(/[^A-Z0-9]+/);
  return classes.some((code) => codes.includes(code));
}

function hasRosterFilters(filters: RosterQueryFilters): boolean {
  return Boolean(
    filters.employmentType?.length ||
    filters.licenceValidity?.length ||
    filters.licenceClass?.length ||
    filters.scoreStatus?.length ||
    filters.hazmatEndorsed !== undefined ||
    filters.appInstalled !== undefined,
  );
}

export class DriverTenantRelationRepository {
  private readonly relations: Repository<DriverTenantRelationEntity>;
  private readonly operationalStatuses: Repository<DriverOperationalStatusEntity>;
  private readonly sessions: Repository<DriverSessionEntity>;
  private readonly verifications: Repository<DriverVerificationEntity>;

  constructor(dataSource: DataSource) {
    this.relations = dataSource.getRepository(DriverTenantRelationEntity);
    this.operationalStatuses = dataSource.getRepository(DriverOperationalStatusEntity);
    this.sessions = dataSource.getRepository(DriverSessionEntity);
    this.verifications = dataSource.getRepository(DriverVerificationEntity);
  }

  /**
   * The roster filter panel, resolved to the ids of this tenant's relations that match it — or
   * null when no filter is set. Ticked options within one key are OR'd and the keys AND'd. Profile
   * fields filter in one query; app installed and licence class then narrow those candidates by
   * their own tables. Returned as ids so list() and every tab count apply it identically.
   */
  private async findRosterFilterRelationIds(
    tenantId: string,
    filters: RosterQueryFilters,
  ): Promise<string[] | null> {
    if (!hasRosterFilters(filters)) return null;
    const { employmentType, licenceValidity, licenceClass, hazmatEndorsed, scoreStatus } = filters;

    // No scoring model exists yet, so every driver reads `new` (DriverService's toScoreStatus) —
    // strong/watch alone match nobody. Replace with a real score condition once scores exist.
    if (scoreStatus?.length && !scoreStatus.includes('new')) return [];

    const driver: FindOptionsWhere<DriverEntity> = {};
    if (licenceValidity?.length) driver.licenseExpiry = licenceExpiryCondition(licenceValidity);
    if (hazmatEndorsed !== undefined) {
      const hazmat = ArrayContains(['hazmat']);
      driver.licenseEndorsements = hazmatEndorsed ? hazmat : Not(hazmat);
    }
    const driverBranches = employmentType?.length
      ? employmentConditions(employmentType).map((branch) => ({ ...driver, ...branch }))
      : [driver];

    let candidates = await this.relations.find({
      select: { id: true, driverId: true },
      where: driverBranches.map((branch) => ({ tenantId, deletedAt: IsNull(), driver: branch })),
    });

    if (filters.appInstalled !== undefined && candidates.length) {
      // "Installed" = has ever logged into the driver app — same rule as the roster's phone icon.
      const sessions = await this.sessions.find({
        select: { driverId: true },
        where: { driverId: In(candidates.map((relation) => relation.driverId)) },
      });
      const withApp = new Set(sessions.map((session) => session.driverId));
      candidates = candidates.filter(
        (relation) => withApp.has(relation.driverId) === filters.appInstalled,
      );
    }

    if (licenceClass?.length && candidates.length) {
      // Latest check that recorded a class — what the roster's class column shows.
      const checks = await this.verifications.find({
        select: { driverId: true, licenseClass: true, createdAt: true },
        where: {
          driverId: In(candidates.map((relation) => relation.driverId)),
          licenseClass: Not(IsNull()),
          deletedAt: IsNull(),
        },
        order: { createdAt: 'DESC' },
      });
      const latestClass = new Map<string, string>();
      for (const check of checks) {
        if (!latestClass.has(check.driverId)) latestClass.set(check.driverId, check.licenseClass!);
      }
      candidates = candidates.filter((relation) => {
        const latest = latestClass.get(relation.driverId);
        return latest !== undefined && hasLicenceClass(latest, licenceClass);
      });
    }

    return candidates.map((relation) => relation.id);
  }

  /**
   * Every invite-timeline write goes through here: locks the matching row (SELECT … FOR UPDATE)
   * inside a transaction, lets `change` build the new column values from its current state, and
   * writes them. Concurrent writers (a Resend while the driver opens a notification) queue on the
   * lock, so each one adds its entry instead of overwriting the other's. Returns the updated row,
   * or null when no row matched or `change` returned null (nothing to write). Pass `manager` when
   * already inside a transaction.
   */
  private async updateLocked(
    where:
      FindOptionsWhere<DriverTenantRelationEntity> | FindOptionsWhere<DriverTenantRelationEntity>[],
    change: (
      relation: DriverTenantRelationEntity,
    ) => QueryDeepPartialEntity<DriverTenantRelationEntity> | null,
    manager?: EntityManager,
  ): Promise<DriverTenantRelationEntity | null> {
    const run = async (transaction: EntityManager) => {
      const relations = transaction.getRepository(DriverTenantRelationEntity);
      const relation = await relations.findOne({ where, lock: { mode: 'pessimistic_write' } });
      if (!relation) return null;
      const data = change(relation);
      if (!data) return null;
      await relations.update({ id: relation.id }, data);
      return relations.findOneBy({ id: relation.id });
    };
    return manager ? run(manager) : this.relations.manager.transaction(run);
  }

  async create(
    data: CreateDriverTenantRelationData,
    manager?: EntityManager,
  ): Promise<DriverTenantRelationEntity> {
    const relations = manager ? manager.getRepository(DriverTenantRelationEntity) : this.relations;
    const relation = relations.create({
      ...data,
      // An invite that goes out on creation (org_admin's) starts the log with its send.
      inviteTimeline: data.inviteSentAt
        ? [{ step: 'sent', at: data.inviteSentAt.toISOString(), by: data.inviteSentBy ?? null }]
        : [],
      rejectionReason: null,
      deletedAt: null,
    });
    return relations.save(relation);
  }

  findById(
    tenantId: string,
    id: string,
    manager?: EntityManager,
  ): Promise<DriverTenantRelationEntity | null> {
    const relations = manager ? manager.getRepository(DriverTenantRelationEntity) : this.relations;
    return relations.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }

  /** The driver's own relations with these ids, any tenant — the invites behind their
   *  notification cards (see DriverPortalService.getMyNotifications). */
  findByIdsForDriver(driverId: string, ids: string[]): Promise<DriverTenantRelationEntity[]> {
    if (!ids.length) return Promise.resolve([]);
    return this.relations.find({ where: { id: In(ids), driverId, deletedAt: IsNull() } });
  }

  // Used only where the caller doesn't yet know the tenant — e.g. an already-authenticated driver
  // switching context to a relation by id (driver-auth.service.ts's selectRelation).
  findByIdForDriver(driverId: string, id: string): Promise<DriverTenantRelationEntity | null> {
    return this.relations.findOneBy({ id, driverId, deletedAt: IsNull() });
  }

  findByTenantAndDriver(
    tenantId: string,
    driverId: string,
    manager?: EntityManager,
  ): Promise<DriverTenantRelationEntity | null> {
    // Newest first: a driver can hold several rows here (a declined invite, then their own join
    // request), and the live one is always the newest — callers checking the driver's standing
    // (session refresh, assertDriverExists) must see it, not an older declined one.
    const relations = manager ? manager.getRepository(DriverTenantRelationEntity) : this.relations;
    return relations.findOne({
      where: { tenantId, driverId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * This tenant's newest row for the driver. A driver can hold several (older declined or
   * cancelled ones plus the current one) — same lookup as findByTenantAndDriver, named for the
   * callers that choose between them.
   */
  findLatestByTenantAndDriver(
    tenantId: string,
    driverId: string,
    manager?: EntityManager,
  ): Promise<DriverTenantRelationEntity | null> {
    return this.findByTenantAndDriver(tenantId, driverId, manager);
  }

  /**
   * Invites again on a row that's finished with — an expired, declined or cancelled invite — so
   * the tenant keeps one row per driver rather than adding another (see findLatestByTenantAndDriver).
   * Clears the previous answer; keeps the row's invite number and adds to its timeline (`resent`
   * when this send goes straight out, after `expired` if the old invite had run out).
   * `assertStillSendable` re-runs the caller's checks on the locked row, so a concurrent send
   * can't slip past them.
   */
  async reinvite(
    tenantId: string,
    id: string,
    data: Omit<CreateDriverTenantRelationData, 'tenantId' | 'driverId' | 'createdBy'>,
    actorId: string,
    assertStillSendable: (relation: DriverTenantRelationEntity) => void,
    manager?: EntityManager,
  ): Promise<DriverTenantRelationEntity | null> {
    return this.updateLocked(
      {
        id,
        tenantId,
        status: In(['pending_driver_review', 'rejected', 'cancelled']),
        deletedAt: IsNull(),
      },
      (relation) => {
        assertStillSendable(relation);
        const now = new Date();
        // Dispatch's re-invite isn't sent until approved — approve() logs that send.
        const sendEvents = data.inviteSentAt
          ? [inviteSendEvent(relation, data.inviteSentAt, data.inviteSentBy ?? actorId)]
          : [];
        return {
          ...data,
          inviteTimeline: withTimelineEvents(
            relation,
            ...lapsedExpiryEvents(relation, now),
            ...sendEvents,
          ),
          rejectionReason: null,
          updatedBy: actorId,
        };
      },
      manager,
    );
  }

  // Full staff-facing detail view: driver profile (with its person-level documents/verifications/
  // bank details) plus this tenant's operational status, trip metrics, and vehicle assignment.
  findByTenantAndDriverWithFullRelations(
    tenantId: string,
    driverId: string,
  ): Promise<DriverTenantRelationEntity | null> {
    return this.relations.findOne({
      where: { tenantId, driverId, deletedAt: IsNull() },
      // Newest first, like findByTenantAndDriver — the live row, not an older declined one.
      order: { createdAt: 'DESC' },
      relations: {
        driver: { documents: true, verifications: true, bankDetails: true },
        operationalStatus: true,
        tripMetrics: true,
        vehicleLinks: { vehicle: { truckType: true } },
      },
    });
  }

  // Driver-portal profile screen — same as above plus the assigned vehicle's own compliance
  // documents (insurance/fitness expiry) and truck type.
  findByTenantAndDriverWithProfileRelations(
    tenantId: string,
    driverId: string,
  ): Promise<DriverTenantRelationEntity | null> {
    return this.relations.findOne({
      where: { tenantId, driverId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
      relations: {
        driver: { documents: true, verifications: true, bankDetails: true },
        tripMetrics: true,
        vehicleLinks: { vehicle: { truckType: true, documents: true } },
      },
    });
  }

  /**
   * The roster query's where-clauses under `filters` (segment, filter panel, search, status), or
   * null when they can't match anything. `onLoadDriverIds` — drivers currently on an active load;
   * only the on_trip/available segments read it. Shared by list() and listForExport().
   */
  private async findRosterWhere(
    tenantId: string,
    filters: RosterQueryFilters,
    onLoadDriverIds: readonly string[],
  ): Promise<FindOptionsWhere<DriverTenantRelationEntity>[] | null> {
    const { segment } = filters;
    const segmentWhere = segment
      ? rosterSegmentWhere(
          segment,
          onLoadDriverIds,
          await this.findUnavailableRelationIds(tenantId),
        )
      : {};
    if (!segmentWhere) return null;
    const filterIds = await this.findRosterFilterRelationIds(tenantId, filters);
    if (filterIds?.length === 0) return null;
    return this.listWhere(tenantId, filters, segmentWhere, filterIds);
  }

  async list(
    tenantId: string,
    filters: ListDriversFilters,
    onLoadDriverIds: readonly string[] = [],
  ): Promise<DriverRelationPage> {
    const { page, limit } = filters;
    const where = await this.findRosterWhere(tenantId, filters, onLoadDriverIds);
    if (!where) return { items: [], total: 0 };

    const [items, total] = await this.relations.findAndCount({
      where,
      relations: ROSTER_ROW_RELATIONS,
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total };
  }

  /** Same filters as `list` but unpaged (capped at `limit`) — the roster export. */
  async listForExport(
    tenantId: string,
    filters: RosterQueryFilters,
    onLoadDriverIds: readonly string[],
    limit: number,
  ): Promise<DriverTenantRelationEntity[]> {
    const where = await this.findRosterWhere(tenantId, filters, onLoadDriverIds);
    if (!where) return [];
    return this.relations.find({
      where,
      relations: ROSTER_ROW_RELATIONS,
      order: { createdAt: 'DESC' },
      take: limit,
    });
  }

  /** Every roster tab's badge count, under the same status/initiatedBy/search filters as list(). */
  async countRosterSegments(
    tenantId: string,
    filters: ListDriversFilters,
    onLoadDriverIds: readonly string[],
  ): Promise<DriverRosterCounts> {
    const [unavailable, filterIds] = await Promise.all([
      this.findUnavailableRelationIds(tenantId),
      this.findRosterFilterRelationIds(tenantId, filters),
    ]);
    const countFor = (segmentWhere: FindOptionsWhere<DriverTenantRelationEntity> | null) =>
      segmentWhere && filterIds?.length !== 0
        ? this.relations.count({
            where: this.listWhere(tenantId, filters, segmentWhere, filterIds),
          })
        : Promise.resolve(0);

    const [total, ...segmentCounts] = await Promise.all([
      // "of 45" — the whole Active Roster, left-the-company included.
      countFor({ status: 'active' }),
      ...DRIVER_ROSTER_SEGMENTS.map((segment) =>
        countFor(rosterSegmentWhere(segment, onLoadDriverIds, unavailable)),
      ),
    ]);

    return {
      total,
      ...(Object.fromEntries(
        DRIVER_ROSTER_SEGMENTS.map((segment, index) => [segment, segmentCounts[index]]),
      ) as Record<DriverRosterSegment, number>),
    };
  }

  private async findUnavailableRelationIds(tenantId: string): Promise<UnavailableRelationIds> {
    const rows = await this.operationalStatuses.find({
      where: {
        tenantId,
        operationalStatus: In(['on_leave', 'medically_unfit', 'inactive']),
        deletedAt: IsNull(),
      },
      select: { driverTenantRelationId: true, operationalStatus: true },
    });
    return {
      notAvailable: rows
        .filter((row) => row.operationalStatus !== 'inactive')
        .map((row) => row.driverTenantRelationId),
      left: rows
        .filter((row) => row.operationalStatus === 'inactive')
        .map((row) => row.driverTenantRelationId),
    };
  }

  private listWhere(
    tenantId: string,
    filters: RosterQueryFilters,
    segmentWhere: FindOptionsWhere<DriverTenantRelationEntity>,
    filterIds: string[] | null,
  ): FindOptionsWhere<DriverTenantRelationEntity>[] {
    const { status = 'active', initiatedBy, operationalStatus, search } = filters;

    const base: FindOptionsWhere<DriverTenantRelationEntity> = { tenantId, deletedAt: IsNull() };
    // Default is the roster (`active`); pending/declined/cancelled links only come back when asked.
    if (status !== 'all') base.status = status;
    if (initiatedBy) base.initiatedBy = initiatedBy;
    if (operationalStatus) base.operationalStatus = { operationalStatus, deletedAt: IsNull() };
    // Applied last so a segment's own conditions (notably status: 'active') win over the
    // caller's `status` filter.
    Object.assign(base, segmentWhere);
    // The filter panel's matches, as relation ids; a status segment may already narrow `id`.
    if (filterIds) {
      base.id = base.id ? And(base.id as FindOperator<string>, In(filterIds)) : In(filterIds);
    }
    if (!search) return [base];

    // Search spans three columns on the driver profile (name / mobile / DL number), so it becomes
    // up to three OR'd where-clauses — see driverSearchPatterns for the normalisation. Each keeps
    // the segment's own driver conditions (e.g. licence expired) alongside the search column.
    const segmentDriver = segmentWhere.driver as FindOptionsWhere<DriverEntity> | undefined;
    const patterns = driverSearchPatterns(search);
    const where: FindOptionsWhere<DriverTenantRelationEntity>[] = [
      { ...base, driver: { ...segmentDriver, fullName: ILike(patterns.name) } },
      { ...base, driver: { ...segmentDriver, licenseNumber: ILike(patterns.license) } },
    ];
    if (patterns.phone) {
      where.push({ ...base, driver: { ...segmentDriver, phoneNumber: ILike(patterns.phone) } });
    }
    return where;
  }

  async softDelete(
    tenantId: string,
    driverId: string,
    deletedBy: string | null,
    manager?: EntityManager,
  ): Promise<void> {
    const relations = manager ? manager.getRepository(DriverTenantRelationEntity) : this.relations;
    await relations.update(
      { tenantId, driverId, deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: deletedBy },
    );
  }

  /**
   * Account deletion's counterpart to softDelete for a still-pending invite: the row stays so the
   * inviting tenant sees it as `expired` in Invitations Sent instead of it silently vanishing,
   * and its expiry is pulled forward to now so the existing expired-invite guards (resend, accept)
   * apply too.
   */
  async expirePendingInvite(id: string, manager: EntityManager): Promise<void> {
    await manager
      .getRepository(DriverTenantRelationEntity)
      .update(
        { id, status: 'pending_driver_review', deletedAt: IsNull() },
        { inviteExpiresAt: new Date(), updatedBy: null },
      );
  }

  /** Every relation a driver (identified globally) holds, across all tenants. */
  listByDriver(
    driverId: string,
    status?: DriverTenantRelationEntity['status'],
  ): Promise<DriverTenantRelationEntity[]> {
    return this.relations.find({
      where: { driverId, deletedAt: IsNull(), ...(status && { status }) },
      order: { createdAt: 'DESC' },
    });
  }

  /** The active driver of this tenant with this phone (digits only, with or without the 91
   *  country code) — the vehicle bulk upload's "Driver Phone" column. */
  async findActiveDriverByPhone(tenantId: string, phone: string): Promise<DriverEntity | null> {
    let digits = phone.replace(/\D+/g, '');
    if (digits.length > 10 && digits.startsWith('91')) digits = digits.slice(2);
    if (!digits) return null;
    const relation = await this.relations.findOne({
      where: [
        { tenantId, status: 'active', deletedAt: IsNull(), driver: { phoneNumber: digits } },
        { tenantId, status: 'active', deletedAt: IsNull(), driver: { phoneNumber: `91${digits}` } },
      ],
      relations: { driver: true },
    });
    return relation?.driver ?? null;
  }

  listActiveByDriver(driverId: string): Promise<DriverTenantRelationEntity[]> {
    return this.relations.find({
      where: { driverId, status: 'active', deletedAt: IsNull() },
      order: { createdAt: 'ASC' },
    });
  }

  async update(
    tenantId: string,
    id: string,
    data: UpdateDriverTenantRelationData,
    manager?: EntityManager,
  ): Promise<DriverTenantRelationEntity | null> {
    const relations = manager ? manager.getRepository(DriverTenantRelationEntity) : this.relations;
    await relations.update({ id, tenantId, deletedAt: IsNull() }, data);
    return relations.findOneBy({ id, tenantId, deletedAt: IsNull() });
  }

  /**
   * Only a `pending_staff_review` relation (dispatch-added driver or a driver join-request) can be
   * approved. `nextStatus` is `pending_driver_review` when the request still needs the driver's
   * accept, `active` when the driver already asked to join.
   */
  async approve(
    tenantId: string,
    id: string,
    actorId: string,
    nextStatus: 'pending_driver_review' | 'active',
  ): Promise<DriverTenantRelationEntity | null> {
    return this.updateLocked(
      { id, tenantId, status: 'pending_staff_review', deletedAt: IsNull() },
      (relation) => {
        const now = new Date();
        return {
          status: nextStatus,
          approvedBy: actorId,
          approvedAt: now,
          rejectionReason: null,
          // Approving a dispatch-added driver is what sends them the invite.
          ...(nextStatus === 'pending_driver_review' && {
            ...inviteSendColumns(actorId, now),
            inviteTimeline: withTimelineEvents(relation, inviteSendEvent(relation, now, actorId)),
          }),
          updatedBy: actorId,
        };
      },
    );
  }

  async reject(
    tenantId: string,
    id: string,
    actorId: string,
    reason: string | null,
  ): Promise<DriverTenantRelationEntity | null> {
    const result = await this.relations.update(
      { id, tenantId, status: 'pending_staff_review', deletedAt: IsNull() },
      {
        status: 'rejected',
        rejectionReason: reason,
        rejectedAt: new Date(),
        rejectedBy: actorId,
        updatedBy: actorId,
      },
    );
    return result.affected === 1 ? this.findById(tenantId, id) : null;
  }

  /**
   * Restore — puts a rejected driver join request back to `pending_staff_review`, so it's in
   * Requests to You again, and clears the rejection. Only a still-rejected driver-initiated row
   * qualifies; the caller checks the restore window and the driver's state first.
   */
  async restoreJoinRequest(
    tenantId: string,
    id: string,
    actorId: string,
  ): Promise<DriverTenantRelationEntity | null> {
    const result = await this.relations.update(
      { id, tenantId, status: 'rejected', initiatedBy: 'driver', deletedAt: IsNull() },
      {
        status: 'pending_staff_review',
        rejectionReason: null,
        rejectedAt: null,
        rejectedBy: null,
        updatedBy: actorId,
      },
    );
    return result.affected === 1 ? this.findRosterRowById(tenantId, id) : null;
  }

  /**
   * Recently Rejected — this tenant's driver join requests rejected since `rejectedSince`, newest
   * rejection first, leaving out drivers who have since joined any fleet or left Loadsmart.
   * `search` matches name, mobile or DL number, as on the pending list.
   */
  async listRejectedJoinRequests(
    tenantId: string,
    filters: ListJoinRequestsInput,
    rejectedSince: Date,
  ): Promise<DriverRelationPage> {
    const { search, page, limit } = filters;
    const base: FindOptionsWhere<DriverTenantRelationEntity> = {
      tenantId,
      status: 'rejected',
      initiatedBy: 'driver',
      rejectedAt: MoreThanOrEqual(rejectedSince),
      deletedAt: IsNull(),
    };
    const candidates = await this.relations.find({ select: { driverId: true }, where: base });
    const joinedDriverIds = await this.findDriverIdsInAnyFleet(
      candidates.map((relation) => relation.driverId),
    );
    if (joinedDriverIds.size) base.driverId = Not(In([...joinedDriverIds]));

    // A driver who deleted their account is soft-deleted too — they've left Loadsmart.
    const onPlatform: FindOptionsWhere<DriverEntity> = { deletedAt: IsNull() };
    const patterns = search ? driverSearchPatterns(search) : null;
    const where: FindOptionsWhere<DriverTenantRelationEntity>[] = patterns
      ? [
          { ...base, driver: { ...onPlatform, fullName: ILike(patterns.name) } },
          { ...base, driver: { ...onPlatform, licenseNumber: ILike(patterns.license) } },
          ...(patterns.phone
            ? [{ ...base, driver: { ...onPlatform, phoneNumber: ILike(patterns.phone) } }]
            : []),
        ]
      : [{ ...base, driver: onPlatform }];

    const [items, total] = await this.relations.findAndCount({
      where,
      relations: ROSTER_ROW_RELATIONS,
      order: { rejectedAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });
    return { items, total };
  }

  /** Which of these drivers are active in any fleet (any tenant) — they're no longer free to join. */
  async findDriverIdsInAnyFleet(driverIds: string[]): Promise<Set<string>> {
    if (!driverIds.length) return new Set();
    const relations = await this.relations.find({
      select: { driverId: true },
      where: { driverId: In(driverIds), status: 'active', deletedAt: IsNull() },
    });
    return new Set(relations.map((relation) => relation.driverId));
  }

  /** One relation with what a roster/join-request row needs loaded (see ROSTER_ROW_RELATIONS). */
  findRosterRowById(tenantId: string, id: string): Promise<DriverTenantRelationEntity | null> {
    return this.relations.findOne({
      where: { id, tenantId, deletedAt: IsNull() },
      relations: ROSTER_ROW_RELATIONS,
    });
  }

  /**
   * "Invitations Sent" tab — tenant-initiated relations whose invite actually went out
   * (invite_sent_at set), with the display status derived per DRIVER_INVITATION_STATUSES.
   */
  async listInvitations(
    tenantId: string,
    filters: ListInvitationsInput,
  ): Promise<DriverRelationPage> {
    const { status, phoneNumber, page, limit } = filters;

    const query = this.relations
      .createQueryBuilder('relation')
      .innerJoinAndSelect('relation.driver', 'driver')
      .where('relation.tenantId = :tenantId', { tenantId })
      .andWhere('relation.deletedAt IS NULL')
      .andWhere('relation.initiatedBy IN (:...initiators)', {
        initiators: ['fleet_owner', 'staff'],
      })
      .andWhere('relation.inviteSentAt IS NOT NULL')
      .andWhere(
        new Brackets((statusClause) => {
          const pendingDriver = "relation.status = 'pending_driver_review'";
          // Mirrors toInvitationView: a driver who left the platform (driver.service.ts's
          // isDriverOffPlatform) makes a still-pending invite read `expired`, whatever its date.
          const onPlatform = 'driver.deletedAt IS NULL';
          if (!status || status === 'pending') {
            statusClause.orWhere(
              `${pendingDriver} AND ${onPlatform} AND relation.inviteExpiresAt > now()`,
            );
          }
          if (!status || status === 'expired') {
            statusClause.orWhere(
              `${pendingDriver} AND (NOT ${onPlatform} OR relation.inviteExpiresAt <= now())`,
            );
          }
          if (!status || status === 'accepted') {
            statusClause.orWhere("relation.status = 'active'");
          }
          if (!status || status === 'cancelled') {
            statusClause.orWhere("relation.status = 'cancelled'");
          }
          // A staff-rejected dispatch driver never reached the driver — only driver declines count.
          if (!status || status === 'rejected') {
            statusClause.orWhere(
              "relation.status = 'rejected' AND relation.driverRespondedAt IS NOT NULL",
            );
          }
        }),
      );

    // Mobile only — names aren't unique. Same digits normalisation as the roster's search.
    const phonePattern = phoneNumber ? driverSearchPatterns(phoneNumber).phone : null;
    if (phonePattern) {
      query.andWhere('driver.phoneNumber ILIKE :phoneSearch', { phoneSearch: phonePattern });
    }

    const [items, total] = await query
      .orderBy('relation.inviteSentAt', 'DESC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { items, total };
  }

  /**
   * One invitation (tenant-initiated relation whose invite went out) by its own id, scoped to the
   * tenant — with the driver's verifications for the drawer's credentials block.
   */
  findInvitation(tenantId: string, id: string): Promise<DriverTenantRelationEntity | null> {
    return this.relations.findOne({
      where: {
        id,
        tenantId,
        initiatedBy: In(['fleet_owner', 'staff']),
        inviteSentAt: Not(IsNull()),
        deletedAt: IsNull(),
      },
      relations: { driver: { verifications: true } },
    });
  }

  /** Records the real FCM result for the latest send's push channel; a failure is also logged. */
  async setPushDeliveryStatus(id: string, status: 'sent' | 'failed'): Promise<void> {
    await this.updateLocked({ id }, (relation) => {
      const now = new Date();
      return {
        pushDeliveryStatus: status,
        pushDeliveryStatusAt: now,
        ...(status === 'failed' && {
          inviteTimeline: withTimelineEvents(relation, {
            step: 'delivery_failed',
            at: now.toISOString(),
            channel: 'push',
          }),
        }),
      };
    });
  }

  /**
   * WhatsApp's delivery report for the latest send. `read` is the driver reading the invite
   * message: logged as `whatsapp_read` once per send (the first read after it), and it sets
   * invite_viewed_at while the invite is still waiting — a Resend clears that again
   * (inviteSendColumns). `failed` is also logged. Reports older than the latest send are ignored.
   */
  async setWhatsAppDeliveryStatus(
    id: string,
    status: DriverInviteWhatsAppReportStatus,
    at: Date,
  ): Promise<void> {
    await this.updateLocked({ id, deletedAt: IsNull() }, (relation) => {
      if (!relation.inviteSentAt || at < relation.inviteSentAt) return null;
      const latestSend = relation.inviteTimeline.filter(isInviteSendEvent).at(-1);
      const readSinceLatestSend = relation.inviteTimeline.some(
        (event) =>
          event.step === 'whatsapp_read' &&
          (!latestSend || Date.parse(event.at) >= Date.parse(latestSend.at)),
      );
      const columns = { whatsappDeliveryStatus: status, whatsappDeliveryStatusAt: at };
      if (status === 'failed') {
        return {
          ...columns,
          inviteTimeline: withTimelineEvents(relation, {
            step: 'delivery_failed',
            at: at.toISOString(),
            channel: 'whatsapp',
          }),
        };
      }
      if (status !== 'read' || readSinceLatestSend) return columns;
      return {
        ...columns,
        ...(relation.status === 'pending_driver_review' &&
          relation.inviteViewedAt === null && { inviteViewedAt: at }),
        inviteTimeline: withTimelineEvents(relation, {
          step: 'whatsapp_read',
          at: at.toISOString(),
        }),
      };
    });
  }

  /** Driver-side lookup of one of their own pending invites, by relation id. */
  findPendingInviteForDriver(
    id: string,
    driverId: string,
  ): Promise<DriverTenantRelationEntity | null> {
    return this.relations.findOneBy({
      id,
      driverId,
      status: 'pending_driver_review',
      deletedAt: IsNull(),
    });
  }

  /**
   * Cancel — flips just this tenant's pending invite to `cancelled`. The row is kept, so it stays
   * in Invitations Sent and keeps occupying the tenant+driver slot, which is what stops the driver
   * from requesting to join this tenant again.
   */
  async cancelInvite(tenantId: string, id: string, actorId: string): Promise<boolean> {
    const cancelled = await this.updateLocked(
      { id, tenantId, status: 'pending_driver_review', deletedAt: IsNull() },
      (relation) => ({
        status: 'cancelled',
        inviteTimeline: withTimelineEvents(relation, {
          step: 'cancelled',
          at: new Date().toISOString(),
          by: actorId,
        }),
        updatedBy: actorId,
      }),
    );
    return cancelled !== null;
  }

  /**
   * Resend — same row, same invitation id: restarts the invite's clock and logs the send (after
   * `expired` when the old invite had run out). Qualifies: a pending invite, expired or not, or one
   * the driver declined (`rejected` with a driver response — a staff rejection never reached the
   * driver), which goes back to pending with the decline cleared so the driver can accept it.
   * `assertStillSendable` re-runs the caller's checks on the locked row (see reinvite).
   */
  async resendInvite(
    tenantId: string,
    id: string,
    actorId: string,
    assertStillSendable: (relation: DriverTenantRelationEntity) => void,
  ): Promise<DriverTenantRelationEntity | null> {
    return this.updateLocked(
      [
        { id, tenantId, status: 'pending_driver_review', deletedAt: IsNull() },
        { id, tenantId, status: 'rejected', driverRespondedAt: Not(IsNull()), deletedAt: IsNull() },
      ],
      (relation) => {
        assertStillSendable(relation);
        const now = new Date();
        return {
          ...inviteSendColumns(actorId, now),
          inviteTimeline: withTimelineEvents(
            relation,
            ...lapsedExpiryEvents(relation, now),
            inviteSendEvent(relation, now, actorId),
          ),
          status: 'pending_driver_review',
          driverRespondedAt: null,
          rejectionReason: null,
          updatedBy: actorId,
        };
      },
    );
  }

  /**
   * Driver accepts a `pending_driver_review` relation (a fleet-owner-initiated invite). An expired
   * invite can't be accepted — every pending invite carries an expiry (stamped on send, and
   * backfilled by the AddDriverInviteTimestamps migration).
   */
  async accept(id: string, driverId: string): Promise<DriverTenantRelationEntity | null> {
    const now = new Date();
    return this.updateLocked(
      {
        id,
        driverId,
        status: 'pending_driver_review',
        inviteExpiresAt: MoreThan(now),
        deletedAt: IsNull(),
      },
      (relation) => ({
        status: 'active',
        driverRespondedAt: now,
        inviteTimeline: withTimelineEvents(relation, { step: 'accepted', at: now.toISOString() }),
      }),
    );
  }

  async declineInvite(
    id: string,
    driverId: string,
    reason: string | null,
  ): Promise<DriverTenantRelationEntity | null> {
    const now = new Date();
    return this.updateLocked(
      { id, driverId, status: 'pending_driver_review', deletedAt: IsNull() },
      (relation) => ({
        status: 'rejected',
        rejectionReason: reason,
        driverRespondedAt: now,
        inviteTimeline: withTimelineEvents(relation, {
          step: 'declined',
          at: now.toISOString(),
          reason,
        }),
      }),
    );
  }
}
