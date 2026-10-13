import {
  And,
  ArrayContains,
  Brackets,
  DataSource,
  EntityManager,
  FindOperator,
  FindOptionsWhere,
  ILike,
  In,
  IsNull,
  LessThan,
  MoreThan,
  Not,
  Raw,
  Repository,
} from 'typeorm';
import { DriverTenantRelationEntity } from './entities/driver-tenant-relation.entity';
import { DriverOperationalStatusEntity } from './entities/driver-operational-status.entity';
import { DriverEntity } from './entities/driver.entity';
import {
  CreateDriverTenantRelationData,
  DriverRosterCounts,
  InviteSendColumns,
  ListDriversFilters,
  ListInvitationsInput,
  UpdateDriverTenantRelationData,
  UnavailableRelationIds,
} from './drivers.interface';
import {
  DRIVER_INVITE_TTL_DAYS,
  DRIVER_ROSTER_SEGMENTS,
  DriverLicenceValidityFilter,
  DriverRosterEmploymentFilter,
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

/**
 * ILIKE patterns for the "Search by name, mobile, or DL number" box, normalised to how each column
 * is stored: phones are digits only (normalizePhoneNumber / driver.validators.ts), so "+91 98720
 * 44102" must become "9872044102" — the "91" country code dropped so it matches numbers stored
 * with or without it; licence numbers have whitespace stripped. `phone` is null when the term
 * has no digits, since an empty pattern would match every row.
 */
function driverSearchPatterns(search: string): {
  name: string;
  phone: string | null;
  license: string;
} {
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

/** SQL per employment option, on the driver alias `d` — a vendor's driver is only ever `vendor`. */
const EMPLOYMENT_SQL: Record<DriverRosterEmploymentFilter, string> = {
  fixed: "(d.salary_type = 'fixed' AND d.engagement_type IS DISTINCT FROM 'vendor')",
  per_trip: "(d.salary_type = 'per_trip' AND d.engagement_type IS DISTINCT FROM 'vendor')",
  per_km: "(d.salary_type = 'per_km' AND d.engagement_type IS DISTINCT FROM 'vendor')",
  vendor: "d.engagement_type = 'vendor'",
};

/** Same thresholds as the roster's licence-validity label: past / 0-30 days left / beyond. */
const LICENCE_VALIDITY_SQL: Record<DriverLicenceValidityFilter, string> = {
  expired: 'd.license_expiry < CURRENT_DATE',
  expiring: "d.license_expiry BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'",
  valid: "d.license_expiry > CURRENT_DATE + INTERVAL '30 days'",
};

/**
 * The roster filter panel as one condition on the relation's driverId, or null when no filter is
 * set. Every filter reads the driver profile (or its sessions / latest Sarathi check), so they
 * combine into a single `driver_id IN (SELECT ...)` — which also keeps them on every OR'd search
 * branch and every tab count. SQL fragments come only from the fixed maps above, never from the
 * request; the class list (validated against DRIVER_LICENCE_CLASS_FILTERS) is a bound parameter.
 */
function rosterFilterCondition(filters: ListDriversFilters) {
  const { employmentType, licenceValidity, licenceClass, hazmatEndorsed, scoreStatus } = filters;
  const conditions: string[] = [];
  const params: Record<string, unknown> = {};

  if (employmentType?.length) {
    conditions.push(`(${employmentType.map((option) => EMPLOYMENT_SQL[option]).join(' OR ')})`);
  }
  if (licenceValidity?.length) {
    conditions.push(
      `(${licenceValidity.map((option) => LICENCE_VALIDITY_SQL[option]).join(' OR ')})`,
    );
  }
  if (licenceClass?.length) {
    // Latest check that recorded a class, as the roster's class column shows it. Classes are a
    // comma-separated list ("MCWG, LMV, HGMV"), so match whole codes, not substrings.
    conditions.push(
      `(SELECT v.license_class FROM masters.driver_verifications v
         WHERE v.driver_id = d.id AND v.license_class IS NOT NULL AND v.deleted_at IS NULL
         ORDER BY v.created_at DESC LIMIT 1) ~* :rosterLicenceClassPattern`,
    );
    params.rosterLicenceClassPattern = `(^|[^A-Z])(${licenceClass.join('|')})([^A-Z]|$)`;
  }
  if (hazmatEndorsed !== undefined) {
    conditions.push(`${hazmatEndorsed ? '' : 'NOT '}('hazmat' = ANY(d.license_endorsements))`);
  }
  if (scoreStatus?.length && !scoreStatus.includes('new')) {
    // No scoring model exists yet, so every driver reads `new` (DriverService's toScoreStatus) —
    // strong/watch alone match nobody. Turn this into a real score condition once scores exist.
    conditions.push('FALSE');
  }
  if (filters.appInstalled !== undefined) {
    // "Installed" = has ever logged into the driver app — same rule as the roster's phone icon.
    conditions.push(
      `${filters.appInstalled ? '' : 'NOT '}EXISTS (SELECT 1 FROM masters.driver_sessions s WHERE s.driver_id = d.id)`,
    );
  }

  if (!conditions.length) return null;
  return Raw(
    (alias) => `${alias} IN (SELECT d.id FROM masters.drivers d WHERE ${conditions.join(' AND ')})`,
    params,
  );
}

export class DriverTenantRelationRepository {
  private readonly relations: Repository<DriverTenantRelationEntity>;
  private readonly operationalStatuses: Repository<DriverOperationalStatusEntity>;

  constructor(dataSource: DataSource) {
    this.relations = dataSource.getRepository(DriverTenantRelationEntity);
    this.operationalStatuses = dataSource.getRepository(DriverOperationalStatusEntity);
  }

  async create(
    data: CreateDriverTenantRelationData,
    manager?: EntityManager,
  ): Promise<DriverTenantRelationEntity> {
    const relations = manager ? manager.getRepository(DriverTenantRelationEntity) : this.relations;
    const relation = relations.create({ ...data, rejectionReason: null, deletedAt: null });
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
    const relations = manager ? manager.getRepository(DriverTenantRelationEntity) : this.relations;
    return relations.findOneBy({ tenantId, driverId, deletedAt: IsNull() });
  }

  /**
   * This tenant's newest row for the driver. A driver can hold several (older declined or
   * cancelled ones plus the current one); findByTenantAndDriver above returns any of them.
   */
  findLatestByTenantAndDriver(
    tenantId: string,
    driverId: string,
    manager?: EntityManager,
  ): Promise<DriverTenantRelationEntity | null> {
    const relations = manager ? manager.getRepository(DriverTenantRelationEntity) : this.relations;
    return relations.findOne({
      where: { tenantId, driverId, deletedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Invites again on a row that's finished with — an expired, declined or cancelled invite — so
   * the tenant keeps one row per driver rather than adding another (see findLatestByTenantAndDriver).
   * Clears the previous answer; keeps the row's invite number.
   */
  async reinvite(
    tenantId: string,
    id: string,
    data: Omit<CreateDriverTenantRelationData, 'tenantId' | 'driverId' | 'createdBy'>,
    actorId: string,
    manager?: EntityManager,
  ): Promise<DriverTenantRelationEntity | null> {
    const relations = manager ? manager.getRepository(DriverTenantRelationEntity) : this.relations;
    const result = await relations.update(
      {
        id,
        tenantId,
        status: In(['pending_driver_review', 'rejected', 'cancelled']),
        deletedAt: IsNull(),
      },
      { ...data, rejectionReason: null, updatedBy: actorId },
    );
    return result.affected === 1 ? relations.findOneBy({ id, tenantId }) : null;
  }

  // Full staff-facing detail view: driver profile (with its person-level documents/verifications/
  // bank details) plus this tenant's operational status, trip metrics, and vehicle assignment.
  findByTenantAndDriverWithFullRelations(
    tenantId: string,
    driverId: string,
  ): Promise<DriverTenantRelationEntity | null> {
    return this.relations.findOne({
      where: { tenantId, driverId, deletedAt: IsNull() },
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
      relations: {
        driver: { documents: true, verifications: true, bankDetails: true },
        tripMetrics: true,
        vehicleLinks: { vehicle: { truckType: true, documents: true } },
      },
    });
  }

  /** `onLoadDriverIds` — drivers currently on an active load; only the on_trip/available
   *  segments read it. */
  async list(
    tenantId: string,
    filters: ListDriversFilters,
    onLoadDriverIds: readonly string[] = [],
  ): Promise<{ items: DriverTenantRelationEntity[]; total: number }> {
    const { segment, page, limit } = filters;
    const segmentWhere = segment
      ? rosterSegmentWhere(
          segment,
          onLoadDriverIds,
          await this.findUnavailableRelationIds(tenantId),
        )
      : {};
    if (!segmentWhere) return { items: [], total: 0 };

    const [items, total] = await this.relations.findAndCount({
      where: this.listWhere(tenantId, filters, segmentWhere),
      relations: {
        // verifications only feed DriverService's licenseClass — stripped from the list response.
        driver: { verifications: true },
        operationalStatus: true,
        tripMetrics: true,
        vehicleLinks: { vehicle: { truckType: true } },
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total };
  }

  /** Every roster tab's badge count, under the same status/initiatedBy/search filters as list(). */
  async countRosterSegments(
    tenantId: string,
    filters: ListDriversFilters,
    onLoadDriverIds: readonly string[],
  ): Promise<DriverRosterCounts> {
    const unavailable = await this.findUnavailableRelationIds(tenantId);
    const countFor = (segmentWhere: FindOptionsWhere<DriverTenantRelationEntity> | null) =>
      segmentWhere
        ? this.relations.count({ where: this.listWhere(tenantId, filters, segmentWhere) })
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
    filters: ListDriversFilters,
    segmentWhere: FindOptionsWhere<DriverTenantRelationEntity>,
  ): FindOptionsWhere<DriverTenantRelationEntity>[] {
    const { status, initiatedBy, operationalStatus, search } = filters;

    const base: FindOptionsWhere<DriverTenantRelationEntity> = { tenantId, deletedAt: IsNull() };
    if (status) base.status = status;
    if (initiatedBy) base.initiatedBy = initiatedBy;
    if (operationalStatus) base.operationalStatus = { operationalStatus, deletedAt: IsNull() };
    // Applied last so a segment's own conditions (notably status: 'active') win over the
    // caller's `status` filter.
    Object.assign(base, segmentWhere);
    // The filter panel narrows on driverId too; on_trip/available segments may already have.
    const rosterFilter = rosterFilterCondition(filters);
    if (rosterFilter) {
      base.driverId = base.driverId
        ? And(base.driverId as FindOperator<string>, rosterFilter)
        : rosterFilter;
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

  listActiveByDriver(driverId: string): Promise<DriverTenantRelationEntity[]> {
    return this.relations.find({
      where: { driverId, status: 'active', deletedAt: IsNull() },
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
    const now = new Date();
    const result = await this.relations.update(
      { id, tenantId, status: 'pending_staff_review', deletedAt: IsNull() },
      {
        status: nextStatus,
        approvedBy: actorId,
        approvedAt: now,
        rejectionReason: null,
        // Approving a dispatch-added driver is what sends them the invite.
        ...(nextStatus === 'pending_driver_review' && inviteSendColumns(actorId, now)),
        updatedBy: actorId,
      },
    );
    return result.affected === 1 ? this.findById(tenantId, id) : null;
  }

  async reject(
    tenantId: string,
    id: string,
    actorId: string,
    reason: string | null,
  ): Promise<DriverTenantRelationEntity | null> {
    const result = await this.relations.update(
      { id, tenantId, status: 'pending_staff_review', deletedAt: IsNull() },
      { status: 'rejected', rejectionReason: reason, updatedBy: actorId },
    );
    return result.affected === 1 ? this.findById(tenantId, id) : null;
  }

  /**
   * "Invitations Sent" tab — tenant-initiated relations whose invite actually went out
   * (invite_sent_at set), with the display status derived per DRIVER_INVITATION_STATUSES.
   */
  async listInvitations(
    tenantId: string,
    filters: ListInvitationsInput,
  ): Promise<{ items: DriverTenantRelationEntity[]; total: number }> {
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

  /** Records the real FCM result for the latest send's push channel. */
  async setPushDeliveryStatus(id: string, status: 'sent' | 'failed'): Promise<void> {
    await this.relations.update(
      { id },
      { pushDeliveryStatus: status, pushDeliveryStatusAt: new Date() },
    );
  }

  /**
   * Driver opened the invite notification on their device. Only the first open of the CURRENT
   * send counts: a notification created before the latest (re)send is ignored, as is an invite
   * the driver already answered or the tenant cancelled. The device label comes from the driver's
   * session row (driver_sessions.device_type · device_info).
   */
  async markInviteViewed(
    id: string,
    driverId: string,
    notificationCreatedAt: Date,
    sessionId: string | undefined,
  ): Promise<void> {
    const now = new Date();
    await this.relations
      .createQueryBuilder()
      .update(DriverTenantRelationEntity)
      .set({
        inviteViewedAt: now,
        inviteViewedDevice: sessionId
          ? () =>
              `(SELECT NULLIF(concat_ws(' · ', s.device_type, s.device_info), '') ` +
              `FROM masters.driver_sessions s WHERE s.id = :sessionId)`
          : null,
      })
      .where('id = :id', { id })
      .andWhere('driver_id = :driverId', { driverId })
      .andWhere("status = 'pending_driver_review'")
      .andWhere('deleted_at IS NULL')
      .andWhere('invite_viewed_at IS NULL')
      .andWhere('invite_sent_at <= :notificationCreatedAt', { notificationCreatedAt })
      .setParameter('sessionId', sessionId ?? null)
      .execute();
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
    const result = await this.relations.update(
      { id, tenantId, status: 'pending_driver_review', deletedAt: IsNull() },
      { status: 'cancelled', updatedBy: actorId },
    );
    return result.affected === 1;
  }

  /** Resend — restarts the invite's clock. Only a still-pending, unexpired invite qualifies. */
  async resendInvite(
    tenantId: string,
    id: string,
    actorId: string,
  ): Promise<DriverTenantRelationEntity | null> {
    const now = new Date();
    const result = await this.relations.update(
      {
        id,
        tenantId,
        status: 'pending_driver_review',
        inviteExpiresAt: MoreThan(now),
        deletedAt: IsNull(),
      },
      { ...inviteSendColumns(actorId, now), updatedBy: actorId },
    );
    if (result.affected !== 1) return null;
    return this.relations.findOne({ where: { id, tenantId }, relations: { driver: true } });
  }

  /**
   * Driver accepts a `pending_driver_review` relation (a fleet-owner-initiated invite). An expired
   * invite can't be accepted — every pending invite carries an expiry (stamped on send, and
   * backfilled by the AddDriverInviteTimestamps migration).
   */
  async accept(id: string, driverId: string): Promise<DriverTenantRelationEntity | null> {
    const result = await this.relations.update(
      {
        id,
        driverId,
        status: 'pending_driver_review',
        inviteExpiresAt: MoreThan(new Date()),
        deletedAt: IsNull(),
      },
      { status: 'active', driverRespondedAt: new Date() },
    );
    if (result.affected !== 1) return null;
    return this.relations.findOneBy({ id, deletedAt: IsNull() });
  }

  async declineInvite(
    id: string,
    driverId: string,
    reason: string | null,
  ): Promise<DriverTenantRelationEntity | null> {
    const result = await this.relations.update(
      { id, driverId, status: 'pending_driver_review', deletedAt: IsNull() },
      { status: 'rejected', rejectionReason: reason, driverRespondedAt: new Date() },
    );
    if (result.affected !== 1) return null;
    return this.relations.findOneBy({ id, deletedAt: IsNull() });
  }
}
