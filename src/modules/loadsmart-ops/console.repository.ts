import { DataSource, SelectQueryBuilder } from 'typeorm';
import { LoadBidEntity } from '../loads/bids/load-bid.entity';
import { LoadDocumentEntity } from '../loads/documents/load-document.entity';
import { LoadStageHistoryEntity } from '../loads/entities/load-stage-history.entity';
import { LoadEntity } from '../loads/entities/load.entity';
import { LoadStatus } from '../loads/utils/loads.types';
import { OrganizationEntity } from '../organization/entities/organization.entity';
import { LoadClaimEntity } from './entities/load-claim.entity';
import { LsInvoiceEntity } from './entities/ls-invoice.entity';
import { LsOriginalPodEntity } from './entities/ls-original-pod.entity';
import { LsPartnerPaymentEntity } from './entities/ls-partner-payment.entity';
import { LsSourcingEntity } from './entities/ls-sourcing.entity';
import { InvoiceStatus, PartnerPaymentStatus, SourcingStatus } from './loadsmart.types';

/** A trip amount: per-ton rates times the planned tonnes, flat rates as they are. `rate` is a
 *  QueryBuilder property path (l.freightValue, s.partnerRate) on the `l` (load) alias. */
const trip = (rate: string) =>
  `(CASE WHEN l.freightType = 'per_ton' THEN ${rate} * l.plannedCapacityTonnes ELSE ${rate} END)`;

/** Median hours between two timestamps, over the rows matching the optional filter. */
const medianHours = (start: string, end: string, filter?: string) =>
  `percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (${end} - ${start})) / 3600)` +
  (filter ? ` FILTER (WHERE ${filter})` : '');

/** Median days between two timestamps, over the rows matching the optional filter. */
const medianDays = (start: string, end: string, filter?: string) =>
  `percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (${end} - ${start})) / 86400)` +
  (filter ? ` FILTER (WHERE ${filter})` : '');

const round1 = (value: string | number | null | undefined) =>
  value === null || value === undefined ? null : Math.round(Number(value) * 10) / 10;

export interface AllLoadsRow {
  sourcingId: string;
  sourcingStatus: SourcingStatus;
  tenantId: string;
  shipperName: string | null;
  loadId: string;
  code: string;
  status: LoadStatus;
  vehicleNumber: string | null;
  driverName: string | null;
  driverNumber: string | null;
  fromCity: string | null;
  toCity: string | null;
  pickupAt: Date | null;
  partnerName: string | null;
  shipperTrip: string | null;
  carrierTrip: string | null;
  claimStatus: string | null;
  invoiceStatus: InvoiceStatus | null;
  advanceStatus: PartnerPaymentStatus | null;
  balanceStatus: PartnerPaymentStatus | null;
  lastStageAt: Date | null;
  updatedAt: Date;
}

export interface AllLoadsFilter {
  status?: LoadStatus[];
  tenantId?: string;
  /** Load code, vehicle number or driver mobile. */
  q?: string;
}

export interface PeriodTiles {
  posted: number;
  placed: number;
  billedCount: number;
  billedAmount: number;
  shipperTrip: number;
  carrierTrip: number;
  medianHoursToPlace: number | null;
  deliveredWithPromise: number;
  deliveredOnTime: number;
}

/**
 * Read-only queries for the console's cross-team views — every Loadsmart load (one with a sourcing)
 * across shippers. Kept apart from LoadsmartRepository, which the services write through.
 */
export class ConsoleRepository {
  constructor(private readonly dataSource: DataSource) {}

  /** Loadsmart loads: every sourcing joined to its load (aliases `s` and `l`). */
  private sourcedLoads(): SelectQueryBuilder<LsSourcingEntity> {
    return this.dataSource
      .getRepository(LsSourcingEntity)
      .createQueryBuilder('s')
      .innerJoin('s.load', 'l');
  }

