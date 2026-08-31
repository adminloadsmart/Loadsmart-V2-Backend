import { DateFilter } from '../../../shared/utils/date-filter';

/** Raw `req.query` shape for the fleet-activity endpoint, validated by dashboards.validators.ts. */
export interface FleetActivityRangeInput {
  from?: string;
  to?: string;
}

export interface FleetActivityDateRange {
  from: string;
  to: string;
}

/** Live counts by VehicleOperationalStatus (masters/utils/vehicle.type.ts), not scoped to `range`. */
export interface FleetOperationalBreakdown {
  onTrip: number;
  idle: number;
  warnOnAssign: number;
  inactive: number;
}

export interface FleetActivitySummary {
  range: FleetActivityDateRange;
  fleetSize: number;
  trucksRunningNow: number;
  operationalBreakdown: FleetOperationalBreakdown;
  /**
   * Not computable yet: `tracking`, `maintenance`, and `payments` are still schema-less stubs
   * (no dated distance/cost/earning records — see each module's entity/service files). Revisit
   * once those modules have real data to aggregate over `range`.
   */
  kmCovered: null;
  maintenanceCost: null;
  fleetPnl: null;
}

export type PendingApprovalType = 'customer' | 'vehicle' | 'driver';

/** One row per pending customer/vehicle/driver, normalized to a common shape for Settings →
 *  Approvals — approve/reject still happen on each type's own endpoint (PATCH /customers/{id}/
 *  approve|reject, PATCH /masters/vehicles|drivers/{id}/approve|reject); this is read-only. */
export interface PendingApprovalItem {
  type: PendingApprovalType;
  id: string;
  label: string;
  requestedBy: string | null;
  requestedAt: Date;
}

export interface ListPendingApprovalsResult {
  items: PendingApprovalItem[];
  total: number;
}

/** Raw `req.query` shape for the loads-summary endpoint, validated by
 *  dashboardsValidators.getLoadsSummary. `filter` omitted entirely defaults to 'last15days' —
 *  see DashboardsService.getLoadsSummary. */
export interface LoadsSummaryRangeInput {
  filter?: DateFilter;
  from?: string;
  to?: string;
}

/** The concrete range actually applied, echoed back on the response — mirrors how
 *  FleetActivitySummary.range echoes its own resolved from/to. */
export interface LoadsSummaryRange {
  filter: DateFilter;
  from: string;
  to: string;
}

/** all = active + completed always, by construction (LOAD_STATUS_GROUPS is an exhaustive 2-way
 *  partition of LOAD_STATUSES — see loads/utils/loads.types.ts). Scoped to load.created_at within
 *  `range`, regardless of status (deliberately NOT the shipper-analytics MOVED_LOADS filter). */
export interface LoadsSummaryTripCounts {
  all: number;
  active: number;
  completed: number;
}

/** One point per IST calendar day in range, zero-filled — "Loads — last 15 days" bar chart. */
export interface LoadsPerDayPoint {
  date: string;
  count: number;
}

/** Sums LoadEntity.plannedCapacityTonnes (available from planning onward on every load, unlike
 *  podQuantityReceived which is null until delivery) per IST calendar day, zero-filled. */
export interface TonnesShippedPerDayPoint {
  date: string;
  tonnes: number;
}

/** Sums LoadEntity.freightValue per IST calendar day, zero-filled. freightValue is null on
 *  own-fleet loads (only market loads have it), so those contribute 0 via COALESCE(SUM(...),0) in
 *  DashboardsRepository.getDailyAggregates, not by being excluded. */
export interface FreightSpendPerDayPoint {
  date: string;
  amount: number;
}

/** Repository-internal sparse row (no zero-fill) returned by
 *  DashboardsRepository.getDailyAggregates — one row per day that had >=1 load in range. */
export interface LoadsSummaryDailyRow {
  date: string;
  count: number;
  tonnes: number;
  freightAmount: number;
}

export interface LoadsSummary {
  range: LoadsSummaryRange;
  tripCounts: LoadsSummaryTripCounts;
  loadsPerDay: LoadsPerDayPoint[];
  tonnesShippedPerDay: TonnesShippedPerDayPoint[];
  tonnesShippedTotal: number;
  freightSpendPerDay: FreightSpendPerDayPoint[];
  freightSpendTotal: number;
}
