import { DataSource, SelectQueryBuilder } from 'typeorm';
import { DateRange } from '../../shared/utils/date-filter';
import { LoadEntity } from '../loads/entities/load.entity';
import {
  ACTIVE_LOAD_STATUSES,
  COMPLETED_LOAD_STATUSES,
  LoadStatus,
} from '../loads/utils/loads.types';
import { RequisitionEntity } from '../loads/entities/requisition.entity';
import { LoadBidEntity } from '../loads/bids/load-bid.entity';
import { LoadChargeEntity } from '../loads/money/load-charge.entity';
import { LoadMemoEntity } from '../loads/memo/load-memo.entity';
import { LoadPaymentEntity } from '../loads/entities/load-payment.entity';
import { LsInvoiceEntity } from '../loadsmart-ops/entities/ls-invoice.entity';
import {
  LoadPipelineRaw,
  LoadsSummaryDailyRow,
  LoadsSummaryTripCounts,
  WaitingOnYouLoadRow,
  WaitingOnYouRaw,
} from './utils/dashboards.interface';

/** Groups rows into a Map of arrays by `key`. */
function groupRows<T, V>(rows: T[], key: (row: T) => string, value: (row: T) => V) {
  const map = new Map<string, V[]>();
  for (const row of rows) {
    const list = map.get(key(row));
    if (list) list.push(value(row));
    else map.set(key(row), [value(row)]);
  }
  return map;
}

// Groups load.created_at into its IST (Asia/Kolkata) calendar day, not the UTC day. `AT TIME
// ZONE 'Asia/Kolkata'` on a timestamptz produces a plain (zone-less) timestamp already expressed
// in IST wall-clock time, so the subsequent `::date` cast is a pure truncation — unlike casting a
// timestamptz straight to `date`, it does NOT depend on the DB session's `TimeZone` GUC (this
// project's DataSource, db/data-source.ts, sets no `timezone` option). Declared once and reused
// in both the SELECT and GROUP BY below so they can't drift textually (Postgres requires the
// grouped expression to match exactly).
const IST_DAY_EXPR = `(load.created_at AT TIME ZONE 'Asia/Kolkata')::date`;

function applyTenantAndRange(
  query: SelectQueryBuilder<LoadEntity>,
  tenantId: string,
  range: DateRange,
): SelectQueryBuilder<LoadEntity> {
  return query
    .where('load.tenant_id = :tenantId', { tenantId })
    .andWhere('load.created_at >= :from', { from: range.from })
    .andWhere('load.created_at <= :to', { to: range.to });
}

/**
 * Reads LoadEntity directly via the DataSource, same as ShipperAnalyticsRepository/
 * FleetAnalyticsRepository/DriverAnalyticsRepository — a reporting concern, not a business-logic
 * dependency, so it bypasses LoadRepository/LoadService. Backs the Home screen's loads-summary
 * endpoint (dashboards.service.ts's getLoadsSummary).
 */
export class DashboardsRepository {
  private readonly loads;
  private readonly requisitions;
  private readonly bids;
  private readonly charges;
  private readonly memos;
  private readonly payments;
  private readonly invoices;

  constructor(dataSource: DataSource) {
    this.loads = dataSource.getRepository(LoadEntity);
    this.requisitions = dataSource.getRepository(RequisitionEntity);
    this.bids = dataSource.getRepository(LoadBidEntity);
    this.charges = dataSource.getRepository(LoadChargeEntity);
    this.memos = dataSource.getRepository(LoadMemoEntity);
    this.payments = dataSource.getRepository(LoadPaymentEntity);
    this.invoices = dataSource.getRepository(LsInvoiceEntity);
  }