  /** Invoices joined to their load and its sourcing (aliases `i`, `l`, `s`). */
  private invoicedLoads(): SelectQueryBuilder<LsInvoiceEntity> {
    return this.dataSource
      .getRepository(LsInvoiceEntity)
      .createQueryBuilder('i')
      .innerJoin(LoadEntity, 'l', 'l.id = i.loadId')
      .innerJoin(LsSourcingEntity, 's', 's.loadId = l.id');
  }

  /** L01, newest activity first, at most `cap` rows (the team filter runs after). */
  async allLoads(filter: AllLoadsFilter, cap = 2000): Promise<AllLoadsRow[]> {
    const query = this.sourcedLoads()
      .leftJoin('l.posting', 'p')
      .leftJoin(OrganizationEntity, 'o', 'o.id = s.tenantId')
      .leftJoin('s.partner', 'pa')
      .leftJoin(LoadClaimEntity, 'c', 'c.loadId = l.id')
      .leftJoin(LsInvoiceEntity, 'i', 'i.loadId = l.id')
      .leftJoin(
        LsPartnerPaymentEntity,
        'adv',
        "adv.sourcingId = s.id AND adv.paymentType = 'advance'",
      )
      .leftJoin(
        LsPartnerPaymentEntity,
        'bal',
        "bal.sourcingId = s.id AND bal.paymentType = 'balance'",
      )
      .select([
        's.id AS "sourcingId"',
        's.status AS "sourcingStatus"',
        's.tenantId AS "tenantId"',
        'o.name AS "shipperName"',
        'l.id AS "loadId"',
        'l.code AS "code"',
        'l.status AS "status"',
        'l.vehicleNumber AS "vehicleNumber"',
        'l.driverName AS "driverName"',
        'l.driverNumber AS "driverNumber"',
        `p.pickupAddress ->> 'city' AS "fromCity"`,
        `p.dropAddress ->> 'city' AS "toCity"`,
        'p.pickupAt AS "pickupAt"',
        'pa.name AS "partnerName"',
        `ROUND(${trip('l.freightValue')}, 2) AS "shipperTrip"`,
        `ROUND(${trip('s.partnerRate')}, 2) AS "carrierTrip"`,
        'c.status AS "claimStatus"',
        'i.status AS "invoiceStatus"',
        'adv.status AS "advanceStatus"',
        'bal.status AS "balanceStatus"',
        'l.updatedAt AS "updatedAt"',
      ])
      .addSelect(
        (sub) =>
          sub.select('MAX(h.enteredAt)').from(LoadStageHistoryEntity, 'h').where('h.loadId = l.id'),
        'lastStageAt',
      )
      .orderBy('l.updatedAt', 'DESC')
      .limit(cap);
    if (filter.status?.length) {
      query.andWhere('l.status IN (:...statuses)', { statuses: filter.status });
    }
    if (filter.tenantId) {
      query.andWhere('s.tenantId = :tenantId', { tenantId: filter.tenantId });
    }
    if (filter.q) {
      query.andWhere('(l.code ILIKE :q OR l.vehicleNumber ILIKE :q OR l.driverNumber ILIKE :q)', {
        q: `%${filter.q.replace(/[%_]/g, '')}%`,
      });
    }
    return query.getRawMany<AllLoadsRow>();
  }

  async shipperName(tenantId: string): Promise<string | null> {
    const org = await this.dataSource.getRepository(OrganizationEntity).findOne({
      where: { id: tenantId },
      select: { id: true, name: true },
    });
    return org?.name ?? null;
  }

  // --- Analytics (S02) -------------------------------------------------------------------------

