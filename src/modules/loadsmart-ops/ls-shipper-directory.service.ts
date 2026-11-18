import { DataSource, In, IsNull } from 'typeorm';
import { NotFoundError, rethrow } from '../../shared/errors';
import { ORG_ADMIN_ROLE } from '../../shared/constants/roles';
import { AuditLogEntity } from '../audit/audit.entity';
import { UserEntity } from '../auth/entities/user.entity';
import { CustomerEntity } from '../customers/entities/customer.entity';
import { CustomerDeliveryPointEntity } from '../customers/entities/customer-delivery-point.entity';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadPostingEntity } from '../loads/load-posting/entities/load-posting.entity';
import { LoadingPointEntity } from '../masters/loading-point/entities/loading-point.entity';
import { OrganizationEntity } from '../organization/entities/organization.entity';
import { ReferralCodeEntity } from '../organization/entities/referral-code.entity';
import { OrganizationDocumentEntity } from '../organization/entities/organization-document.entity';
import { ORGANIZATION_DOCUMENT_TYPE_LABELS } from '../organization/organization.constants';
import { LoadRatingEntity } from './entities/load-rating.entity';
import { LsCommercialTermsEntity } from './entities/ls-commercial-terms.entity';
import { LsInvoiceEntity } from './entities/ls-invoice.entity';
import type { CommercialTermsInput } from './loadsmart.interface';
import type { LsSourcingService } from './ls-sourcing.service';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface ShipperDirectoryQuery {
  search?: string;
  status?: string;
  page: number;
  limit: number;
}

