import {
  Brackets,
  DataSource,
  EntityManager,
  FindOptionsWhere,
  ILike,
  In,
  IsNull,
  MoreThan,
  Not,
  Repository,
} from 'typeorm';
import { DriverTenantRelationEntity } from './entities/driver-tenant-relation.entity';
import {
  CreateDriverTenantRelationData,
  InviteSendColumns,
  ListDriversFilters,
  ListInvitationsInput,
  UpdateDriverTenantRelationData,
} from './drivers.interface';
import { DRIVER_INVITE_TTL_DAYS } from './drivers.types';

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

export class DriverTenantRelationRepository {
  private readonly relations: Repository<DriverTenantRelationEntity>;

  constructor(dataSource: DataSource) {
    this.relations = dataSource.getRepository(DriverTenantRelationEntity);
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
        vehicleLinks: { vehicle: true },
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

  async list(
    tenantId: string,
    filters: ListDriversFilters,
  ): Promise<{ items: DriverTenantRelationEntity[]; total: number }> {
    const { status, initiatedBy, operationalStatus, search, page, limit } = filters;

    const base: FindOptionsWhere<DriverTenantRelationEntity> = { tenantId, deletedAt: IsNull() };
    if (status) base.status = status;
    if (initiatedBy) base.initiatedBy = initiatedBy;
    if (operationalStatus) base.operationalStatus = { operationalStatus, deletedAt: IsNull() };

    // Search spans three columns on the driver profile (name / mobile / DL number), so it becomes
    // up to three OR'd where-clauses — see driverSearchPatterns for the normalisation.
    let where: FindOptionsWhere<DriverTenantRelationEntity>[] = [base];
    if (search) {
      const patterns = driverSearchPatterns(search);
      where = [
        { ...base, driver: { fullName: ILike(patterns.name) } },
        { ...base, driver: { licenseNumber: ILike(patterns.license) } },
      ];
      if (patterns.phone) where.push({ ...base, driver: { phoneNumber: ILike(patterns.phone) } });
    }

    const [items, total] = await this.relations.findAndCount({
      where,
      relations: {
        // verifications only feed DriverService's licenseClass — stripped from the list response.
        driver: { verifications: true },
        operationalStatus: true,
        tripMetrics: true,
        vehicleLinks: { vehicle: true },
      },
      order: { createdAt: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { items, total };
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
    const { status, search, page, limit } = filters;

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
          if (!status || status === 'pending') {
            statusClause.orWhere(`${pendingDriver} AND relation.inviteExpiresAt > now()`);
          }
          if (!status || status === 'expired') {
            statusClause.orWhere(`${pendingDriver} AND relation.inviteExpiresAt <= now()`);
          }
          if (!status || status === 'accepted') {
            statusClause.orWhere("relation.status = 'active'");
          }
          // A staff-rejected dispatch driver never reached the driver — only driver declines count.
          if (!status || status === 'rejected') {
            statusClause.orWhere(
              "relation.status = 'rejected' AND relation.driverRespondedAt IS NOT NULL",
            );
          }
        }),
      );

    if (search) {
      // Same name / mobile / DL matching as list() above.
      const patterns = driverSearchPatterns(search);
      query.andWhere(
        new Brackets((searchClause) => {
          searchClause
            .where('driver.fullName ILIKE :nameSearch', { nameSearch: patterns.name })
            .orWhere('driver.licenseNumber ILIKE :licenseSearch', {
              licenseSearch: patterns.license,
            });
          if (patterns.phone) {
            searchClause.orWhere('driver.phoneNumber ILIKE :phoneSearch', {
              phoneSearch: patterns.phone,
            });
          }
        }),
      );
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

  /** Cancel — soft-deletes just this pending invite, leaving the driver's older rejected rows. */
  async cancelInvite(tenantId: string, id: string, actorId: string): Promise<boolean> {
    const result = await this.relations.update(
      { id, tenantId, status: 'pending_driver_review', deletedAt: IsNull() },
      { deletedAt: new Date(), updatedBy: actorId },
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