  /** Home "Waiting on you" — every open (not closed or cancelled) load with the fields the
   *  shipper next-action rule and the money rules read, plus each load's charges, payments,
   *  latest memo, Loadsmart invoice and lowest received bid. Seven queries in all, however many
   *  loads are open — never one per load. Side tables are scoped through an inner join on the
   *  open loads so a closed load's rows are never read. */
  async getWaitingOnYouRaw(tenantId: string): Promise<WaitingOnYouRaw> {
    const openStatuses: readonly string[] = ACTIVE_LOAD_STATUSES;
    const params = { tenantId, openStatuses };
    const OPEN_JOIN = 'load.tenant_id = :tenantId AND load.status IN (:...openStatuses)';

    const [loads, chargeRows, paymentRows, memoRows, invoiceRows, bidRows] = await Promise.all([
      this.loads
        .createQueryBuilder('load')
        .select([
          'load.id',
          'load.status',
          'load.route',
          'load.awardedParty',
          'load.awardedBidId',
          'load.memoAcceptedAt',
          'load.invoiceNumber',
          'load.invoiceFileKey',
          'load.ewayBillNumber',
          'load.ewayBillFileKey',
          'load.elrFileKey',
          'load.podFileKey',
          'load.podBackFileKey',
          'load.podStatus',
          'load.transporterInvoiceFileKey',
          'load.advancePercentage',
          'load.advancePaidAt',
          'load.balancePaidAt',
          'load.deliveryIssueSettledAt',
          'load.freightType',
          'load.freightValue',
          'load.plannedCapacityTonnes',
          'load.deliveryIssueDeductionAmount',
        ])
        .where(OPEN_JOIN, params)
        .getMany(),
      this.charges
        .createQueryBuilder('charge')
        .innerJoin(LoadEntity, 'load', `load.id = charge.load_id AND ${OPEN_JOIN}`, params)
        .select('charge.load_id', 'loadId')
        .addSelect('charge.charge_type', 'chargeType')
        .addSelect('charge.amount', 'amount')
        .addSelect('charge.status', 'status')
        .where('charge.tenant_id = :tenantId', { tenantId })
        .getRawMany<{ loadId: string; chargeType: string; amount: string; status: string }>(),
      this.payments
        .createQueryBuilder('payment')
        .innerJoin(LoadEntity, 'load', `load.id = payment.load_id AND ${OPEN_JOIN}`, params)
        .select('payment.load_id', 'loadId')
        .addSelect('payment.payment_type', 'paymentType')
        .addSelect('payment.amount', 'amount')
        .addSelect('payment.verification_status', 'verificationStatus')
        .where('payment.tenant_id = :tenantId', { tenantId })
        .getRawMany<{
          loadId: string;
          paymentType: 'advance' | 'balance';
          amount: string;
          verificationStatus: string | null;
        }>(),
      // The latest version per load — DISTINCT ON keeps the first row of each load_id group.
      this.memos
        .createQueryBuilder('memo')
        .innerJoin(LoadEntity, 'load', `load.id = memo.load_id AND ${OPEN_JOIN}`, params)
        .distinctOn(['memo.load_id'])
        .select('memo.load_id', 'loadId')
        .addSelect('memo.status', 'status')
        .addSelect('memo.expires_at', 'expiresAt')
        .where('memo.tenant_id = :tenantId', { tenantId })
        .orderBy('memo.load_id')
        .addOrderBy('memo.version', 'DESC')
        .getRawMany<{ loadId: string; status: string; expiresAt: Date }>(),
      this.invoices
        .createQueryBuilder('invoice')
        .innerJoin(LoadEntity, 'load', `load.id = invoice.load_id AND ${OPEN_JOIN}`, params)
        .select('invoice.load_id', 'loadId')
        .addSelect('COALESCE(invoice.open_amount, invoice.balance_due)', 'open')
        .where('invoice.tenant_id = :tenantId', { tenantId })
        .getRawMany<{ loadId: string; open: string }>(),
      this.bids
        .createQueryBuilder('bid')
        .innerJoin(LoadEntity, 'load', `load.id = bid.load_id AND ${OPEN_JOIN}`, params)
        .select('bid.load_id', 'loadId')
        .addSelect('MIN(bid.rate)', 'lowest')
        .where('bid.tenant_id = :tenantId', { tenantId })
        .andWhere("bid.status = 'received'")
        .groupBy('bid.load_id')
        .getRawMany<{ loadId: string; lowest: string }>(),
    ]);

    const raisedCharges = new Map<string, { count: number; total: number }>();
    for (const row of chargeRows) {
      if (row.status !== 'raised' && row.status !== 'queried') continue;
      const entry = raisedCharges.get(row.loadId) ?? { count: 0, total: 0 };
      entry.count += 1;
      entry.total += Number(row.amount);
      raisedCharges.set(row.loadId, entry);
    }

    return {
      loads: loads as WaitingOnYouLoadRow[],
      raisedCharges,
      charges: groupRows(
        chargeRows,
        (row) => row.loadId,
        ({ chargeType, amount, status }) => ({ chargeType, amount, status }),
      ),
      payments: groupRows(
        paymentRows,
        (row) => row.loadId,
        ({ paymentType, amount, verificationStatus }) => ({
          paymentType,
          amount,
          verificationStatus,
        }),
      ),
      latestMemo: new Map(
        memoRows.map((row) => [
          row.loadId,
          { status: row.status, expiresAt: new Date(row.expiresAt) },
        ]),
      ),
      invoiceOpen: new Map(invoiceRows.map((row) => [row.loadId, Number(row.open)])),
      lowestBid: new Map(bidRows.map((row) => [row.loadId, row.lowest])),
    };
  }

