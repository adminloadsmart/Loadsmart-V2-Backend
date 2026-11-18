import { DataSource, EntityManager, In, IsNull, MoreThan, Not, Repository } from 'typeorm';
import { UserEntity } from '../auth/entities/user.entity';
import { LoadMemoEntity } from '../loads/memo/load-memo.entity';
import { TruckTypeEntity } from '../masters/truck-type/entities/truck-type.entity';
import { OrganizationDocumentEntity } from '../organization/entities/organization-document.entity';
import { LsPartnerLaneEntity } from './entities/ls-partner-lane.entity';
import { LsPartnerTruckTypeEntity } from './entities/ls-partner-truck-type.entity';
import { LsPlacementRosterEntity } from './entities/ls-placement-roster.entity';
import { LsCreditNoteEntity } from './entities/ls-credit-note.entity';
import { LsReceiptEntity } from './entities/ls-receipt.entity';
import { LsUnclaimedPaymentEntity } from './entities/ls-unclaimed-payment.entity';
import { LsOriginalPodEntity } from './entities/ls-original-pod.entity';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import { LoadPostingEntity } from '../loads/load-posting/entities/load-posting.entity';
import { LoadStatus } from '../loads/utils/loads.types';
import { LoadChargeEntity } from '../loads/money/load-charge.entity';
import { LoadClaimEntity } from './entities/load-claim.entity';
import { LoadRatingEntity } from './entities/load-rating.entity';
import { LsCommercialTermsEntity } from './entities/ls-commercial-terms.entity';
import { LsInvoiceEntity } from './entities/ls-invoice.entity';
import { LsPartnerBidEntity } from './entities/ls-partner-bid.entity';
import { LsPartnerPaymentEntity } from './entities/ls-partner-payment.entity';
import { LoadDocumentEntity } from '../loads/documents/load-document.entity';
import { LsPartnerBidResponseEntity } from './entities/ls-partner-bid-response.entity';
import { LsSourcingBrokerEntity } from './entities/ls-sourcing-broker.entity';
import { LsCallLogEntity } from './entities/ls-call-log.entity';
import { LsStaffNotificationEntity } from './entities/ls-staff-notification.entity';
import { UserPermissionEntity } from '../roles/entities/user-permission.entity';
import { PLATFORM_ADMIN_ROLE } from '../../shared/constants/roles';
import { LsPartnerEntity } from './entities/ls-partner.entity';
import { LsSourcingEntity } from './entities/ls-sourcing.entity';
import { PartnerPaymentType, SourcingStatus } from './loadsmart.types';

/** Every table of the Loadsmart ops module. Sourcings are looked up across tenants — the ops
 *  console is platform-wide — and carry the shipper's tenant for everything downstream. */