  /** The headline tiles for loads posted in [from, to) — billed by invoice date. */
  async tiles(from: Date, to: Date): Promise<PeriodTiles> {
    const posted = (await this.sourcedLoads()
      .select('COUNT(*)::int', 'posted')
      .addSelect(
        "COUNT(*) FILTER (WHERE s.status = 'won' AND l.memoAcceptedAt IS NOT NULL)::int",
        'placed',
      )
      .addSelect(
        medianHours('l.createdAt', 'l.memoAcceptedAt', 'l.memoAcceptedAt IS NOT NULL'),
        'medianHoursToPlace',
      )
      .where('l.createdAt >= :from AND l.createdAt < :to', { from, to })
      .getRawOne<{ posted: number; placed: number; medianHoursToPlace: number | null }>())!;
    const billed = (await this.invoicedLoads()
      .select('COUNT(*)::int', 'billedCount')
      .addSelect('COALESCE(SUM(i.totalAmount), 0)::float', 'billedAmount')
      .addSelect(`COALESCE(SUM(${trip('l.freightValue')}), 0)::float`, 'shipperTrip')
      .addSelect(`COALESCE(SUM(${trip('s.partnerRate')}), 0)::float`, 'carrierTrip')
      .where('i.createdAt >= :from AND i.createdAt < :to', { from, to })
      .getRawOne<{
        billedCount: number;
        billedAmount: number;
        shipperTrip: number;
        carrierTrip: number;
      }>())!;
    const onTime = (await this.sourcedLoads()
      .innerJoin('l.posting', 'p')
      .select('COUNT(*)::int', 'deliveredWithPromise')
      .addSelect('COUNT(*) FILTER (WHERE l.deliveredAt <= p.deliverByAt)::int', 'deliveredOnTime')
      .where("s.status = 'won'")
      .andWhere('p.deliverByAt IS NOT NULL')
      .andWhere('l.deliveredAt >= :from AND l.deliveredAt < :to', { from, to })
      .getRawOne<{ deliveredWithPromise: number; deliveredOnTime: number }>())!;
    return {
      posted: posted.posted,
      placed: posted.placed,
      medianHoursToPlace:
        posted.medianHoursToPlace === null ? null : Number(posted.medianHoursToPlace),
      ...billed,
      ...onTime,
    };
  }

  /** Loads posted per IST day. */
  postedPerDay(from: Date, to: Date): Promise<{ day: string; posted: number }[]> {
    const day = "to_char(l.createdAt AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD')";
    return this.sourcedLoads()
      .select(day, 'day')
      .addSelect('COUNT(*)::int', 'posted')
      .where('l.createdAt >= :from AND l.createdAt < :to', { from, to })
      .groupBy(day)
      .orderBy(day)
      .getRawMany<{ day: string; posted: number }>();
  }

  /** How far the loads posted in the period got. */
  async funnel(from: Date, to: Date): Promise<Record<string, number>> {
    return (await this.sourcedLoads()
      .leftJoin(LsInvoiceEntity, 'i', 'i.loadId = l.id')
      .select('COUNT(*)::int', 'posted')
      .addSelect('COUNT(*) FILTER (WHERE s.bidSentAt IS NOT NULL)::int', 'priceSent')
      .addSelect("COUNT(*) FILTER (WHERE s.status = 'won')::int", 'won')
      .addSelect('COUNT(*) FILTER (WHERE l.memoAcceptedAt IS NOT NULL)::int', 'memoAccepted')
      .addSelect('COUNT(*) FILTER (WHERE l.loadingConfirmedAt IS NOT NULL)::int', 'loaded')
      .addSelect('COUNT(*) FILTER (WHERE l.deliveredAt IS NOT NULL)::int', 'delivered')
      .addSelect('COUNT(i.id)::int', 'invoiced')
      .addSelect("COUNT(*) FILTER (WHERE l.status = 'closed')::int", 'closed')
      .where('l.createdAt >= :from AND l.createdAt < :to', { from, to })
      .getRawOne<Record<string, number>>())!;
  }