  /** Home "Where every load is" — live counts for every open (non-closed) load by status, plus
   *  the tiles beneath the bar. Not date-scoped. */
  async getLoadPipeline(tenantId: string): Promise<LoadPipelineRaw> {
    const openStatuses: readonly string[] = ACTIVE_LOAD_STATUSES;

    const openLoads = () =>
      this.loads
        .createQueryBuilder('load')
        .where('load.tenant_id = :tenantId', { tenantId })
        .andWhere('load.status IN (:...openStatuses)', { openStatuses });

    const [statusRows, tonnesRow, openOnMarketFleet, customerOrdersShortOfTrucks] =
      await Promise.all([
        openLoads()
          .select('load.status', 'status')
          .addSelect('COUNT(*)', 'count')
          .groupBy('load.status')
          .getRawMany<{ status: string; count: string }>(),
        openLoads()
          .select('COALESCE(SUM(load.planned_capacity_tonnes), 0)', 'tonnes')
          .getRawOne<{ tonnes: string }>(),
        openLoads()
          .andWhere("load.posting_type = 'market_fleet'")
          .andWhere("(load.route IS NULL OR load.route <> 'loadsmart')")
          .getCount(),
        this.requisitions
          .createQueryBuilder('req')
          .where('req.tenant_id = :tenantId', { tenantId })
          .andWhere('req.status = :status', { status: 'open' })
          .andWhere('req.dispatched_tonnes < req.quantity_tonnes')
          .getCount(),
      ]);

    const countsByStatus: Record<string, number> = {};
    for (const row of statusRows) countsByStatus[row.status] = Number(row.count);

    return {
      countsByStatus,
      customerOrdersShortOfTrucks,
      openOnMarketFleet,
      tonnesInPlay: Number(tonnesRow?.tonnes ?? 0),
    };
  }

  /** Home screen trip counts — {all, active, completed} for every load in `range` regardless of
   *  status. Mirrors LoadRepository.countByGroup: one GROUP BY load.status query, reduced in JS
   *  using COMPLETED_LOAD_STATUSES (anything not "completed" counts as "active" —
   *  LOAD_STATUS_GROUPS is an exhaustive 2-way partition, see loads.types.ts), so `all` is always
   *  `active + completed` by construction. */
  async getTripCounts(tenantId: string, range: DateRange): Promise<LoadsSummaryTripCounts> {
    const query = this.loads
      .createQueryBuilder('load')
      .select('load.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .groupBy('load.status');
    const rows = await applyTenantAndRange(query, tenantId, range).getRawMany<{
      status: LoadStatus;
      count: string;
    }>();

    const completedStatuses: readonly string[] = COMPLETED_LOAD_STATUSES;
    return rows.reduce<LoadsSummaryTripCounts>(
      (acc, row) => {
        const count = Number(row.count);
        acc.all += count;
        if (completedStatuses.includes(row.status)) acc.completed += count;
        else acc.active += count;
        return acc;
      },
      { all: 0, active: 0, completed: 0 },
    );
  }

  /** One row per IST calendar day that has >=1 load in `range` — sparse (no zero-fill; that's
   *  dashboards.service.ts's job) and unfiltered by status, same scope as getTripCounts. Backs
   *  all three Home-screen charts (loads/day, tonnes/day, freight/day) from a single GROUP BY
   *  query rather than three round trips. */
  async getDailyAggregates(tenantId: string, range: DateRange): Promise<LoadsSummaryDailyRow[]> {
    const query = this.loads
      .createQueryBuilder('load')
      .select(IST_DAY_EXPR, 'day')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(load.planned_capacity_tonnes), 0)', 'tonnes')
      .addSelect('COALESCE(SUM(load.freight_value), 0)', 'freightAmount')
      .groupBy(IST_DAY_EXPR)
      .orderBy('day', 'ASC');
    const rows = await applyTenantAndRange(query, tenantId, range).getRawMany<{
      day: Date;
      count: string;
      tonnes: string;
      freightAmount: string;
    }>();

    // `day` comes back from node-postgres's default `date` text parser as a JS Date anchored at
    // UTC midnight for that calendar date. `.toISOString().slice(0, 10)` is therefore safe and
    // gives back the exact 'YYYY-MM-DD' Postgres computed, regardless of the Node process's own
    // timezone — unlike resolveDateRange's from/to (IST-instant boundaries, not yet collapsed to
    // a calendar date), which must go through ist-time.ts's toIstDateString instead, never this.
    return rows.map((row) => ({
      date: row.day.toISOString().slice(0, 10),
      count: Number(row.count),
      tonnes: Number(row.tonnes),
      freightAmount: Number(row.freightAmount),
    }));
  }

  /** Live count (not scoped to any date range, same as fleet-activity's operationalBreakdown) of
   *  loads currently in an active (non-completed) status with a vehicle assigned — i.e. trips a
   *  fleet vehicle is actually out running right now. */
  async countActiveTripsWithVehicle(tenantId: string): Promise<number> {
    const activeStatuses: readonly string[] = ACTIVE_LOAD_STATUSES;
    return this.loads
      .createQueryBuilder('load')
      .where('load.tenant_id = :tenantId', { tenantId })
      .andWhere('load.status IN (:...activeStatuses)', { activeStatuses })
      .andWhere('load.vehicle_id IS NOT NULL')
      .getCount();
  }
}