export class LoadsmartRepository {
  readonly partners: Repository<LsPartnerEntity>;
  readonly terms: Repository<LsCommercialTermsEntity>;
  readonly sourcings: Repository<LsSourcingEntity>;
  readonly partnerBids: Repository<LsPartnerBidEntity>;
  readonly charges: Repository<LoadChargeEntity>;
  readonly partnerPayments: Repository<LsPartnerPaymentEntity>;
  readonly claims: Repository<LoadClaimEntity>;
  readonly ratings: Repository<LoadRatingEntity>;
  readonly invoices: Repository<LsInvoiceEntity>;
  readonly lanes: Repository<LsPartnerLaneEntity>;
  readonly partnerTruckTypes: Repository<LsPartnerTruckTypeEntity>;
  readonly roster: Repository<LsPlacementRosterEntity>;
  readonly creditNotes: Repository<LsCreditNoteEntity>;
  readonly receipts: Repository<LsReceiptEntity>;
  readonly unclaimed: Repository<LsUnclaimedPaymentEntity>;
  readonly originalPods: Repository<LsOriginalPodEntity>;
  readonly staffNotifications: Repository<LsStaffNotificationEntity>;
  readonly callLogs: Repository<LsCallLogEntity>;
  readonly partnerBidResponses: Repository<LsPartnerBidResponseEntity>;
  readonly sourcingBrokers: Repository<LsSourcingBrokerEntity>;
  readonly loadDocuments: Repository<LoadDocumentEntity>;
  private readonly postings: Repository<LoadPostingEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.partners = dataSource.getRepository(LsPartnerEntity);
    this.terms = dataSource.getRepository(LsCommercialTermsEntity);
    this.sourcings = dataSource.getRepository(LsSourcingEntity);
    this.partnerBids = dataSource.getRepository(LsPartnerBidEntity);
    this.charges = dataSource.getRepository(LoadChargeEntity);
    this.partnerPayments = dataSource.getRepository(LsPartnerPaymentEntity);
    this.claims = dataSource.getRepository(LoadClaimEntity);
    this.ratings = dataSource.getRepository(LoadRatingEntity);
    this.invoices = dataSource.getRepository(LsInvoiceEntity);
    this.postings = dataSource.getRepository(LoadPostingEntity);
    this.lanes = dataSource.getRepository(LsPartnerLaneEntity);
    this.partnerTruckTypes = dataSource.getRepository(LsPartnerTruckTypeEntity);
    this.roster = dataSource.getRepository(LsPlacementRosterEntity);
    this.creditNotes = dataSource.getRepository(LsCreditNoteEntity);
    this.receipts = dataSource.getRepository(LsReceiptEntity);
    this.unclaimed = dataSource.getRepository(LsUnclaimedPaymentEntity);
    this.originalPods = dataSource.getRepository(LsOriginalPodEntity);
    this.staffNotifications = dataSource.getRepository(LsStaffNotificationEntity);
    this.callLogs = dataSource.getRepository(LsCallLogEntity);
    this.partnerBidResponses = dataSource.getRepository(LsPartnerBidResponseEntity);
    this.sourcingBrokers = dataSource.getRepository(LsSourcingBrokerEntity);
    this.loadDocuments = dataSource.getRepository(LoadDocumentEntity);
  }

  /** Active platform staff (no tenant) who hold any of `permissionKeys` — through their team's
   *  bundle or a direct grant — plus the owner account, whose bypass passes every key. Backs
   *  notifications addressed to "whoever can do X" for the ops console. */
  async listStaffWithPermission(permissionKeys: string[]): Promise<UserEntity[]> {
    const users = this.dataSource.getRepository(UserEntity);
    const staff = { tenantId: IsNull(), deletedAt: IsNull() };
    const grants = await this.dataSource
      .getRepository(UserPermissionEntity)
      .find({ where: { permission: { key: In(permissionKeys) } }, select: { userId: true } });
    return users.find({
      where: [
        { ...staff, role: { name: PLATFORM_ADMIN_ROLE } },
        { ...staff, role: { permissions: { key: In(permissionKeys) } } },
        ...(grants.length ? [{ ...staff, id: In(grants.map((grant) => grant.userId)) }] : []),
      ],
      relations: { role: true },
    });
  }

  /** Documents of Loadsmart loads across shippers, newest first — the console's documents page.
   *  `q` matches the load code or the LR / e-LR / invoice number; `series` an e-LR prefix. */
  async searchDocuments(filter: {
    q?: string;
    series?: string;
    docType?: string;
    from?: Date;
    to?: Date;
    includeHistory?: boolean;
    page: number;
    limit: number;
  }) {
    const query = this.loadDocuments
      .createQueryBuilder('d')
      .innerJoinAndSelect('d.load', 'l')
      .innerJoin(LsSourcingEntity, 's', 's.loadId = d.loadId')
      .orderBy('d.createdAt', 'DESC')
      .skip((filter.page - 1) * filter.limit)
      .take(filter.limit);
    if (!filter.includeHistory) query.andWhere('d.supersededAt IS NULL');
    if (filter.docType) query.andWhere('d.docType = :docType', { docType: filter.docType });
    if (filter.q) {
      query.andWhere(
        '(l.code ILIKE :q OR l.elrNumber ILIKE :q OR l.invoiceNumber ILIKE :q OR l.ewayBillNumber ILIKE :q)',
        { q: `%${filter.q.replace(/[%_]/g, '')}%` },
      );
    }
    if (filter.series) {
      query.andWhere('l.elrNumber ILIKE :series', {
        series: `${filter.series.replace(/[%_]/g, '')}%`,
      });
    }
    if (filter.from) query.andWhere('d.createdAt >= :from', { from: filter.from });
    if (filter.to) query.andWhere('d.createdAt < :to', { to: filter.to });
    return query.getManyAndCount();
  }

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  // --- Placement ---------------------------------------------------------------------------

  /** Loads each partner won on this lane (by the posting's pickup and drop city). */
  async loadsOnLane(fromCity: string, toCity: string): Promise<Map<string, number>> {
    const rows = await this.sourcings
      .createQueryBuilder('s')
      .innerJoin('s.load', 'l')
      .innerJoin('l.posting', 'p')
      .select('s.partnerId', 'partnerId')
      .addSelect('COUNT(*)::int', 'count')
      .where("s.status = 'won'")
      .andWhere('s.partnerId IS NOT NULL')
      .andWhere("lower(p.pickupAddress ->> 'city') = lower(:fromCity)", { fromCity })
      .andWhere("lower(p.dropAddress ->> 'city') = lower(:toCity)", { toCity })
      .groupBy('s.partnerId')
      .getRawMany<{ partnerId: string; count: number }>();
    return new Map(rows.map((row) => [row.partnerId, row.count]));
  }

  async partnerRatings(): Promise<Map<string, number>> {
    const rows = await this.ratings
      .createQueryBuilder('r')
      .select('r.partnerId', 'partnerId')
      .addSelect('ROUND(AVG(r.score)::numeric, 1)::float', 'rating')
      .where("r.subject = 'partner'")
      .andWhere('r.partnerId IS NOT NULL')
      .groupBy('r.partnerId')
      .getRawMany<{ partnerId: string; rating: number }>();
    return new Map(rows.map((row) => [row.partnerId, row.rating]));
  }

  /** The load's truck type — body type and capacity — from the shipper's truck type master. */
  async loadTruckType(
    tenantId: string,
    truckTypeId: string,
  ): Promise<{ bodyType: string | null; capacityTons: string | null } | null> {
    const truckType = await this.dataSource.getRepository(TruckTypeEntity).findOne({
      where: { id: truckTypeId, tenantId },
      select: { id: true, bodyType: true, capacityTons: true },
    });
    return truckType
      ? { bodyType: truckType.bodyType, capacityTons: truckType.capacityTons }
      : null;
  }

  /** Who got the most recent new load since `since` (the round robin's last turn today). */
  async lastPlacementAssignee(since: Date): Promise<string | null> {
    const row = await this.sourcings
      .createQueryBuilder('s')
      .select('s.placement_owner_id', 'ownerId')
      .where('s.placement_assigned_at >= :since', { since })
      .andWhere('s.placement_owner_id IS NOT NULL')
      .orderBy('s.placement_assigned_at', 'DESC')
      .limit(1)
      .getRawOne<{ ownerId: string }>();
    return row?.ownerId ?? null;
  }

  /** Staff users with their role name — to check a Placement roster member. */
  async findStaffRoles(userIds: string[]): Promise<Map<string, string>> {
    if (!userIds.length) return new Map();
    const users = await this.dataSource.getRepository(UserEntity).find({
      where: { id: In(userIds) },
      relations: { role: true },
      select: { id: true, role: { id: true, name: true } },
    });
    return new Map(users.filter((user) => user.role).map((user) => [user.id, user.role.name]));
  }

  /** Does this staff user's role carry the permission key? */
  async userHasPermission(userId: string, key: string): Promise<boolean> {
    return this.dataSource
      .getRepository(UserEntity)
      .createQueryBuilder('u')
      .innerJoin('u.role', 'r')
      .innerJoin('r.permissions', 'p')
      .where('u.id = :userId', { userId })
      .andWhere('p.key = :key', { key })
      .getExists();
  }

  /** Loadsmart loads still with Placement: not yet past Bids received, not lost or cancelled. */
  listPlacementLoads(): Promise<LsSourcingEntity[]> {
    return this.sourcings.find({
      where: {
        status: In(['pending_approval', 'posted', 'bid_sent', 'won']),
        load: { status: In(['created', 'bids_received']) },
      },
      relations: { load: { posting: true }, partner: true },
    });
  }

  /** Loads among `loadIds` with a memo still open (sent and not expired). */
  async loadsWithOpenMemo(loadIds: string[], now: Date): Promise<Set<string>> {
    if (!loadIds.length) return new Set();
    const memos = await this.dataSource.getRepository(LoadMemoEntity).find({
      where: { loadId: In(loadIds), status: 'sent', expiresAt: MoreThan(now) },
      select: { id: true, loadId: true },
    });
    return new Set(memos.map((memo) => memo.loadId));
  }

  findPosting(tenantId: string, postingId: string): Promise<LoadPostingEntity | null> {
    return this.postings.findOneBy({ tenantId, id: postingId });
  }

  findSourcing(id: string): Promise<LsSourcingEntity | null> {
    return this.sourcings.findOne({ where: { id }, relations: { load: true, partner: true } });
  }

  findSourcingByLoad(loadId: string): Promise<LsSourcingEntity | null> {
    return this.sourcings.findOne({ where: { loadId }, relations: { load: true, partner: true } });
  }

  /** A console queue: sourcings in these states, optionally only those whose load is at one of
   *  these stages, oldest first. */
  listSourcings(
    statuses: SourcingStatus[],
    loadStatuses?: LoadStatus[],
  ): Promise<LsSourcingEntity[]> {
    return this.sourcings.find({
      where: {
        status: In(statuses),
        ...(loadStatuses ? { load: { status: In(loadStatuses) } } : {}),
      },
      relations: { load: true, partner: true },
      order: { createdAt: 'ASC' },
      take: 200,
    });
  }

  async updateSourcing(id: string, data: QueryDeepPartialEntity<LsSourcingEntity>) {
    await this.sourcings.update({ id }, data);
    return (await this.findSourcing(id))!;
  }

  listPartnerBids(sourcingId: string): Promise<LsPartnerBidEntity[]> {
    return this.partnerBids.find({
      where: { sourcingId },
      relations: { partner: true },
      order: { createdAt: 'ASC' },
    });
  }

  async markOtherPartnerBidsLost(sourcingId: string, wonId: string): Promise<void> {
    await this.partnerBids.update({ sourcingId, id: Not(wonId) }, { status: 'lost' });
  }

  listCharges(tenantId: string, loadId: string): Promise<LoadChargeEntity[]> {
    return this.charges.find({ where: { tenantId, loadId }, order: { createdAt: 'ASC' } });
  }

  async approvedChargesTotal(tenantId: string, loadId: string): Promise<number> {
    const charges = await this.charges.findBy({ tenantId, loadId, status: 'approved' });
    return charges.reduce((sum, charge) => sum + Number(charge.amount), 0);
  }

  findPartnerPayment(sourcingId: string, paymentType: PartnerPaymentType) {
    return this.partnerPayments.findOneBy({ sourcingId, paymentType });
  }

  findClaim(loadId: string): Promise<LoadClaimEntity | null> {
    return this.claims.findOneBy({ loadId });
  }

  findInvoice(tenantId: string, loadId: string): Promise<LsInvoiceEntity | null> {
    return this.invoices.findOneBy({ tenantId, loadId });
  }

  /** The shipper's GSTIN state (first two digits of its active GST certificate) — the invoice's
   *  place of supply. */
  async shipperGstStateCode(tenantId: string): Promise<string | null> {
    const doc = await this.dataSource.getRepository(OrganizationDocumentEntity).findOne({
      where: {
        organizationId: tenantId,
        documentType: 'gst_certificate',
        deletedAt: IsNull(),
        documentNumber: Not(IsNull()),
      },
      select: { id: true, documentNumber: true },
      order: { createdAt: 'DESC' },
    });
    const gstin = doc?.documentNumber?.trim();
    return gstin && /^\d{2}/.test(gstin) ? gstin.slice(0, 2) : null;
  }

  creditNotesTotal(loadId: string): Promise<number> {
    return this.creditNotes
      .findBy({ loadId })
      .then((notes) => notes.reduce((sum, note) => sum + Number(note.amount), 0));
  }

  listLoadsAt(statuses: LoadStatus[]): Promise<LsSourcingEntity[]> {
    return this.sourcings.find({
      where: { status: 'won', load: { status: In(statuses) } },
      relations: { load: true, partner: true },
      order: { updatedAt: 'ASC' },
      take: 200,
    });
  }

  /** Partners with no bid on this sourcing yet — Placement's call list. */
  async partnersWithoutBid(sourcingId: string): Promise<LsPartnerEntity[]> {
    const bids = await this.partnerBids.findBy({ sourcingId });
    const bidders = new Set(bids.map((bid) => bid.partnerId));
    const partners = await this.partners.find({
      where: { status: 'active' },
      order: { name: 'ASC' },
    });
    return partners.filter((partner) => !bidders.has(partner.id));
  }
}