  /** Median hours of each team's step, for steps that finished in the period. */
  async stepMedians(from: Date, to: Date): Promise<Record<string, number | null>> {
    const query = this.sourcedLoads();
    // When the load last reached the loading point, and when its first POD image came in.
    const reachedLoadingAt = `(${query
      .subQuery()
      .select('h.enteredAt')
      .from(LoadStageHistoryEntity, 'h')
      .where('h.loadId = l.id')
      .andWhere("h.stage = 'reached_loading'")
      .orderBy('h.enteredAt', 'DESC')
      .limit(1)
      .getQuery()})`;
    const podImageAt = `(${query
      .subQuery()
      .select('d.createdAt')
      .from(LoadDocumentEntity, 'd')
      .where('d.loadId = l.id')
      .andWhere("d.docType = 'pod_front'")
      .orderBy('d.version', 'ASC')
      .limit(1)
      .getQuery()})`;
    const median = (start: string, end: string) =>
      medianHours(start, end, `${start} IS NOT NULL AND ${end} >= :from AND ${end} < :to`);
    const row = (await query
      .leftJoin(LoadBidEntity, 'b', 'b.id = l.awardedBidId')
      .leftJoin(LsInvoiceEntity, 'i', 'i.loadId = l.id')
      .leftJoin(
        LsPartnerPaymentEntity,
        'adv',
        "adv.sourcingId = s.id AND adv.paymentType = 'advance' AND adv.status = 'paid'",
      )
      .leftJoin(LsOriginalPodEntity, 'op', 'op.loadId = l.id')
      .select(median('l.createdAt', 'b.decidedAt'), 'postedToPriceHeld')
      .addSelect(median('b.decidedAt', 'l.memoAcceptedAt'), 'priceHeldToMemoAccepted')
      .addSelect(median(reachedLoadingAt, 'l.lsPapersApprovedAt'), 'papersToApproved')
      .addSelect(median(podImageAt, 'i.createdAt'), 'podImageToInvoice')
      .addSelect(median('l.loadingConfirmedAt', 'adv.paidAt'), 'loadingToAdvancePaid')
      .addSelect(median('l.deliveredAt', 'op.filedAt'), 'deliveryToOriginalPodFiled')
      .where("s.status = 'won'")
      .setParameters({ from, to })
      .getRawOne<Record<string, string | null>>())!;
    return Object.fromEntries(Object.entries(row).map(([key, value]) => [key, round1(value)]));
  }

  /** Median hours a Loadsmart load spends at each stage (stage-history rows that closed in the
   *  period). */
  async stageMedians(
    from: Date,
    to: Date,
  ): Promise<{ stage: LoadStatus; medianHours: number; loads: number }[]> {
    const rows = await this.dataSource
      .getRepository(LoadStageHistoryEntity)
      .createQueryBuilder('h')
      .select('h.stage', 'stage')
      .addSelect(medianHours('h.enteredAt', 'h.exitedAt'), 'medianHours')
      .addSelect('COUNT(*)::int', 'loads')
      .where("h.route = 'loadsmart'")
      .andWhere('h.exitedAt >= :from AND h.exitedAt < :to', { from, to })
      .groupBy('h.stage')
      .getRawMany<{ stage: LoadStatus; medianHours: string; loads: number }>();
    return rows.map((row) => ({ ...row, medianHours: round1(row.medianHours) ?? 0 }));
  }

  /** Margin by lane for loads billed in the period. */
  marginByLane(from: Date, to: Date) {
    const fromCity = "p.pickupAddress ->> 'city'";
    const toCity = "p.dropAddress ->> 'city'";
    return this.invoicedLoads()
      .leftJoin('l.posting', 'p')
      .select(fromCity, 'fromCity')
      .addSelect(toCity, 'toCity')
      .addSelect('COUNT(*)::int', 'loads')
      .addSelect(`ROUND(SUM(${trip('l.freightValue')}), 2)::float`, 'shipperTrip')
      .addSelect(`ROUND(SUM(${trip('s.partnerRate')}), 2)::float`, 'carrierTrip')
      .where('i.createdAt >= :from AND i.createdAt < :to', { from, to })
      .groupBy(fromCity)
      .addGroupBy(toCity)
      .orderBy('COUNT(*)', 'DESC')
      .limit(50)
      .getRawMany<{
        fromCity: string | null;
        toCity: string | null;
        loads: number;
        shipperTrip: number;
        carrierTrip: number;
      }>();
  }

