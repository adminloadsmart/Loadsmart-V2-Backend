import { InternalError, rethrow } from '../../shared/errors';
import { toDateString } from '../../shared/utils/date';
import { DateFilter, enumerateIstDates, resolveDateRange } from '../../shared/utils/date-filter';
import { AuthenticatedUser } from '../../shared/middleware/request.types';
import { VehicleService } from '../masters/vehicle/vehicle.service';
import { DriverService } from '../driver/driver.service';
import { CustomerService } from '../customers/customer.service';
import { DashboardsRepository } from './dashboards.repository';
import { DEFAULT_RANGE_DAYS } from './dashboards.constants';
import { LoadStatus } from '../loads/utils/loads.types';
import {
  FleetActivityDateRange,
  FleetActivityMetrics,
  FleetActivityRangeInput,
  FleetActivitySummary,
  ListPendingApprovalsResult,
  LoadPipelineKpi,
  LoadPipelineSegment,
  LoadPipelineSummary,
  LoadPipelineTone,
  LoadsSummary,
  LoadsSummaryRangeInput,
  PendingApprovalItem,
} from './utils/dashboards.interface';

/** The funnel's 4 buckets, in display order — together an exhaustive, non-overlapping partition
 *  of every open (non-closed) LoadStatus (loads/utils/loads.types.ts's OPEN_LOAD_STATUSES), so
 *  segment counts always sum to the "Loads Open Right Now" KPI. "On the Road" is deliberately
 *  everything between Truck assigned and Delivered — Truck assigned itself gets its own segment. */
const PIPELINE_SEGMENT_DEFS: {
  id: string;
  label: string;
  tone: LoadPipelineTone;
  statuses: readonly LoadStatus[];
}[] = [
  {
    id: 'being-sourced',
    label: 'Being Sourced',
    tone: 'neutral',
    statuses: ['created', 'bids_received'],
  },
  { id: 'truck-assigned', label: 'Truck Assigned', tone: 'brand', statuses: ['truck_assigned'] },
  {
    id: 'on-the-road',
    label: 'On the Road',
    tone: 'teal',
    statuses: [
      'in_transit_loading',
      'reached_loading',
      'loaded',
      'in_transit_unloading',
      'reached_unloading',
    ],
  },
  {
    id: 'delivered-pod-or-money-open',
    label: 'Delivered, POD or Money Open',
    tone: 'warning',
    statuses: [
      'delivered_ok',
      'delivered_with_issues',
      'original_pod_received',
      'invoice_generated',
      'payment',
    ],
  },
];

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

      const [tripCounts, dailyRows, fleetActivity] = await Promise.all([
        this.dashboardsRepository.getTripCounts(tenantId, range),
        this.dashboardsRepository.getDailyAggregates(tenantId, range),
        this.getFleetActivityMetrics(tenantId),
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
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch loads summary');
    }
  }

  /** Settings → Approvals — every pending customer/vehicle/driver for the tenant, in one list. */
  async listPendingApprovals(
    tenantId: string,
    actingUser: AuthenticatedUser,
  ): Promise<ListPendingApprovalsResult> {
    try {
      const [customers, vehicles, drivers] = await Promise.all([
        this.customerService.list(tenantId, actingUser.role, {
          page: 1,
          limit: MAX_PENDING_PER_TYPE,
          status: 'pending',
        }),
        this.vehicleService.listVehicles(tenantId, {
          page: 1,
          limit: MAX_PENDING_PER_TYPE,
          status: 'pending',
        }),
        this.driverService.listDrivers(tenantId, {
          page: 1,
          limit: MAX_PENDING_PER_TYPE,
          status: 'pending_staff_review',
        }),
      ]);

      const items: PendingApprovalItem[] = [
        ...customers.items.map((customer) => ({
          type: 'customer' as const,
          id: customer.id,
          label: customer.name,
          requestedBy: customer.createdBy,
          requestedAt: customer.createdAt,
        })),
        ...vehicles.items.map((vehicle) => ({
          type: 'vehicle' as const,
          id: vehicle.id,
          label: vehicle.registrationNumber,
          requestedBy: vehicle.createdBy,
          requestedAt: vehicle.createdAt,
        })),
        ...drivers.items.map((driver) => ({
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

  /** Home screen's "Where Every Load Is" card: a live (not date-scoped) funnel of every open
   *  (non-closed) load across 4 stage buckets, plus 4 headline KPIs. */
  async getLoadPipeline(tenantId: string): Promise<LoadPipelineSummary> {
    try {
      const [statusRows, openRequisitions] = await Promise.all([
        this.dashboardsRepository.getOpenLoadsByStatus(tenantId),
        this.dashboardsRepository.countOpenRequisitions(tenantId),
      ]);

      const totalOpen = statusRows.reduce((sum, row) => sum + row.count, 0);
      const tonnesInPlay = statusRows.reduce((sum, row) => sum + row.tonnes, 0);
      const openOnMarketFleet = statusRows
        .filter((row) => row.sourceType === 'market')
        .reduce((sum, row) => sum + row.count, 0);

      const segments: LoadPipelineSegment[] = PIPELINE_SEGMENT_DEFS.map((def) => {
        const count = statusRows
          .filter((row) => (def.statuses as readonly string[]).includes(row.status))
          .reduce((sum, row) => sum + row.count, 0);
        return {
          id: def.id,
          label: def.label,
          count,
          percent: totalOpen === 0 ? 0 : Math.round((count / totalOpen) * 100),
          tone: def.tone,
        };
      });

      const kpis: LoadPipelineKpi[] = [
        { id: 'loads-open', label: 'Loads Open Right Now', value: totalOpen },
        {
          id: 'orders-short-of-trucks',
          label: 'Customer Orders Short of Trucks',
          value: openRequisitions,
        },
        { id: 'open-on-market-fleet', label: 'Open on Market Fleet', value: openOnMarketFleet },
        { id: 'tonnes-in-play', label: 'Tonnes in Play', value: tonnesInPlay },
      ];

      return { segments, kpis };
    } catch (error) {
      rethrow(error, 'Failed to fetch load pipeline');
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
