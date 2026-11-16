import { DataSource, EntityManager, In, Not, Repository } from 'typeorm';
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
  }

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  // --- Placement ---------------------------------------------------------------------------

  /** Active brokers with the lanes and truck types they claim. */
  listBrokersWithClaims(): Promise<LsPartnerEntity[]> {
    return this.partners.find({
      where: { partnerType: 'broker', status: 'active' },
      relations: { lanes: true, truckTypes: true },
      order: { name: 'ASC' },
    });
  }

  /** Loads each partner won on this lane (by the posting's pickup and drop city). */
  async loadsOnLane(fromCity: string, toCity: string): Promise<Map<string, number>> {
    const rows = (await this.dataSource.query(
      `SELECT s."partner_id" AS "partnerId", COUNT(*)::int AS "count"
         FROM "loads"."ls_sourcings" s
         JOIN "loads"."loads" l ON l."id" = s."load_id"
         JOIN "loads"."load_postings" p ON p."id" = l."posting_id"
        WHERE s."status" = 'won' AND s."partner_id" IS NOT NULL
          AND lower(p."pickup_address"->>'city') = lower($1)
          AND lower(p."drop_address"->>'city') = lower($2)
        GROUP BY s."partner_id"`,
      [fromCity, toCity],
    )) as { partnerId: string; count: number }[];
    return new Map(rows.map((row) => [row.partnerId, row.count]));
  }

  async partnerRatings(): Promise<Map<string, number>> {
    const rows = (await this.dataSource.query(
      `SELECT "partner_id" AS "partnerId", ROUND(AVG("score")::numeric, 1)::float AS "rating"
         FROM "loads"."load_ratings" WHERE "subject" = 'partner' AND "partner_id" IS NOT NULL
        GROUP BY "partner_id"`,
    )) as { partnerId: string; rating: number }[];
    return new Map(rows.map((row) => [row.partnerId, row.rating]));
  }

  /** The load's truck type — body type and capacity — from the shipper's truck type master. */
  async loadTruckType(
    tenantId: string,
    truckTypeId: string,
  ): Promise<{ bodyType: string | null; capacityTons: string | null } | null> {
    const [row] = (await this.dataSource.query(
      `SELECT "body_type" AS "bodyType", "capacity_tons" AS "capacityTons"
         FROM "masters"."truck_types" WHERE "id" = $1 AND "tenant_id" = $2`,
      [truckTypeId, tenantId],
    )) as { bodyType: string | null; capacityTons: string | null }[];
    return row ?? null;
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
    const rows = (await this.dataSource.query(
      `SELECT u."id" AS "id", r."name" AS "role"
         FROM "auth"."users" u JOIN "auth"."roles" r ON r."id" = u."role_id"
        WHERE u."id" = ANY($1)`,
      [userIds],
    )) as { id: string; role: string }[];
    return new Map(rows.map((row) => [row.id, row.role]));
  }

  /** Does this staff user's role carry the permission key? */
  async userHasPermission(userId: string, key: string): Promise<boolean> {
    const rows = (await this.dataSource.query(
      `SELECT 1 FROM "auth"."users" u
         JOIN "auth"."role_permissions" rp ON rp."role_id" = u."role_id"
         JOIN "auth"."permissions" p ON p."id" = rp."permission_id"
        WHERE u."id" = $1 AND p."key" = $2 LIMIT 1`,
      [userId, key],
    )) as unknown[];
    return rows.length > 0;
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
    const rows = (await this.dataSource.query(
      `SELECT DISTINCT "load_id" AS "loadId" FROM "loads"."load_memos"
        WHERE "load_id" = ANY($1) AND "status" = 'sent' AND "expires_at" > $2`,
      [loadIds, now],
    )) as { loadId: string }[];
    return new Set(rows.map((row) => row.loadId));
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
    const rows = (await this.dataSource.query(
      `SELECT "document_number" FROM "auth"."organization_documents"
        WHERE "organization_id" = $1 AND "document_type" = 'gst_certificate'
          AND "deleted_at" IS NULL AND "document_number" IS NOT NULL
        ORDER BY "created_at" DESC LIMIT 1`,
      [tenantId],
    )) as { document_number: string }[];
    const gstin = rows[0]?.document_number?.trim();
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