  /** Open invoices (for the ageing view) and collection speed. */
  async moneyPosition(from: Date, to: Date) {
    const invoices = this.dataSource.getRepository(LsInvoiceEntity);
    const open = await invoices
      .createQueryBuilder('i')
      .select("to_char(i.dueDate, 'YYYY-MM-DD')", 'dueDate')
      .addSelect('COALESCE(i.openAmount, i.balanceDue)::float', 'amount')
      .where('i.status IN (:...statuses)', { statuses: ['issued', 'partly_paid'] })
      .getRawMany<{ dueDate: string | null; amount: number }>();
    const collect = await invoices
      .createQueryBuilder('i')
      .select(medianDays('CAST(i.receivedOn AS timestamptz)', 'i.settledAt'), 'medianDaysToCollect')
      .where('i.settledAt >= :from AND i.settledAt < :to', { from, to })
      .andWhere('i.receivedOn IS NOT NULL')
      .getRawOne<{ medianDaysToCollect: string | null }>();
    const paid = await this.dataSource
      .getRepository(LsPartnerPaymentEntity)
      .createQueryBuilder('pp')
      .select('pp.paymentType', 'paymentType')
      .addSelect('COALESCE(SUM(pp.netAmount), 0)::float', 'amount')
      .where("pp.status = 'paid'")
      .andWhere('pp.paidAt >= :from AND pp.paidAt < :to', { from, to })
      .groupBy('pp.paymentType')
      .getRawMany<{ paymentType: string; amount: number }>();
    return {
      open,
      medianDaysToCollect: round1(collect?.medianDaysToCollect),
      paidToCarriers: Object.fromEntries(paid.map((row) => [row.paymentType, row.amount])),
    };
  }

  /** Top shippers by loads posted in the period. */
  topShippers(from: Date, to: Date) {
    return this.sourcedLoads()
      .leftJoin(OrganizationEntity, 'o', 'o.id = s.tenantId')
      .leftJoin(LsInvoiceEntity, 'i', 'i.loadId = l.id')
      .select('s.tenantId', 'tenantId')
      .addSelect('o.name', 'shipperName')
      .addSelect('COUNT(*)::int', 'posted')
      .addSelect('COUNT(*) FILTER (WHERE l.memoAcceptedAt IS NOT NULL)::int', 'placed')
      .addSelect('COALESCE(SUM(i.totalAmount), 0)::float', 'billed')
      .addSelect(
        `COALESCE(SUM(${trip('l.freightValue')}) FILTER (WHERE i.id IS NOT NULL), 0)::float`,
        'shipperTrip',
      )
      .addSelect(
        `COALESCE(SUM(${trip('s.partnerRate')}) FILTER (WHERE i.id IS NOT NULL), 0)::float`,
        'carrierTrip',
      )
      .addSelect(
        medianDays(
          'CAST(i.receivedOn AS timestamptz)',
          'i.settledAt',
          'i.settledAt IS NOT NULL AND i.receivedOn IS NOT NULL',
        ),
        'medianDaysToPay',
      )
      .where('l.createdAt >= :from AND l.createdAt < :to', { from, to })
      .groupBy('s.tenantId')
      .addGroupBy('o.name')
      .orderBy('COUNT(*)', 'DESC')
      .limit(10)
      .getRawMany<{
        tenantId: string;
        shipperName: string | null;
        posted: number;
        placed: number;
        billed: number;
        shipperTrip: number;
        carrierTrip: number;
        medianDaysToPay: string | null;
      }>();
  }
}
