import { InternalError, rethrow } from '../../shared/errors';
import { toDateString } from '../../shared/utils/date';
import { DateFilter, enumerateIstDates, resolveDateRange } from '../../shared/utils/date-filter';
import { AuthenticatedUser } from '../../shared/middleware/request.types';
import { hasPermission } from '../../shared/middleware/require-permission.middleware';
import { CUSTOMERS_APPROVE, MASTERS_APPROVE } from '../../shared/constants/permissions';
import { VehicleService } from '../masters/vehicle/vehicle.service';
import { DriverService } from '../driver/driver.service';
import { CustomerService } from '../customers/customer.service';
import { shipperActionFor, ShipperActionKind } from '../loads/utils/shipper-action';
import { freightTotalOf, moneySummary } from '../loads/money/money-rules';
import { DashboardsRepository } from './dashboards.repository';
import { DEFAULT_RANGE_DAYS, LOAD_PIPELINE_STAGES } from './dashboards.constants';
import {
  FleetActivityDateRange,
  FleetActivityMetrics,
  FleetActivityRangeInput,
  FleetActivitySummary,
  ListPendingApprovalsResult,
  LoadPipelineRaw,
  LoadsSummary,
  LoadsSummaryRangeInput,
  PendingApprovalItem,
  WAITING_ON_YOU_KEYS,
  WaitingOnYou,
  WaitingOnYouKey,
  WhereEveryLoadIs,
} from './utils/dashboards.interface';

/** Which "Waiting on you" card each shipper next-action lands in. 'none' is in no card. */
const WAITING_ON_YOU_BUCKET: Record<Exclude<ShipperActionKind, 'none'>, WaitingOnYouKey> = {
  pick_bid: 'bids_to_confirm',
  record_advance: 'advance_to_release',
  record_balance: 'balance_to_release',
  approve_charges: 'charges_to_approve',
  accept_memo: 'memos_to_confirm',
  send_invoice: 'everything_else',
  loading_papers: 'everything_else',
  upload_pod: 'everything_else',
  review_pod: 'everything_else',
  settle_issue: 'everything_else',
  upload_transporter_invoice: 'everything_else',
  pay_invoice: 'everything_else',
};

const round2 = (value: number) => Math.round(value * 100) / 100;

/** Sibling default to DEFAULT_RANGE_DAYS above, expressed as a DateFilter preset for the
 *  loads-summary endpoint (which uses the shared date-filter.ts range presets rather than plain
 *  from/to) — same "Last 15 days" default tab the frontend selects when the caller omits a range. */
const DEFAULT_LOADS_SUMMARY_FILTER: DateFilter = 'last15days';

// Cap per type, not a real cross-type paginator — approval queues are small in practice, and
// correctly merging three independently-paginated lists into one ordered page is a lot of
// machinery for a queue this size. Revisit if that assumption stops holding.
const MAX_PENDING_PER_TYPE = 100;

/**
 * Composes read models directly via each module's index.ts — no owned schema, no gateways.
 * Only masters (vehicle operational status) has real data to read today; tracking, maintenance,
 * and payments are still schema-less stubs, so their stats stay `null` on FleetActivitySummary
 * until those modules gain dated distance/cost/earning records to aggregate over a range.
 */
export class DashboardsService {
  constructor(
    private readonly dashboardsRepository: DashboardsRepository,
    private readonly vehicleService: VehicleService,
    private readonly driverService: DriverService,
    private readonly customerService: CustomerService,
  ) {}

  async getFleetActivity(
    tenantId: string,
    input: FleetActivityRangeInput,
  ): Promise<FleetActivitySummary> {
    try {
      const range = this.resolveRange(input);
      const metrics = await this.getFleetActivityMetrics(tenantId);
      return { range, ...metrics };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet activity');
    }
  }