/** "Road 9, VKI Area, Jaipur, Rajasthan 302013": the parts, then the state and PIN together. */
const joinAddress = (parts: (string | null)[], state: string | null, pin: string | null) =>
  [parts.filter(Boolean).join(', '), [state, pin].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');

/** The status tabs: awaiting approval covers pending and partly reviewed applications. */
const STATUS_GROUPS: Record<string, string[]> = {
  awaiting: ['pending', 'partial_pending'],
  active: ['active'],
  suspended: ['suspended'],
  rejected: ['rejected'],
};

export type ActivityCategory = 'onboarding' | 'terms' | 'documents' | 'money' | 'other';
export type ActivityTone = 'blue' | 'green' | 'amber' | 'red' | 'grey';

const ACTIVITY_RULES: { test: RegExp; category: ActivityCategory; tone: ActivityTone }[] = [
  { test: /DOCUMENT.*(FAIL|REJECT)|REJECT/, category: 'documents', tone: 'red' },
  { test: /DOCUMENT.*(UPLOAD|PENDING)/, category: 'documents', tone: 'amber' },
  { test: /DOCUMENT/, category: 'documents', tone: 'green' },
  { test: /TERMS|LATE_DELIVERY|CHARGE_DECIDED/, category: 'terms', tone: 'blue' },
  { test: /PAYMENT|RECEIPT|INVOICE/, category: 'money', tone: 'green' },
  { test: /APPROVED|KYC_COMPLETED|VERIFIED/, category: 'onboarding', tone: 'green' },
  {
    test: /ONBOARDING|KYC|STATUS|COMPANY|BUSINESS|REFERRAL|SIGNED/,
    category: 'onboarding',
    tone: 'blue',
  },
];

/** What the Activity tab shows for one audit row: a readable title, its tab and dot colour. */
const describeActivity = (action: string | null) => {
  const code = (action ?? '').toUpperCase();
  const rule = ACTIVITY_RULES.find((r) => r.test.test(code));
  const words = code.replace(/^LS_/, '').split('_').filter(Boolean).join(' ').toLowerCase();
  return {
    title: words ? words.charAt(0).toUpperCase() + words.slice(1) : 'Activity',
    category: (rule?.category ?? 'other') as ActivityCategory,
    tone: (rule?.tone ?? 'grey') as ActivityTone,
  };
};

const num = (value: string | number | null | undefined): number => Number(value ?? 0);

/**
 * The Approval team's read-only view of a shipper account (the "Shippers" master): every shipper
 * with its company details, Loadsmart terms, loading points, consignees, documents, invoices
 * and activity. Loads reuse the All loads list (filtered to the shipper). Margin and the carrier
 * advance are Loadsmart's own and never leave here — Approval sees the shipper's side only.
 */
export class LsShipperDirectoryService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly sourcing: LsSourcingService,
  ) {}

  /** Every shipper: status filter and search narrow it; counts per status for the tabs. */
  async list(query: ShipperDirectoryQuery) {
    try {
      const orgs = this.dataSource.getRepository(OrganizationEntity);
      const base = () => orgs.createQueryBuilder('org');
      const filtered = base();
      const statuses = query.status ? STATUS_GROUPS[query.status] : undefined;
      if (statuses) filtered.andWhere('org.status IN (:...statuses)', { statuses });
      if (query.search) {
        filtered.andWhere(
          `(org.name ILIKE :s OR org.companyLegalName ILIKE :s OR org.city ILIKE :s OR org.operationalCity ILIKE :s
            OR EXISTS (SELECT 1 FROM auth.organization_documents d WHERE d.organization_id = org.id
              AND d.document_number ILIKE :s AND d.deleted_at IS NULL))`,
          { s: `%${query.search}%` },
        );
      }
      const [rows, total] = await filtered
        .orderBy('org.name', 'ASC')
        .skip((query.page - 1) * query.limit)
        .take(query.limit)
        .getManyAndCount();
      const counts = await base()
        .select('org.status', 'status')
        .addSelect('COUNT(*)', 'count')
        .groupBy('org.status')
        .getRawMany<{ status: string; count: string }>();

      const ids = rows.map((row) => row.id);
      const since = new Date(Date.now() - 30 * DAY_MS);
      const [loads30, lastLoads, contacts, gstDocs, referrals, openMoney] = ids.length
        ? await Promise.all([
            this.dataSource
              .getRepository(LoadEntity)
              .createQueryBuilder('l')
              .select('l.tenantId', 'tenantId')
              .addSelect('COUNT(*)', 'count')
              .where('l.tenantId IN (:...ids)', { ids })
              .andWhere('l.createdAt >= :since', { since })
              .groupBy('l.tenantId')
              .getRawMany<{ tenantId: string; count: string }>(),
            this.dataSource
              .getRepository(LoadPostingEntity)
              .createQueryBuilder('p')
              .select('p.tenantId', 'tenantId')
              .addSelect('MAX(p.createdAt)', 'lastLoadAt')
              .where('p.tenantId IN (:...ids)', { ids })
              .groupBy('p.tenantId')
              .getRawMany<{ tenantId: string; lastLoadAt: Date }>(),
            this.orgAdmins(ids),
            this.dataSource.getRepository(OrganizationDocumentEntity).find({
              select: { organizationId: true, documentNumber: true },
              where: {
                organizationId: In(ids),
                documentType: 'gst_certificate',
                deletedAt: IsNull(),
              },
            }),
            this.dataSource.getRepository(ReferralCodeEntity).find({
              where: { id: In(rows.map((r) => r.referralCodeId).filter((x): x is string => !!x)) },
              relations: { owner: true },
            }),
            this.dataSource
              .getRepository(LsInvoiceEntity)
              .createQueryBuilder('i')
              .select('i.tenantId', 'tenantId')
              .addSelect('COALESCE(SUM(i.openAmount), 0)', 'outstanding')
              .where('i.tenantId IN (:...ids)', { ids })
              .groupBy('i.tenantId')
              .getRawMany<{ tenantId: string; outstanding: string }>(),
          ])
        : [[], [], new Map<string, UserEntity>(), [], [], []];
      const gstOf = new Map(gstDocs.map((d) => [d.organizationId, d.documentNumber]));
      const salesOf = new Map(referrals.map((r) => [r.id, r.owner?.fullName ?? null]));
      const outstandingOf = new Map(openMoney.map((r) => [r.tenantId, num(r.outstanding)]));
      const loadsOf = new Map(loads30.map((r) => [r.tenantId, num(r.count)]));
      const lastOf = new Map(lastLoads.map((r) => [r.tenantId, r.lastLoadAt]));

      return {
        total,
        page: query.page,
        limit: query.limit,
        counts: {
          all: counts.reduce((sum, c) => sum + num(c.count), 0),
          ...Object.fromEntries(
            Object.entries(STATUS_GROUPS).map(([group, statuses]) => [
              group,
              counts
                .filter((c) => statuses.includes(c.status))
                .reduce((n, c) => n + num(c.count), 0),
            ]),
          ),
        },
        summary: await this.summary(),
        items: rows.map((org) => ({
          id: org.id,
          name: org.name ?? org.companyLegalName ?? 'Unnamed shipper',
          legalName: org.companyLegalName,
          city: org.operationalCity ?? org.city,
          state: org.state,
          status: org.status,
          contactName: contacts.get(org.id)?.fullName ?? org.orgAdminName,
          contactPhone: contacts.get(org.id)?.phoneNumber ?? null,
          gstin: gstOf.get(org.id) ?? null,
          salesName: (org.referralCodeId && salesOf.get(org.referralCodeId)) || null,
          outstanding: outstandingOf.get(org.id) ?? 0,
          loadsLast30Days: loadsOf.get(org.id) ?? 0,
          lastLoadAt: lastOf.get(org.id) ?? null,
        })),
      };
    } catch (error) {
      rethrow(error, 'Failed to list the shippers');
    }
  }

  /** The four cards above the list. */
  private async summary() {
    const since = new Date(Date.now() - 30 * DAY_MS);
    const today = new Date().toISOString().slice(0, 10);
    const dayAgo = new Date(Date.now() - DAY_MS);
    const orgs = () => this.dataSource.getRepository(OrganizationEntity).createQueryBuilder('org');
    const [approved, awaiting, waitingOverDay, noSalesperson, moved, overdue] = await Promise.all([
      orgs().where('org.status = :s', { s: 'active' }).getCount(),
      orgs().where('org.status IN (:...s)', { s: STATUS_GROUPS.awaiting }).getCount(),
      orgs()
        .where('org.status IN (:...s)', { s: STATUS_GROUPS.awaiting })
        .andWhere('org.submittedAt < :dayAgo', { dayAgo })
        .getCount(),
      orgs()
        .where('org.status IN (:...s)', { s: STATUS_GROUPS.awaiting })
        .andWhere('org.referralCodeId IS NULL')
        .getCount(),
      this.dataSource
        .getRepository(LoadEntity)
        .createQueryBuilder('l')
        .select('COUNT(DISTINCT l.tenantId)', 'count')
        .where('l.createdAt >= :since', { since })
        .getRawOne<{ count: string }>(),
      this.dataSource
        .getRepository(LsInvoiceEntity)
        .createQueryBuilder('i')
        .select('COUNT(DISTINCT i.tenantId)', 'shippers')
        .addSelect('COALESCE(SUM(i.openAmount), 0)', 'amount')
        .where('i.dueDate < :today AND i.openAmount > 0', { today })
        .getRawOne<{ shippers: string; amount: string }>(),
    ]);
    return {
      approved,
      movedLoadIn30Days: num(moved?.count),
      awaiting,
      waitingOverADay: waitingOverDay,
      noSalesperson,
      withOverdue: num(overdue?.shippers),
      overdueAmount: num(overdue?.amount),
    };
  }

  /** The header, KPI tiles, company block, Loadsmart terms and the counts on the side tabs. */
  async profile(tenantId: string) {
    try {
      const org = await this.assertShipper(tenantId);
      const since = new Date(Date.now() - 30 * DAY_MS);
      const today = new Date().toISOString().slice(0, 10);
      const dataSource = this.dataSource;

      const [
        admins,
        gst,
        terms,
        loadsLast30,
        loadsTotal,
        invoiceMoney,
        rating,
        loadingPoints,
        consignees,
        documents,
        invoices,
        activity,
        owner,
        termsRow,
      ] = await Promise.all([
        this.orgAdmins([tenantId]),
        dataSource.getRepository(OrganizationDocumentEntity).findOne({
          where: { organizationId: tenantId, documentType: 'gst_certificate', deletedAt: IsNull() },
        }),
        dataSource.getRepository(LsCommercialTermsEntity).findOne({ where: { tenantId } }),
        dataSource
          .getRepository(LoadEntity)
          .createQueryBuilder('l')
          .where('l.tenantId = :tenantId AND l.createdAt >= :since', { tenantId, since })
          .getCount(),
        dataSource.getRepository(LoadEntity).count({ where: { tenantId } }),
        dataSource
          .getRepository(LsInvoiceEntity)
          .createQueryBuilder('i')
          .select('COALESCE(SUM(i.openAmount), 0)', 'outstanding')
          .addSelect(
            'COALESCE(SUM(CASE WHEN i.dueDate < :today THEN i.openAmount ELSE 0 END), 0)',
            'overdue',
          )
          .addSelect('COUNT(*) FILTER (WHERE i.openAmount > 0)', 'openCount')
          .addSelect('COUNT(*) FILTER (WHERE i.openAmount > 0 AND i.dueDate < :today)', 'lateCount')
          .addSelect('MIN(CASE WHEN i.openAmount > 0 THEN i.dueDate END)', 'oldestDue')
          .where('i.tenantId = :tenantId', { tenantId })
          .setParameter('today', today)
          .getRawOne<Record<string, string | null>>(),
        dataSource
          .getRepository(LoadRatingEntity)
          .createQueryBuilder('r')
          .select('AVG(r.score)', 'average')
          .addSelect('COUNT(*)', 'count')
          .where("r.tenantId = :tenantId AND r.subject = 'shipper'", { tenantId })
          .getRawOne<{ average: string | null; count: string }>(),
        dataSource
          .getRepository(LoadingPointEntity)
          .count({ where: { tenantId, deletedAt: IsNull() } }),
        dataSource
          .getRepository(CustomerEntity)
          .count({ where: { tenantId, deletedAt: IsNull() } }),
        dataSource
          .getRepository(OrganizationDocumentEntity)
          .count({ where: { organizationId: tenantId, deletedAt: IsNull() } }),
        dataSource.getRepository(LsInvoiceEntity).count({ where: { tenantId } }),
        dataSource.getRepository(AuditLogEntity).count({ where: { tenantId } }),
        org.referralCodeId
          ? dataSource
              .getRepository(ReferralCodeEntity)
              .findOne({ where: { id: org.referralCodeId }, relations: { owner: true } })
          : Promise.resolve(null),
        dataSource.getRepository(LsCommercialTermsEntity).findOne({ where: { tenantId } }),
      ]);
      const termsEditor = termsRow?.updatedBy
        ? await dataSource
            .getRepository(UserEntity)
            .findOne({ where: { id: termsRow.updatedBy }, relations: { role: true } })
        : null;

      const admin = admins.get(tenantId);
      const oldestDue = invoiceMoney?.oldestDue ? new Date(invoiceMoney.oldestDue) : null;
      return {
        id: org.id,
        name: org.name ?? org.companyLegalName ?? 'Unnamed shipper',
        status: org.status,
        approvedAt: org.approvedAt,
        city: org.operationalCity ?? org.city,
        state: org.state,
        salesName: owner?.owner?.fullName ?? null,
        kpis: {
          loadsLast30Days: loadsLast30,
          loadsTotal,
          outstanding: num(invoiceMoney?.outstanding),
          outstandingInvoices: num(invoiceMoney?.openCount),
          overdue: num(invoiceMoney?.overdue),
          overdueInvoices: num(invoiceMoney?.lateCount),
          overdueDays:
            oldestDue && oldestDue.getTime() < Date.now()
              ? Math.floor((Date.now() - oldestDue.getTime()) / DAY_MS)
              : null,
          rating: rating?.average ? Math.round(num(rating.average) * 10) / 10 : null,
          ratingCount: num(rating?.count),
        },
        company: {
          legalName: org.companyLegalName,
          gstin: gst?.documentNumber ?? null,
          // Characters 3 to 12 of a GSTIN are the holder's PAN.
          pan: gst?.documentNumber ? gst.documentNumber.slice(2, 12) : null,
          gstNameMatched: gst ? gst.verificationStatus === 'verified' : null,
          gstVerifiedAt: gst?.verifiedAt ?? null,
          hasOwnFleet: org.hasOwnFleet,
          address: [
            org.addressLine1,
            org.addressLine2,
            org.areaLocality,
            org.city,
            org.state,
            org.pinCode,
          ]
            .filter(Boolean)
            .join(', '),
          contact: admin
            ? { name: admin.fullName, phone: admin.phoneNumber, email: admin.email }
            : { name: org.orgAdminName, phone: null, email: null },
        },
        // Margin and the carrier advance stay with Loadsmart: only the shipper-facing terms.
        terms: {
          configured: Boolean(terms),
          shipperAdvancePercent:
            terms?.shipperAdvancePercent == null ? null : num(terms.shipperAdvancePercent),
          shipperAdvanceDays: terms?.shipperAdvanceDays ?? null,
          balancePayer: terms?.balancePayer ?? 'shipper',
          podType: terms?.podType ?? 'image',
          creditDays: terms?.creditDays ?? null,
          physicalLr: terms?.physicalLr ?? false,
          physicalLrNote: terms?.physicalLrNote ?? null,
          preapprovedCharges: terms?.preapprovedCharges ?? [],
          billingInstructions: terms?.billingInstructions ?? [],
          billingNote: terms?.billingNote ?? null,
          updatedAt: terms?.updatedAt ?? null,
          updatedBy: termsEditor?.fullName ?? null,
          updatedByRole: termsEditor?.role?.name ?? null,
        },
        counts: {
          loadingPoints,
          consignees,
          documents,
          loads: loadsTotal,
          invoices,
          tickets: 0, // Tickets (C02) are not in this build.
          activity,
        },
      };
    } catch (error) {
      rethrow(error, 'Failed to get the shipper');
    }
  }

  async loadingPoints(tenantId: string) {
    try {
      await this.assertShipper(tenantId);
      const [points, usage] = await Promise.all([
        this.dataSource
          .getRepository(LoadingPointEntity)
          .find({ where: { tenantId, deletedAt: IsNull() }, order: { title: 'ASC' } }),
        this.loadUsage(tenantId, 'pickupLoadingPointId'),
      ]);
      const usageOf = usage;
      return points.map((point) => ({
        id: point.id,
        name: point.title,
        address: joinAddress(
          [point.addressLine1, point.areaLocality, point.city],
          point.state,
          point.pinCode,
        ),
        contactName: point.contactPersonName,
        contactPhone: point.contactPersonNumber,
        geofenceMeters: point.geofenceRadiusM,
        pinned: Boolean(point.googlePlaceId || point.latitude),
        status: point.status,
        loads: usageOf.get(point.id)?.loads ?? 0,
        lastLoadAt: usageOf.get(point.id)?.lastAt ?? null,
        lastLoadCode: usageOf.get(point.id)?.lastCode ?? null,
      }));
    } catch (error) {
      rethrow(error, 'Failed to list the loading points');
    }
  }

  /** Consignees (customers) with their first unloading point. */
  async consignees(tenantId: string) {
    try {
      await this.assertShipper(tenantId);
      const [customers, usage] = await Promise.all([
        this.dataSource.getRepository(CustomerEntity).find({
          where: { tenantId, deletedAt: IsNull() },
          relations: { deliveryPoints: true },
          order: { name: 'ASC' },
        }),
        this.loadUsage(tenantId, 'customerId'),
      ]);
      const usageOf = usage;
      return customers.map((customer) => {
        const drop = (customer.deliveryPoints ?? []).find(
          (point: CustomerDeliveryPointEntity) => !point.deletedAt,
        );
        return {
          id: customer.id,
          name: customer.name,
          unloadingPoint: drop
            ? joinAddress([drop.addressLine1 ?? drop.location, drop.city], drop.state, drop.pinCode)
            : null,
          unloadingPoints: (customer.deliveryPoints ?? []).filter((point) => !point.deletedAt)
            .length,
          contactName: customer.contactPersonName ?? drop?.pocName ?? null,
          contactPhone: customer.contactPersonNumber ?? customer.mobile ?? drop?.pocPhone ?? null,
          gstin: customer.gstin,
          loads: usageOf.get(customer.id)?.loads ?? 0,
          lastLoadAt: usageOf.get(customer.id)?.lastAt ?? null,
          lastLoadCode: usageOf.get(customer.id)?.lastCode ?? null,
        };
      });
    } catch (error) {
      rethrow(error, 'Failed to list the consignees');
    }
  }

  async documents(tenantId: string) {
    try {
      await this.assertShipper(tenantId);
      const documents = await this.dataSource.getRepository(OrganizationDocumentEntity).find({
        where: { organizationId: tenantId, deletedAt: IsNull() },
        order: { createdAt: 'ASC' },
      });
      return documents.map((doc) => ({
        id: doc.id,
        type: doc.documentType,
        label: ORGANIZATION_DOCUMENT_TYPE_LABELS[doc.documentType] ?? doc.documentType,
        number: doc.documentNumber,
        status: doc.verificationStatus,
        verifiedAt: doc.verifiedAt,
        rejectionReason: doc.rejectionReason,
        uploadedAt: doc.createdAt,
      }));
    } catch (error) {
      rethrow(error, 'Failed to list the documents');
    }
  }

  /** The shipper's invoices, newest first — invoice, load, amount and what is still open. */
  async invoices(tenantId: string) {
    try {
      await this.assertShipper(tenantId);
      const rows = await this.dataSource
        .getRepository(LsInvoiceEntity)
        .createQueryBuilder('i')
        .leftJoin(LoadEntity, 'l', 'l.id = i.loadId')
        .select([
          'i.id AS "id"',
          'i.invoiceNumber AS "invoiceNumber"',
          'i.loadId AS "loadId"',
          'l.code AS "loadCode"',
          'i.totalAmount AS "total"',
          'i.advanceReceived AS "advanceReceived"',
          'i.balanceDue AS "balanceDue"',
          'i.openAmount AS "openAmount"',
          'i.status AS "status"',
          'i.dueDate AS "dueDate"',
          'i.createdAt AS "issuedAt"',
        ])
        .where('i.tenantId = :tenantId', { tenantId })
        .orderBy('i.createdAt', 'DESC')
        .getRawMany<Record<string, string | null>>();
      const today = new Date().toISOString().slice(0, 10);
      return rows.map((row) => ({
        id: row.id,
        invoiceNumber: row.invoiceNumber,
        loadId: row.loadId,
        loadCode: row.loadCode,
        total: num(row.total),
        advanceReceived: num(row.advanceReceived),
        balanceDue: num(row.balanceDue),
        openAmount: row.openAmount === null ? null : num(row.openAmount),
        status: row.status,
        dueDate: row.dueDate,
        overdue: Boolean(row.dueDate && row.dueDate < today && num(row.openAmount) > 0),
        issuedAt: row.issuedAt,
      }));
    } catch (error) {
      rethrow(error, 'Failed to list the invoices');
    }
  }

  /** Edit terms: the shipper-facing terms only; margin and the trucker advance stay as they are. */
  async saveTerms(
    actorId: string,
    tenantId: string,
    input: Omit<CommercialTermsInput, 'marginPercent' | 'truckerAdvancePercent'>,
  ) {
    await this.assertShipper(tenantId);
    const current = await this.sourcing.getTerms(tenantId);
    await this.sourcing.saveTerms(actorId, tenantId, {
      ...input,
      truckerAdvancePercent: current.truckerAdvancePercent,
    });
    return this.profile(tenantId);
  }

  /** Tickets (C02) are not in this build: an empty list the screen shows as such. */
  async tickets(tenantId: string) {
    await this.assertShipper(tenantId);
    return [];
  }

  /** What happened on the account, newest first, with who did it. */
  async activity(tenantId: string, limit: number) {
    try {
      await this.assertShipper(tenantId);
      const rows = await this.dataSource
        .getRepository(AuditLogEntity)
        .createQueryBuilder('a')
        .leftJoin('a.user', 'u')
        .select([
          'a.id',
          'a.action',
          'a.resource_type',
          'a.new_data',
          'a.createdAt',
          'u.id',
          'u.fullName',
        ])
        .where('a.tenantId = :tenantId', { tenantId })
        .orderBy('a.createdAt', 'DESC')
        .take(limit)
        .getMany();
      return rows.map((row) => {
        const data = row.new_data ?? {};
        const note = ['note', 'reason', 'message', 'description']
          .map((k) => data[k])
          .find((v) => typeof v === 'string');
        return {
          id: row.id,
          action: row.action,
          resource: row.resource_type,
          by: row.user?.fullName ?? null,
          at: row.createdAt,
          ...describeActivity(row.action),
          detail: typeof note === 'string' ? note : null,
        };
      });
    } catch (error) {
      rethrow(error, 'Failed to list the activity');
    }
  }

  /** Loads per loading point or consignee (through the posting they came from), with the latest
   *  load's code and time. */
  private async loadUsage(tenantId: string, column: 'pickupLoadingPointId' | 'customerId') {
    const rows = await this.dataSource
      .getRepository(LoadEntity)
      .createQueryBuilder('l')
      .innerJoin(LoadPostingEntity, 'p', 'p.id = l.postingId')
      .select(`p.${column}`, 'id')
      .addSelect('l.code', 'code')
      .addSelect('l.createdAt', 'at')
      .where(`l.tenantId = :tenantId AND p.${column} IS NOT NULL`, { tenantId })
      .orderBy('l.createdAt', 'DESC')
      .getRawMany<{ id: string; code: string; at: Date }>();
    const usage = new Map<string, { loads: number; lastCode: string; lastAt: Date }>();
    for (const row of rows) {
      const entry = usage.get(row.id);
      if (entry) entry.loads += 1;
      else usage.set(row.id, { loads: 1, lastCode: row.code, lastAt: row.at });
    }
    return usage;
  }

  private async assertShipper(tenantId: string): Promise<OrganizationEntity> {
    const org = await this.dataSource
      .getRepository(OrganizationEntity)
      .findOne({ where: { id: tenantId } });
    if (!org) throw new NotFoundError('Shipper not found');
    return org;
  }

  private async orgAdmins(tenantIds: string[]): Promise<Map<string, UserEntity>> {
    const users = await this.dataSource
      .getRepository(UserEntity)
      .createQueryBuilder('u')
      .innerJoin('u.role', 'role')
      .where('u.tenantId IN (:...tenantIds)', { tenantIds })
      .andWhere('role.name = :roleName', { roleName: ORG_ADMIN_ROLE })
      .andWhere('u.deletedAt IS NULL')
      .orderBy('u.createdAt', 'ASC')
      .getMany();
    const byTenant = new Map<string, UserEntity>();
    for (const user of users) {
      if (user.tenantId && !byTenant.has(user.tenantId)) byTenant.set(user.tenantId, user);
    }
    return byTenant;
  }
}