  /** Home screen: trip counts + three zero-filled per-day series (loads, tonnes shipped, freight
   *  spend), all scoped to the same [from, to] IST-calendar-day range and unfiltered by status.
   *  `filter` defaults to 'last15days' when the caller omits it entirely. */
  async getLoadsSummary(tenantId: string, input: LoadsSummaryRangeInput): Promise<LoadsSummary> {
    try {
      const filter = input.filter ?? DEFAULT_LOADS_SUMMARY_FILTER;
      const range = resolveDateRange(filter, input.from, input.to);
      if (!range) {
        // Unreachable given dashboards.validators.ts's superRefine (custom always has from/to,
        // from <= to) and `filter` always being a real DateFilter by this point — kept only as a
        // defensive guard against resolveDateRange/the validator drifting apart later.
        throw new InternalError('Failed to resolve loads-summary date range', { filter, input });
      }

      const [tripCounts, dailyRows, fleetActivity, pipeline] = await Promise.all([
        this.dashboardsRepository.getTripCounts(tenantId, range),
        this.dashboardsRepository.getDailyAggregates(tenantId, range),
        this.getFleetActivityMetrics(tenantId),
        this.dashboardsRepository.getLoadPipeline(tenantId),
      ]);

      const days = enumerateIstDates(range);
      const byDate = new Map(dailyRows.map((row) => [row.date, row]));

      const loadsPerDay: LoadsSummary['loadsPerDay'] = [];
      const tonnesShippedPerDay: LoadsSummary['tonnesShippedPerDay'] = [];
      const freightSpendPerDay: LoadsSummary['freightSpendPerDay'] = [];
      let tonnesShippedTotal = 0;
      let freightSpendTotal = 0;

      for (const date of days) {
        const row = byDate.get(date);
        loadsPerDay.push({ date, count: row?.count ?? 0 });
        tonnesShippedPerDay.push({ date, tonnes: row?.tonnes ?? 0 });
        freightSpendPerDay.push({ date, amount: row?.freightAmount ?? 0 });
        tonnesShippedTotal += row?.tonnes ?? 0;
        freightSpendTotal += row?.freightAmount ?? 0;
      }

      return {
        // days[0]/days[days.length - 1] are already the exact IST date labels the series cover —
        // reusing them here instead of re-deriving from range.from/range.to keeps the echoed
        // range and the series' actual date coverage impossible to drift apart.
        range: { filter, from: days[0], to: days[days.length - 1] },
        tripCounts,
        loadsPerDay,
        tonnesShippedPerDay,
        tonnesShippedTotal,
        freightSpendPerDay,
        freightSpendTotal,
        fleetActivity,
        whereEveryLoadIs: this.buildWhereEveryLoadIs(pipeline),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch loads summary');
    }
  }

  private buildWhereEveryLoadIs(pipeline: LoadPipelineRaw): WhereEveryLoadIs {
    const stages = LOAD_PIPELINE_STAGES.map((stage) => ({
      key: stage.key,
      label: stage.label,
      count: stage.statuses.reduce(
        (sum, status) => sum + (pipeline.countsByStatus[status] ?? 0),
        0,
      ),
      percent: 0,
    }));
    const openLoads = stages.reduce((sum, stage) => sum + stage.count, 0);
    for (const stage of stages) {
      stage.percent = openLoads === 0 ? 0 : Math.round((stage.count / openLoads) * 100);
    }
    return {
      stages,
      openLoads,
      customerOrdersShortOfTrucks: pipeline.customerOrdersShortOfTrucks,
      openOnMarketFleet: pipeline.openOnMarketFleet,
      tonnesInPlay: Math.round(pipeline.tonnesInPlay * 100) / 100,
    };
  }

  /** Home "Waiting on you" — each open load's shipper next-action (the same rule GET
   *  /loads/:id/next-action runs), computed for every open load from batched reads and bucketed
   *  into the six cards. See WaitingOnYou for what each card's amount sums. */
  async getWaitingOnYou(tenantId: string): Promise<WaitingOnYou> {
    try {
      const raw = await this.dashboardsRepository.getWaitingOnYouRaw(tenantId);
      const now = new Date();
      const buckets = new Map(
        WAITING_ON_YOU_KEYS.map((key) => [
          key,
          { key, count: 0, loads: 0, amount: 0, loadIds: [] as string[] },
        ]),
      );

      for (const load of raw.loads) {
        const payments = raw.payments.get(load.id) ?? [];
        const memo = raw.latestMemo.get(load.id);
        const action = shipperActionFor({
          ...load,
          pendingCharges: raw.raisedCharges.get(load.id) ?? { count: 0, total: 0 },
          invoiceOpen: load.route === 'loadsmart' ? (raw.invoiceOpen.get(load.id) ?? null) : null,
          paymentPendingMatch: payments.some(
            (payment) =>
              payment.paymentType === 'balance' && payment.verificationStatus === 'pending',
          ),
          // Same as loads/index.ts's memo reader: the latest memo is out and not yet expired.
          memoWaiting: !!memo && memo.status === 'sent' && memo.expiresAt > now,
        });
        if (action.kind === 'none') continue;

        const bucket = buckets.get(WAITING_ON_YOU_BUCKET[action.kind])!;
        bucket.loads += 1;
        bucket.loadIds.push(load.id);
        const freightTotal = freightTotalOf(load) ?? 0;

        switch (action.kind) {
          case 'pick_bid':
            bucket.count += 1;
            {
              // The rate is in the load's freight basis — × planned tonnes when per tonne.
              const rate = raw.lowestBid.get(load.id);
              bucket.amount += rate ? (freightTotalOf({ ...load, freightValue: rate }) ?? 0) : 0;
            }
            break;
          case 'record_advance':
            bucket.count += 1;
            bucket.amount += (freightTotal * Number(load.advancePercentage ?? 0)) / 100;
            break;
          case 'record_balance':
            bucket.count += 1;
            bucket.amount += moneySummary(
              load,
              payments,
              raw.charges.get(load.id) ?? [],
            ).balanceDue;
            break;
          case 'approve_charges':
            bucket.count += action.count ?? 0;
            bucket.amount += action.amount ?? 0;
            break;
          case 'accept_memo':
            bucket.count += 1;
            break;
          default:
            bucket.count += 1;
            bucket.amount += action.kind === 'pay_invoice' ? (action.amount ?? 0) : freightTotal;
        }
      }

      const result = [...buckets.values()].map(({ loadIds, ...bucket }) => ({
        ...bucket,
        amount: bucket.key === 'memos_to_confirm' ? null : round2(bucket.amount),
        singleLoadId: loadIds.length === 1 ? loadIds[0] : null,
      }));
      return {
        buckets: result,
        totalLoads: result.reduce((sum, bucket) => sum + bucket.loads, 0),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch waiting-on-you');
    }
  }

  /** Settings → Approvals — every pending customer/vehicle/driver for the tenant, in one list. */
  async listPendingApprovals(
    tenantId: string,
    actingUser: AuthenticatedUser,
  ): Promise<ListPendingApprovalsResult> {
    try {
      const canApproveMasters = hasPermission(actingUser, MASTERS_APPROVE);
      const [customers, vehicles, drivers] = await Promise.all([
        // The route admits CUSTOMERS_APPROVE or MASTERS_APPROVE — each type is only listed to a
        // caller who can act on it.
        hasPermission(actingUser, CUSTOMERS_APPROVE)
          ? this.customerService.list(tenantId, {
              page: 1,
              limit: MAX_PENDING_PER_TYPE,
              status: 'pending',
            })
          : null,
        canApproveMasters
          ? this.vehicleService.listVehicles(tenantId, {
              page: 1,
              limit: MAX_PENDING_PER_TYPE,
              status: 'pending',
            })
          : null,
        canApproveMasters
          ? this.driverService.listDrivers(tenantId, {
              page: 1,
              limit: MAX_PENDING_PER_TYPE,
              status: 'pending_staff_review',
            })
          : null,
      ]);

      const items: PendingApprovalItem[] = [
        ...(customers?.items ?? []).map((customer) => ({
          type: 'customer' as const,
          id: customer.id,
          label: customer.name,
          requestedBy: customer.createdBy,
          requestedAt: customer.createdAt,
        })),
        ...(vehicles?.items ?? []).map((vehicle) => ({
          type: 'vehicle' as const,
          id: vehicle.id,
          label: vehicle.registrationNumber,
          requestedBy: vehicle.createdBy,
          requestedAt: vehicle.createdAt,
        })),
        ...(drivers?.items ?? []).map((driver) => ({
          type: 'driver' as const,
          id: driver.id,
          label: driver.fullName,
          requestedBy: driver.createdBy,
          requestedAt: driver.createdAt,
        })),
      ];

      items.sort((a, b) => b.requestedAt.getTime() - a.requestedAt.getTime());

      return { items, total: items.length };
    } catch (error) {
      rethrow(error, 'Failed to list pending approvals');
    }
  }

  /** Live vehicle operational-status snapshot, shared by getFleetActivity and getLoadsSummary —
   *  not date-scoped (see FleetOperationalBreakdown), so it's safe to reuse verbatim for both. */
  private async getFleetActivityMetrics(tenantId: string): Promise<FleetActivityMetrics> {
    // Reuses vehicleService.listVehicles' existing tenant-scoping/soft-delete filtering rather
    // than adding a parallel counting query — `limit: 1` keeps each call cheap while `.total`
    // (from the underlying findAndCount) still reflects the full matching count.
    const [all, onTrip, idle, warnOnAssign, inactive, activeTrips] = await Promise.all([
      this.vehicleService.listVehicles(tenantId, { page: 1, limit: 1 }),
      this.vehicleService.listVehicles(tenantId, {
        page: 1,
        limit: 1,
        operationalStatus: 'on_trip',
      }),
      this.vehicleService.listVehicles(tenantId, { page: 1, limit: 1, operationalStatus: 'idle' }),
      this.vehicleService.listVehicles(tenantId, {
        page: 1,
        limit: 1,
        operationalStatus: 'warn_on_assign',
      }),
      this.vehicleService.listVehicles(tenantId, {
        page: 1,
        limit: 1,
        operationalStatus: 'inactive',
      }),
      this.dashboardsRepository.countActiveTripsWithVehicle(tenantId),
    ]);

    return {
      fleetSize: all.total,
      trucksRunningNow: onTrip.total,
      activeTrips,
      operationalBreakdown: {
        onTrip: onTrip.total,
        idle: idle.total,
        warnOnAssign: warnOnAssign.total,
        inactive: inactive.total,
      },
      kmCovered: null,
      maintenanceCost: null,
      fleetPnl: null,
    };
  }

  /** Defaults to the last DEFAULT_RANGE_DAYS days (inclusive of today) when the caller omits a range. */
  private resolveRange(input: FleetActivityRangeInput): FleetActivityDateRange {
    if (input.from && input.to) return { from: input.from, to: input.to };

    const to = new Date();
    const from = new Date(to);
    from.setDate(from.getDate() - (DEFAULT_RANGE_DAYS - 1));

    return { from: input.from ?? toDateString(from), to: input.to ?? toDateString(to) };
  }
}
