import { rethrow } from '../../../shared/errors';
import { startOfIstDate, toIstDateString } from '../../../shared/utils/ist-time';
import { VehicleEntity } from '../../masters/vehicle/entities/vehicle.entity';
import { MaintenanceJobEntity } from '../../maintenance/entities/maintenance-job.entity';
import { LoadEntity } from '../../loads/entities/load.entity';
import { DELIVERED_LOAD_STATUSES } from '../../loads/utils/loads.types';
import { DriverTenantRelationEntity } from '../../driver/entities/driver-tenant-relation.entity';
import { downtimeDaysInWindow, money } from '../../maintenance/calculations/downtime';
import { daysBetween, round } from '../../maintenance/calculations/dates';
import { FleetAnalyticsRepository } from './fleet-analytics.repository';
import {
  FleetAnalyticsCompliance,
  FleetAnalyticsCost,
  FleetAnalyticsEnergy,
  FleetAnalyticsFilterOptions,
  FleetAnalyticsFilters,
  FleetAnalyticsFindings,
  FleetAnalyticsMaintenance,
  FleetAnalyticsMeta,
  FleetAnalyticsOperations,
  FleetAnalyticsOverview,
  FleetAnalyticsPeriodView,
  FleetAnalyticsSummary,
  FleetAnalyticsUtilisation,
  FleetCostHead,
  FleetDayBucket,
  FleetDocumentCounts,
  FleetEmptyBecause,
  FleetFinding,
  FleetLaneAmount,
  FleetLaneOnTimeRow,
  FleetTruckTypeCost,
  FleetVehicleSummary,
  TyreConditionLabel,
} from './utils/fleet-analytics.interface';
import {
  COMPLIANCE_DOCUMENT_TYPES,
  DAYS_PER_MONTH,
  DOCUMENT_LABELS,
  FINDINGS_LIMIT,
  FLEET_ANALYTICS_HELD_AS,
  HELD_AS_LABELS,
  IDLE_TRUCKS_LIMIT,
  LEAST_USED_TRUCKS_LIMIT,
  LOAD_STAGES,
  MAINTENANCE_BY_VEHICLE_LIMIT,
  MIN_BENCHMARK_TRUCKS,
  NEW_TRUCK_MAX_AGE_YEARS,
  ON_TIME_BY_LANE_LIMIT,
  ON_TIME_WINDOW_MS,
  RENEW_THIS_WEEK_LIMIT,
  REPLACEMENT_CANDIDATES_LIMIT,
  TOP_LANES_BY_COST,
  TRUCKS_BY_COST_LIMIT,
  TYRE_REPLACE_NOW_MM,
  TYRE_WORN_MM,
  UNAVAILABLE_REASONS,
  UnavailableKey,
} from './utils/fleet-analytics.constants';
import { FleetPeriod, MonthWindow, resolveFleetPeriod } from './utils/fleet-analytics.period';
import {
  DayBuckets,
  FixedCostParts,
  Lane,
  OdometerPoint,
  PeriodDay,
  TimeWindow,
  TruckTypeKey,
  ZERO_FIXED_COST,
  addFixedCost,
  average,
  bodyTypeOf,
  currentDatedDocuments,
  dailyFixedCost,
  dayBuckets,
  documentBucket,
  dueAt,
  fixedCostOver,
  hadExpiredDocumentAt,
  intersect,
  isAttached,
  isCountedJob,
  isDelivered,
  isOnTime,
  isServiceOrBreakdown,
  istMonth,
  jobCategory,
  jobCost,
  jobInterval,
  kmInWindow,
  laneOf,
  laneOfRequisition,
  lateDays,
  loadArrival,
  loadDeparture,
  loadingHours,
  median,
  monthlyEmiAndLease,
  newTreadMm,
  onLoadInterval,
  overlapDays,
  pct,
  perKm,
  periodDays,
  replacementCandidates,
  sizeOf,
  toFleetVehicleSummary,
  turnaroundDays,
  tyreBand,
  tyreLifeLeft,
  unloadingHours,
  vehicleAgeYears,
} from './utils/fleet-analytics.calculations';

/** One truck's figures over the period — every tab builds from these rows. */
interface VehicleStats {
  vehicle: VehicleEntity;
  summary: FleetVehicleSummary;
  body: TruckTypeKey;
  size: TruckTypeKey | null;
  /** Monthly fixed salary of the driver assigned to the truck (0 when none, or not fixed). */
  driverSalary: number;
  /** Day status (§8): on a load + workshop + idle = days in period. */
  buckets: DayBuckets;
  /** Fixed cost over the period, by part (§7). */
  fixed: FixedCostParts;
  /** Average daily fixed cost over the period — what each idle or workshop day carried. */
  dailyFixed: number;
  /** Daily fixed cost as of today — for "what it costs while the paper is out". */
  currentDailyFixed: number;
  /** Counted maintenance jobs opened inside the period. */
  jobs: MaintenanceJobEntity[];
  /** Running cost: maintenance only until fuel, tolls, trip expenses and hire are recorded. */
  maintenanceCost: number;
  /** Days jobs kept the truck off the road inside the period (workshop + breakdown days). */
  downtimeDays: number;
  ageYears: number | null;
  /** Loads on the truck overlapping the period, before the customer / lane filters. */
  loads: LoadEntity[];
  points: OdometerPoint[];
  km: { km: number; estimated: boolean };
}

interface FleetContext {
  filters: FleetAnalyticsFilters;
  period: FleetPeriod;
  periodView: FleetAnalyticsPeriodView;
  /** Days in period (§1): start to today, or to the period end if earlier. */
  days: PeriodDay[];
  /** The period cut at now. */
  window: TimeWindow;
  now: Date;
  today: string;
  stats: VehicleStats[];
  /** Loads that started in the period, after the customer / lane filters (§1). */
  loadsStarted: LoadEntity[];
  /** Every load overlapping the period, after the customer / lane filters. */
  loads: LoadEntity[];
  drivers: DriverTenantRelationEntity[];
  /** Salaries of drivers with no truck, charged to the fleet (§7), over the period. */
  unassignedSalaryCost: number;
  /** The same, a month. */
  unassignedMonthlySalary: number;
  emptyBecause: FleetEmptyBecause | null;
}

const PARTIAL_COST_NOTE =
  'Fleet cost counts maintenance, EMI and lease, insurance, National Permit and driver salaries. ' +
  [
    UNAVAILABLE_REASONS.fuel,
    UNAVAILABLE_REASONS.tolls,
    UNAVAILABLE_REASONS.tripExpenses,
    UNAVAILABLE_REASONS.eChallans,
    UNAVAILABLE_REASONS.hire,
    UNAVAILABLE_REASONS.truckPrice,
  ].join(' ');

const TYRE_BAND_RANK: Record<TyreConditionLabel, number> = {
  very_worn: 0,
  worn: 1,
  fair: 2,
  good: 3,
  new_like: 4,
};

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function roundOrNull(value: number | null, digits = 1): number | null {
  return value === null ? null : round(value, digits);
}

function inr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

function isWithin(at: Date | null, window: TimeWindow): at is Date {
  return at !== null && at >= window.from && at <= window.to;
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}

/** Running + fixed cost of one truck over the period. */
function truckCost(s: VehicleStats): number {
  return s.maintenanceCost + s.fixed.total;
}

/** Fleet-level totals (§7): running + fixed, where fixed includes drivers with no truck. */
function fleetTotals(context: FleetContext) {
  const running = sum(context.stats, (s) => s.maintenanceCost);
  const fixed = sum(context.stats, (s) => s.fixed.total) + context.unassignedSalaryCost;
  const withKm = context.stats.filter((s) => s.km.km > 0);
  return {
    running,
    fixed,
    total: running + fixed,
    km: sum(withKm, (s) => s.km.km),
    trucksWithKm: withKm.length,
    estimated: context.stats.some((s) => s.km.estimated),
  };
}

/** Cost and km of a group of trucks (no fleet-level salaries). */
function groupCost(rows: VehicleStats[]) {
  const cost = sum(rows, truckCost);
  const km = sum(rows, (s) => s.km.km);
  return { cost, km, perKm: perKm(cost, km) };
}

/** Delivered loads (§1) with a due time to judge them against, and their arrival. */
function deliveredWithDue(loads: LoadEntity[]) {
  return loads.flatMap((load) => {
    const due = dueAt(load);
    const arrival = loadArrival(load);
    if (!isDelivered(load) || !due || !arrival) return [];
    return [{ load, arrival, due }];
  });
}

function onTimeOf(delivered: ReturnType<typeof deliveredWithDue>) {
  const late = delivered.filter((row) => !isOnTime(row.arrival, row.due));
  return {
    pct: pct(delivered.length - late.length, delivered.length),
    late: late.length,
    delivered: delivered.length,
    medianLateDays: roundOrNull(median(late.map((row) => lateDays(row.arrival, row.due)))),
  };
}

function tonnesOf(loads: LoadEntity[]): number {
  return sum(loads, (load) => Number(load.plannedCapacityTonnes ?? 0));
}

/** Average of a per-load measure over the loads that have it. */
function averageOf(loads: LoadEntity[], pick: (load: LoadEntity) => number | null): number {
  const values = loads.flatMap((load) => {
    const value = pick(load);
    return value === null ? [] : [value];
  });
  return round(average(values) ?? 0, 1);
}

/** Where a load sits on the "Where the loads are" chart (§17). */
function stageOf(load: LoadEntity): (typeof LOAD_STAGES)[number] {
  switch (load.status) {
    case 'created':
    case 'bids_received':
      return 'created';
    case 'truck_assigned':
      return 'assigned';
    case 'in_transit_loading':
      return 'running_to_loading';
    case 'reached_loading':
      return 'at_loading_point';
    case 'loaded':
      return 'loaded';
    case 'in_transit_unloading':
      return 'in_transit';
    case 'reached_unloading':
      return 'reached_delivery';
    case 'delivered_ok':
    case 'delivered_with_issues':
      return load.podFileKey ? 'pod_received' : 'unloaded';
    case 'original_pod_received':
    case 'invoice_generated':
    case 'payment':
      return 'pod_received';
    case 'closed':
      return 'closed';
  }
}

/** A lane's cost (§12): daily fixed cost × the days its loads held the truck, in the period. */
function costByLaneOf(context: FleetContext): FleetLaneAmount[] {
  const statsById = new Map(context.stats.map((s) => [s.vehicle.id, s]));
  const lanes = new Map<string, FleetLaneAmount>();
  for (const load of context.loadsStarted) {
    const lane = laneOf(load);
    const interval = onLoadInterval(load, context.now);
    const s = statsById.get(load.vehicleId ?? '');
    if (!lane || !interval || !s) continue;
    const row = lanes.get(lane.key) ?? { lane: lane.label, laneKey: lane.key, loads: 0, cost: 0 };
    row.loads += 1;
    row.cost += overlapDays(interval.from, interval.to, context.window) * s.dailyFixed;
    lanes.set(lane.key, row);
  }
  return [...lanes.values()]
    .map((row) => ({ ...row, cost: money(row.cost) }))
    .sort((a, b) => b.cost - a.cost);
}

/** Fixed cost of the trucks over the days of one month, plus fleet-level salaries. */
function monthFixed(context: FleetContext, month: MonthWindow) {
  const days = context.days.filter((day) => day.date.startsWith(month.month));
  const parts = context.stats.reduce(
    (total, s) => addFixedCost(total, fixedCostOver(s.vehicle, s.driverSalary, days)),
    ZERO_FIXED_COST,
  );
  const unassigned = (context.unassignedMonthlySalary / DAYS_PER_MONTH) * days.length;
  return { parts, unassigned, total: parts.total + unassigned };
}

function bucketOf(
  stats: VehicleStats[],
  truckDays: number,
  pick: (s: VehicleStats) => number,
): FleetDayBucket {
  const days = sum(stats, pick);
  return {
    days,
    pct: pct(days, truckDays),
    fixedCost: money(sum(stats, (s) => pick(s) * s.dailyFixed)),
  };
}

function unavailable(
  context: FleetContext,
  entries: Record<string, UnavailableKey | string>,
): FleetAnalyticsMeta {
  const reasons: Record<string, string> = {};
  for (const [field, reason] of Object.entries(entries)) {
    reasons[field] =
      reason in UNAVAILABLE_REASONS ? UNAVAILABLE_REASONS[reason as UnavailableKey] : reason;
  }
  return { unavailable: reasons, emptyBecause: context.emptyBecause };
}

/** Monthly salary of a driver on a fixed salary (§7); per-trip and per-km pay isn't fixed cost. */
function fixedMonthlySalary(relation: DriverTenantRelationEntity): number {
  const driver = relation.driver;
  return driver.salaryType === 'fixed' ? Number(driver.salaryAmount ?? 0) : 0;
}

/** The truck a driver is assigned to right now: their active primary link. */
function assignedVehicleId(relation: DriverTenantRelationEntity): string | null {
  return (
    (relation.vehicleLinks ?? []).find(
      (link) => link.isPrimary && link.status === 'active' && !link.deletedAt,
    )?.vehicleId ?? null
  );
}

/** A driver's licence valid-to: the profile's, else the latest verification's. */
function licenceValidTo(relation: DriverTenantRelationEntity): string | null {
  const verification = (relation.driver.verifications ?? [])
    .filter((v) => !v.deletedAt)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .at(0);
  return relation.driver.licenseExpiry ?? verification?.validUntil ?? null;
}

export class FleetAnalyticsService {
  constructor(private readonly repository: FleetAnalyticsRepository) {}

  async getFilters(tenantId: string): Promise<FleetAnalyticsFilterOptions> {
    try {
      const [customers, vehicles, requisitions] = await Promise.all([
        this.repository.listCustomersWithLoads(tenantId),
        this.repository.listVehicleOptions(tenantId),
        this.repository.listRequisitionLanes(tenantId),
      ]);

      const bodyTypes = new Map<string, { name: string; sizes: Map<string, string> }>();
      for (const vehicle of vehicles) {
        const body = bodyTypeOf(vehicle);
        const entry = bodyTypes.get(body.key) ?? { name: body.label, sizes: new Map() };
        const size = sizeOf(vehicle);
        if (size) entry.sizes.set(size.key, size.label);
        bodyTypes.set(body.key, entry);
      }

      const lanes = new Map<string, string>();
      for (const requisition of requisitions) {
        const lane = laneOfRequisition(requisition);
        if (lane) lanes.set(lane.key, lane.label);
      }
      const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);

      return {
        periods: [
          { value: 'last_month', label: 'Last month' },
          { value: '3_months', label: '3 months' },
          { value: '6_months', label: '6 months' },
          { value: 'custom', label: 'Custom Range' },
        ],
        bodyTypes: [...bodyTypes.entries()]
          .map(([id, entry]) => ({
            id,
            name: entry.name,
            sizes: [...entry.sizes.entries()].map(([sizeId, name]) => ({ id: sizeId, name })),
          }))
          .sort(byName),
        heldAs: FLEET_ANALYTICS_HELD_AS.map((value) => ({ value, label: HELD_AS_LABELS[value] })),
        customers: customers.map((customer) => ({ id: customer.id, name: customer.name })),
        vehicles: vehicles.map((vehicle) => ({ id: vehicle.id, name: vehicle.registrationNumber })),
        lanes: [...lanes.entries()].map(([id, name]) => ({ id, name })).sort(byName),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet analytics filters');
    }
  }

  async getSummary(
    tenantId: string,
    filters: FleetAnalyticsFilters,
  ): Promise<FleetAnalyticsSummary> {
    try {
      const context = await this.loadContext(tenantId, filters);
      const { periodView, stats, days } = context;
      const totals = fleetTotals(context);
      const truckDays = stats.length * days.length;
      const workingDays = sum(stats, (s) => s.buckets.onLoad);

      return {
        period: periodView,
        vehicles: stats.length,
        costPerKm: {
          value: perKm(totals.total, totals.km),
          distanceKm: totals.km,
          vehicles: totals.trucksWithKm,
          estimated: totals.estimated,
        },
        fleetCost: {
          total: money(totals.total),
          onRoad: money(totals.running),
          standing: money(totals.fixed),
        },
        costPerTonneKm: {
          value: 0,
          tonnes: round(tonnesOf(context.loadsStarted), 1),
          distanceKm: 0,
        },
        utilisation: {
          pct: pct(workingDays, truckDays),
          workingDays,
          truckDays,
        },
        ...unavailable(context, {
          costPerKm: PARTIAL_COST_NOTE,
          costPerTonneKm: 'gps',
          'costPerTonneKm.tonnes': 'weight',
        }),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet analytics summary');
    }
  }

  async getOverview(
    tenantId: string,
    filters: FleetAnalyticsFilters,
  ): Promise<FleetAnalyticsOverview> {
    try {
      const context = await this.loadContext(tenantId, filters);
      const { period, periodView, stats, today, loadsStarted } = context;
      const openJobs = await this.repository.listOpenJobs(
        tenantId,
        stats.map((s) => s.vehicle.id),
      );

      const expiredVehicles = stats.filter((s) =>
        currentDatedDocuments(s.vehicle).some((d) => daysBetween(today, d.expiryDate!) < 0),
      );
      const inWorkshop = new Set(openJobs.map((job) => job.vehicleId));

      const notWorking = (s: VehicleStats) => s.buckets.idle + s.buckets.workshop;
      const notWorkingDays = sum(stats, notWorking);
      const idleCost = sum(stats, (s) => notWorking(s) * s.dailyFixed);

      const costBuildUp = period.months.map((month) => {
        const maintenance = sum(stats, (s) =>
          sum(
            s.jobs.filter((job) => istMonth(job.openedAt) === month.month),
            jobCost,
          ),
        );
        const fixed = monthFixed(context, month);
        const km = sum(stats, (s) => kmInWindow(s.points, intersect(month, context.window)).km);
        const total = maintenance + fixed.total;
        return {
          point: {
            month: month.month,
            fuelAndEnergy: 0,
            tolls: 0,
            driver: money(fixed.parts.driverSalary + fixed.unassigned),
            maintenance: money(maintenance),
            otherTripExpensesAndChallans: 0,
            fixedAndHire: money(
              fixed.parts.emiAndLease + fixed.parts.insurance + fixed.parts.permit,
            ),
            total: money(total),
          },
          costPerKm: perKm(total, km),
        };
      });

      const totals = fleetTotals(context);
      const tonnes = tonnesOf(loadsStarted);
      const onTime = onTimeOf(deliveredWithDue(loadsStarted));
      const ownershipCost = (rows: VehicleStats[]) => {
        const group = groupCost(rows);
        return { cost: money(group.cost), distanceKm: group.km, perKm: group.perKm };
      };

      return {
        period: periodView,
        loads: {
          carried: loadsStarted.length,
          perMonth: round(loadsStarted.length / Math.max(1, period.months.length), 1),
        },
        tonnes: {
          moved: round(tonnes, 1),
          costPerTonne: tonnes > 0 ? money(totals.total / tonnes) : 0,
        },
        tripsPerVehicle: {
          value: stats.length ? round(loadsStarted.length / stats.length, 1) : 0,
          vehicles: stats.length,
        },
        onTime: { pct: onTime.pct, late: onTime.late, delivered: onTime.delivered },
        complianceExpired: { vehicles: expiredVehicles.length },
        trucksInWorkshop: { count: inWorkshop.size, of: stats.length },
        openBreakdowns: { count: openJobs.filter((job) => job.jobType === 'breakdown').length },
        idleStandingCost: {
          amount: money(idleCost),
          idleDays: notWorkingDays,
          perDay: notWorkingDays > 0 ? money(idleCost / notWorkingDays) : 0,
        },
        monthlyCost: costBuildUp.map(({ point, costPerKm }) => ({
          month: point.month,
          totalCost: point.total,
          costPerKm,
        })),
        costBuildUp: costBuildUp.map(({ point }) => point),
        ownedVsAttached: {
          own: ownershipCost(stats.filter((s) => !isAttached(s.vehicle))),
          attached: ownershipCost(stats.filter((s) => isAttached(s.vehicle))),
          hirePaidOut: { amount: 0, vendors: 0 },
          tripsOverClassRate: { count: 0, total: 0, pct: 0 },
        },
        costByLane: costByLaneOf(context).slice(0, TOP_LANES_BY_COST),
        ...unavailable(context, {
          'tonnes.moved': 'weight',
          onTime: 'promisedTime',
          'costBuildUp.fuelAndEnergy': 'fuel',
          'costBuildUp.tolls': 'tolls',
          'costBuildUp.driver': 'Driver salaries only. ' + UNAVAILABLE_REASONS.tripExpenses,
          'costBuildUp.otherTripExpensesAndChallans': 'tripExpenses',
          'costBuildUp.fixedAndHire':
            'EMI, lease, insurance and National Permit only. ' +
            [UNAVAILABLE_REASONS.truckPrice, UNAVAILABLE_REASONS.hire].join(' '),
          'monthlyCost.costPerKm': PARTIAL_COST_NOTE,
          'ownedVsAttached.hirePaidOut': 'hire',
          'ownedVsAttached.tripsOverClassRate': 'gps',
          costByLane:
            'Fixed cost of the days each load held the truck only. ' +
            [UNAVAILABLE_REASONS.fuel, UNAVAILABLE_REASONS.tripExpenses].join(' '),
        }),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet analytics overview');
    }
  }

  async getUtilisation(
    tenantId: string,
    filters: FleetAnalyticsFilters,
  ): Promise<FleetAnalyticsUtilisation> {
    try {
      const context = await this.loadContext(tenantId, filters);
      const { period, periodView, stats, days, loadsStarted } = context;
      const truckDays = stats.length * days.length;
      const onLoad = bucketOf(stats, truckDays, (s) => s.buckets.onLoad);
      const workshop = bucketOf(stats, truckDays, (s) => s.buckets.workshop);
      const idle = bucketOf(stats, truckDays, (s) => s.buckets.idle);

      const tripsOf = new Map<string, number>();
      for (const load of loadsStarted) {
        tripsOf.set(load.vehicleId!, (tripsOf.get(load.vehicleId!) ?? 0) + 1);
      }
      const truckUtilisation = (s: VehicleStats) => pct(s.buckets.onLoad, days.length);
      const fleetUtilisation = pct(onLoad.days, truckDays);
      const tonnes = tonnesOf(loadsStarted);

      return {
        period: periodView,
        loadUtilisation: {
          pct: fleetUtilisation,
          standingTruckDays: idle.days + workshop.days,
        },
        loadedShareOfDistance: { pct: 0, emptyKm: 0 },
        deadRunningCost: { amount: 0, pctOfVariable: 0 },
        trucksBelowHalfAverage: {
          count:
            fleetUtilisation > 0
              ? stats.filter((s) => truckUtilisation(s) < fleetUtilisation / 2).length
              : 0,
        },
        tripsPerVehicle: stats.length ? round(loadsStarted.length / stats.length, 1) : 0,
        tonnesMoved: {
          tonnes: round(tonnes, 1),
          perLoad: loadsStarted.length ? round(tonnes / loadsStarted.length, 1) : 0,
        },
        turnaroundDays: averageOf(loadsStarted, turnaroundDays),
        loadingPlusUnloadingHours: averageOf(loadsStarted, (load) => {
          const loading = loadingHours(load);
          const unloading = unloadingHours(load);
          return loading === null && unloading === null ? null : (loading ?? 0) + (unloading ?? 0);
        }),
        days: {
          truckDays,
          onLoad,
          workshop,
          idle,
          lostOnLoads: { days: 0, pct: 0, fixedCost: 0 },
        },
        leastUsedTrucks: stats
          .map((s) => ({
            vehicle: s.summary,
            onLoadDays: s.buckets.onLoad,
            idleDays: s.buckets.idle,
            workshopDays: s.buckets.workshop,
            utilisationPct: truckUtilisation(s),
            idleCost: money((s.buckets.idle + s.buckets.workshop) * s.dailyFixed),
          }))
          .sort((a, b) => a.utilisationPct - b.utilisationPct || b.idleCost - a.idleCost)
          .slice(0, LEAST_USED_TRUCKS_LIMIT),
        loadDayHours: {
          moving: 0,
          atGates: 0,
          detention: 0,
          cityNoEntry: 0,
          unplannedHalts: 0,
          normalStops: 0,
        },
        idleDaysByTrips: stats
          .map((s) => ({
            vehicle: s.summary,
            trips: tripsOf.get(s.vehicle.id) ?? 0,
            distanceKm: s.km.km,
            downtimeDays: round(s.downtimeDays, 1),
            net: null,
          }))
          .sort((a, b) => a.trips - b.trips || b.downtimeDays - a.downtimeDays)
          .slice(0, IDLE_TRUCKS_LIMIT),
        emptyRunningByLane: [],
        plannedVsActual: {
          months: period.months.map((month) => ({ month: month.month, overPct: 0 })),
          plannedKm: 0,
          actualKm: 0,
          overPct: 0,
          extraEnergyCost: 0,
        },
        ...unavailable(context, {
          loadedShareOfDistance: 'gps',
          deadRunningCost: 'gps',
          'days.lostOnLoads': 'gps',
          loadDayHours: 'gps',
          emptyRunningByLane: 'gps',
          plannedVsActual: 'plannedDistance',
          'tonnesMoved.tonnes': 'weight',
          idleDaysByTrips: 'perTripHire',
          'idleDaysByTrips.net': 'No revenue per load is recorded yet.',
        }),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet utilisation');
    }
  }

  async getCost(tenantId: string, filters: FleetAnalyticsFilters): Promise<FleetAnalyticsCost> {
    try {
      const context = await this.loadContext(tenantId, filters);
      const { periodView, stats, today, loadsStarted } = context;
      const totals = fleetTotals(context);
      const fixedPart = (pick: (parts: FixedCostParts) => number) =>
        money(sum(stats, (s) => pick(s.fixed)));

      const heads: { head: FleetCostHead; label: string; amount: number }[] = [
        { head: 'fuel_and_energy', label: 'Fuel and energy', amount: 0 },
        { head: 'hire_and_rental', label: 'Hire and rental', amount: 0 },
        { head: 'emi_and_lease', label: 'EMI and lease', amount: fixedPart((p) => p.emiAndLease) },
        { head: 'depreciation', label: 'Depreciation', amount: 0 },
        {
          head: 'maintenance_and_tyres',
          label: 'Maintenance and tyres',
          amount: money(totals.running),
        },
        { head: 'tolls', label: 'Tolls', amount: 0 },
        { head: 'insurance', label: 'Insurance', amount: fixedPart((p) => p.insurance) },
        { head: 'permits', label: 'Permits', amount: fixedPart((p) => p.permit) },
        {
          head: 'driver_salary_and_bhatta',
          label: 'Driver salary and bhatta',
          amount: money(sum(stats, (s) => s.fixed.driverSalary) + context.unassignedSalaryCost),
        },
        { head: 'other_trip_expenses', label: 'Other trip expenses', amount: 0 },
        { head: 'e_challans', label: 'E-challans', amount: 0 },
      ];
      const costByHead = heads.sort((a, b) => b.amount - a.amount);

      const byBody = groupBy(stats, (s) => s.body.key);
      const costByTruckType: FleetTruckTypeCost[] = [...byBody.entries()]
        .map(([bodyType, rows]) => {
          const group = groupCost(rows);
          return {
            bodyType,
            name: rows[0].body.label,
            vehicles: rows.length,
            cost: money(group.cost),
            distanceKm: group.km,
            perKm: group.perKm,
            sizes: [...groupBy(rows, (s) => s.size?.key ?? 'Unknown size').entries()].map(
              ([size, sizeRows]) => {
                const ofSize = groupCost(sizeRows);
                return {
                  size,
                  vehicles: sizeRows.length,
                  cost: money(ofSize.cost),
                  distanceKm: ofSize.km,
                  perKm: ofSize.perKm,
                };
              },
            ),
          };
        })
        .sort((a, b) => (b.perKm ?? -1) - (a.perKm ?? -1));

      const emiTrucks = stats.filter((s) => monthlyEmiAndLease(s.vehicle, today) > 0);

      return {
        period: periodView,
        costPerKm: perKm(totals.total, totals.km),
        onRoadPerKm: perKm(totals.running, totals.km),
        standingPerKm: perKm(totals.fixed, totals.km),
        distanceKm: totals.km,
        costPerTonneKm: {
          value: 0,
          avgLoadTonnes: loadsStarted.length
            ? round(tonnesOf(loadsStarted) / loadsStarted.length, 1)
            : 0,
        },
        energyPerKm: { value: 0, spent: 0 },
        tollsPerKm: { value: 0, spent: 0 },
        emiAndLease: {
          monthly: money(sum(emiTrucks, (s) => monthlyEmiAndLease(s.vehicle, today))),
          trucks: emiTrucks.length,
        },
        costByHead,
        totalCost: money(sum(costByHead, (head) => head.amount)),
        costByLane: costByLaneOf(context).map((row) => ({ ...row, perKm: null })),
        costByTruckType,
        costByTruck: stats
          .map((s) => ({
            vehicle: s.summary,
            cost: money(truckCost(s)),
            distanceKm: s.km.km,
            kmEstimated: s.km.estimated,
            perKm: perKm(truckCost(s), s.km.km),
          }))
          .sort((a, b) => (b.perKm ?? -1) - (a.perKm ?? -1))
          .slice(0, TRUCKS_BY_COST_LIMIT),
        ...unavailable(context, {
          costPerKm: PARTIAL_COST_NOTE,
          'costByHead.fuel_and_energy': 'fuel',
          'costByHead.hire_and_rental': 'hire',
          'costByHead.depreciation': 'truckPrice',
          'costByHead.tolls': 'tolls',
          'costByHead.permits': 'statePermitFee',
          'costByHead.driver_salary_and_bhatta':
            'Fixed salaries only. ' + UNAVAILABLE_REASONS.tripExpenses,
          'costByHead.other_trip_expenses': 'tripExpenses',
          'costByHead.e_challans': 'eChallans',
          energyPerKm: 'fuel',
          tollsPerKm: 'tolls',
          costPerTonneKm: 'gps',
          'costByLane.perKm': 'gps',
        }),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet cost');
    }
  }

  async getEnergy(tenantId: string, filters: FleetAnalyticsFilters): Promise<FleetAnalyticsEnergy> {
    try {
      const context = await this.loadContext(tenantId, filters);
      const { periodView, stats } = context;

      return {
        period: periodView,
        dieselMileage: { kmPerLitre: 0, km: 0, spend: 0 },
        dieselPerKm: { value: 0, pricePerLitre: 0 },
        electricPerKm: { value: 0, pctBelowDiesel: 0 },
        blendedCostPerKwh: { value: 0, yardRate: 0, publicRate: 0 },
        electricConsumption: { kwhPerKm: 0, kwhDrawn: 0 },
        cngPerKm: { value: 0, km: 0, spend: 0 },
        vehiclesOffBenchmark: { count: 0 },
        avoidableSpend: { amount: 0 },
        byPowertrain: [...groupBy(stats, (s) => s.vehicle.fuelType ?? 'unknown').entries()].map(
          ([fuelType, rows]) => ({ fuelType, vehicles: rows.length, costPerKm: 0 }),
        ),
        offBenchmark: [],
        byTruckType: [...groupBy(stats, (s) => s.body.key).entries()].map(([bodyType, rows]) => ({
          bodyType,
          name: rows[0].body.label,
          vehicles: rows.length,
          costPerKm: 0,
        })),
        byLane: [],
        ...unavailable(context, { '*': 'fuel', byLane: 'gps' }),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet energy');
    }
  }

  async getMaintenance(
    tenantId: string,
    filters: FleetAnalyticsFilters,
    canSeeCosts: boolean,
  ): Promise<FleetAnalyticsMaintenance> {
    try {
      const context = await this.loadContext(tenantId, filters);
      const { period, periodView, stats } = context;
      const tyres = await this.repository.listFittedTyres(
        tenantId,
        stats.map((s) => s.vehicle.id),
      );
      const totals = fleetTotals(context);

      const jobs = stats.flatMap((s) => s.jobs);
      const planned = jobs.filter((job) => jobCategory(job) === 'preventive').length;
      const serviceAndBreakdowns = jobs.filter(isServiceOrBreakdown).length;
      const breakdowns = jobs.filter((job) => job.jobType === 'breakdown').length;
      const spend = sum(jobs, jobCost);

      const owned = stats.filter((s) => !isAttached(s.vehicle) && s.ageYears !== null);
      const withOdometer = stats.filter((s) => s.vehicle.serviceUsage?.odometerKm != null);
      const running = stats.filter((s) => s.km.km > 0);
      const perKmOf = (s: VehicleStats) => (s.km.km > 0 ? s.maintenanceCost / s.km.km : 0);

      // Tyres (§16): judged on the last gauged tread; a position with no reading has no rated
      // life to fall back on yet, so it is left out.
      const gauged = tyres.flatMap(({ tyre, reading }) => {
        if (!reading) return [];
        const tread = Number(reading.treadMm);
        const lifeLeft = tyreLifeLeft(tread, newTreadMm(tyre));
        return [{ vehicleId: tyre.vehicleId, tread, lifeLeft, band: tyreBand(tread, lifeLeft) }];
      });
      const worstTyre = new Map<string, (typeof gauged)[number]>();
      const tyreCount = new Map<string, number>();
      for (const row of gauged) {
        tyreCount.set(row.vehicleId, (tyreCount.get(row.vehicleId) ?? 0) + 1);
        const worst = worstTyre.get(row.vehicleId);
        if (
          !worst ||
          TYRE_BAND_RANK[row.band] < TYRE_BAND_RANK[worst.band] ||
          (row.band === worst.band && row.lifeLeft < worst.lifeLeft)
        ) {
          worstTyre.set(row.vehicleId, row);
        }
      }

      // Money per truck is only built for a seat that may see it; the km stay for everybody.
      const costFields = (s: VehicleStats) =>
        canSeeCosts ? { cost: money(s.maintenanceCost), perKm: money(perKmOf(s)) } : {};
      const worstPerKmFirst = (a: VehicleStats, b: VehicleStats) =>
        perKmOf(b) - perKmOf(a) || b.maintenanceCost - a.maintenanceCost;

      const plannedVsUnplanned = period.months.map((month) => {
        const inMonth = jobs.filter((job) => istMonth(job.openedAt) === month.month);
        const rowsOf = (category: string) => inMonth.filter((job) => jobCategory(job) === category);
        const valueOf = (category: string) =>
          canSeeCosts ? money(sum(rowsOf(category), jobCost)) : rowsOf(category).length;
        const preventive = valueOf('preventive');
        const unplannedRepair = valueOf('unplannedRepair');
        const roadsideBreakdown = valueOf('roadsideBreakdown');
        return {
          month: month.month,
          preventive,
          unplannedRepair,
          roadsideBreakdown,
          total: money(preventive + unplannedRepair + roadsideBreakdown),
          counts: {
            preventive: rowsOf('preventive').length,
            unplannedRepair: rowsOf('unplannedRepair').length,
            roadsideBreakdown: rowsOf('roadsideBreakdown').length,
          },
        };
      });

      const workshop = {
        period: periodView,
        distance: {
          km: totals.km,
          vehicles: running.length,
          estimated: running.some((s) => s.km.estimated),
        },
        preventiveShare: {
          pct: pct(planned, serviceAndBreakdowns),
          planned,
          total: serviceAndBreakdowns,
        },
        downtime: {
          days: round(
            sum(stats, (s) => s.downtimeDays),
            1,
          ),
          trucks: stats.filter((s) => s.downtimeDays > 0).length,
        },
        meanDistanceBetweenFailures: {
          km: breakdowns > 0 ? Math.round(totals.km / breakdowns) : null,
          breakdowns,
        },
        averageFleetAge: {
          years: owned.length ? round(sum(owned, (s) => s.ageYears!) / owned.length, 1) : 0,
          vehicles: owned.length,
        },
        lifetimeDistance: {
          km: sum(withOdometer, (s) => s.vehicle.serviceUsage!.odometerKm!),
          vehicles: withOdometer.length,
        },
        tyresToReplace: {
          positions: gauged.filter((row) => row.tread <= TYRE_WORN_MM).length,
          replaceNow: gauged.filter((row) => row.tread <= TYRE_REPLACE_NOW_MM).length,
        },
        plannedVsUnplannedUnit: canSeeCosts ? ('amount' as const) : ('count' as const),
        plannedVsUnplanned,
        byVehicle: running
          .filter((s) => s.maintenanceCost > 0)
          .sort(worstPerKmFirst)
          .slice(0, MAINTENANCE_BY_VEHICLE_LIMIT)
          .map((s) => ({
            vehicle: s.summary,
            ageYears: s.ageYears,
            kmRun: s.km.km,
            kmEstimated: s.km.estimated,
            ...costFields(s),
          })),
        tyresByVehicle: stats
          .filter((s) => worstTyre.has(s.vehicle.id))
          .sort(worstPerKmFirst)
          .slice(0, MAINTENANCE_BY_VEHICLE_LIMIT)
          .map((s) => {
            const worst = worstTyre.get(s.vehicle.id)!;
            return {
              vehicle: s.summary,
              ageYears: s.ageYears,
              tyres: tyreCount.get(s.vehicle.id) ?? 0,
              treadLeftPct: round(worst.lifeLeft * 100, 1),
              condition: worst.band,
              kmRun: s.km.km,
              kmEstimated: s.km.estimated,
              ...costFields(s),
            };
          }),
        ...unavailable(context, {
          writtenDownValue: 'truckPrice',
          averageFleetAge: 'registrationAge',
          tyresToReplace: 'tyreRatedLife',
          replacementCandidates: 'replacementFormula',
        }),
      };

      if (!canSeeCosts) return workshop;

      return {
        ...workshop,
        downtime: {
          ...workshop.downtime,
          cost: money(sum(stats, (s) => s.downtimeDays * s.dailyFixed)),
        },
        spend: {
          total: money(spend),
          perKm: totals.km > 0 ? money(spend / totals.km) : 0,
          jobs: jobs.length,
        },
        writtenDownValue: { value: null, onRoadValue: null },
        replacementCandidates: replacementCandidates(
          running.map((s) => ({
            row: s,
            truckTypeKey: `${s.body.key}|${s.size?.key ?? ''}`,
            ageYears: s.ageYears,
            perKm: perKmOf(s),
          })),
          NEW_TRUCK_MAX_AGE_YEARS,
          MIN_BENCHMARK_TRUCKS,
        )
          .slice(0, REPLACEMENT_CANDIDATES_LIMIT)
          .map((candidate) => ({
            vehicle: candidate.row.summary,
            ageYears: candidate.row.ageYears,
            perKm: money(candidate.perKm),
            benchmarkPerKm: money(candidate.benchmarkPerKm),
            benchmarkScope: candidate.benchmarkScope,
            extraPerKm: money(candidate.extraPerKm),
            overNewPerKm: money(candidate.extraPerKm),
          })),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet maintenance');
    }
  }

  async getOperations(
    tenantId: string,
    filters: FleetAnalyticsFilters,
  ): Promise<FleetAnalyticsOperations> {
    try {
      const context = await this.loadContext(tenantId, filters);
      const { periodView, now, today, loadsStarted, loads, stats, drivers } = context;
      const delivered = deliveredWithDue(loadsStarted);
      const onTime = onTimeOf(delivered);

      const onTheRoad = this.applyLoadFilters(
        await this.repository.listLoadsOnTheRoad(
          tenantId,
          stats.map((s) => s.vehicle.id),
        ),
        filters,
      );
      const runningBehind = onTheRoad.filter((load) => {
        const due = dueAt(load);
        return due !== null && due.getTime() + ON_TIME_WINDOW_MS < now.getTime();
      });

      const staged = new Map([...loads, ...onTheRoad].map((load) => [load.id, load]));
      const stageCounts = new Map<string, number>(LOAD_STAGES.map((stage) => [stage, 0]));
      for (const load of staged.values()) {
        const stage = stageOf(load);
        stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
      }

      const byLane = new Map<string, { lane: Lane; rows: typeof delivered }>();
      for (const row of delivered) {
        const lane = laneOf(row.load);
        if (!lane) continue;
        const group = byLane.get(lane.key) ?? { lane, rows: [] };
        group.rows.push(row);
        byLane.set(lane.key, group);
      }
      const onTimeByLane: FleetLaneOnTimeRow[] = [...byLane.values()]
        .map(({ lane, rows }) => {
          const committed = rows.flatMap(({ load }) => {
            const requisition = load.requisition;
            return requisition?.pickupDate && requisition.expectedDeliveryDate
              ? [daysBetween(requisition.pickupDate, requisition.expectedDeliveryDate)]
              : [];
          });
          const turnaround = rows.flatMap(({ load }) => {
            const days = turnaroundDays(load);
            return days === null ? [] : [days];
          });
          return {
            lane: lane.label,
            laneKey: lane.key,
            loads: rows.length,
            transitCommittedDays: roundOrNull(median(committed)),
            onTimePct: onTimeOf(rows).pct,
            averageTurnaroundDays: roundOrNull(average(turnaround)),
          };
        })
        .sort((a, b) => a.onTimePct - b.onTimePct)
        .slice(0, ON_TIME_BY_LANE_LIMIT);

      // Who is driving (§17): today's position.
      const onTripDrivers = new Set(onTheRoad.map((load) => load.driverId).filter(Boolean));
      const away = (relation: DriverTenantRelationEntity) =>
        ['on_leave', 'medically_unfit', 'inactive'].includes(
          relation.operationalStatus?.operationalStatus ?? 'active',
        );
      const available = drivers.filter((relation) => {
        const validTo = licenceValidTo(relation);
        return (
          !away(relation) &&
          relation.operationalStatus?.operationalStatus !== 'on_trip' &&
          !onTripDrivers.has(relation.driverId) &&
          validTo !== null &&
          validTo >= today
        );
      });
      const driverOnTime = [...groupBy(delivered, (row) => row.load.driverId ?? '').entries()]
        .filter(([driverId]) => driverId !== '')
        .map(([, rows]) => onTimeOf(rows).pct);

      return {
        period: periodView,
        onTime: { pct: onTime.pct, late: onTime.late, delivered: onTime.delivered },
        medianLateDays: onTime.medianLateDays,
        turnaroundDays: averageOf(loadsStarted, turnaroundDays),
        detention: { hours: 0, loadsPastFreeHours: 0 },
        recoverableDetention: { amount: 0 },
        loadingHours: averageOf(loadsStarted, loadingHours),
        unloadingHours: averageOf(loadsStarted, unloadingHours),
        durationAgainstPlan: { pct: 0, extraKm: 0 },
        onTheRoad: { count: onTheRoad.length, runningBehind: runningBehind.length },
        detentionByConsignor: [],
        onTimeByLane,
        loadStages: LOAD_STAGES.map((stage) => ({ stage, count: stageCounts.get(stage) ?? 0 })),
        loadPipeline: {
          onTheRoad: onTheRoad.length,
          runningBehind: runningBehind.length,
          deliveredPodPending: [...staged.values()].filter(
            (load) => DELIVERED_LOAD_STATUSES.includes(load.status) && !load.podFileKey,
          ).length,
          podInExpensesNotSettled: [...staged.values()].filter(
            (load) => load.podFileKey && load.status !== 'closed',
          ).length,
        },
        drivers: {
          availableToDispatch: available.length,
          awayOrOffRoll: drivers.filter(away).length,
          medianSafetyScore: 0,
          needCoaching: 0,
          onTimePct: round(average(driverOnTime) ?? 0, 1),
        },
        ...unavailable(context, {
          onTime: 'promisedTime',
          detention: 'gps',
          recoverableDetention: 'tripExpenses',
          detentionByConsignor: 'freeHours',
          durationAgainstPlan: 'plannedDistance',
          'onTheRoad.runningBehind':
            'Counts loads already past their delivery window; ' +
            UNAVAILABLE_REASONS.gps.charAt(0).toLowerCase() +
            UNAVAILABLE_REASONS.gps.slice(1),
          'loadStages.running_to_loading': 'No load status marks the run to the loading point yet.',
          'loadPipeline.podInExpensesNotSettled':
            'Trip expense settlement is not recorded yet, so every load with a POD that is not closed is counted.',
          'drivers.medianSafetyScore': 'drivingEvents',
          'drivers.needCoaching': 'drivingEvents',
        }),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet operations');
    }
  }

  /** Today's position for every document and licence (§18) — the period doesn't apply, except to
   *  "loads carried on expired documents" and "drivers who ran a load". */
  async getCompliance(
    tenantId: string,
    filters: FleetAnalyticsFilters,
    canSeeCosts: boolean,
  ): Promise<FleetAnalyticsCompliance> {
    try {
      const context = await this.loadContext(tenantId, filters);
      const { periodView, stats, today, now, loadsStarted, drivers } = context;

      const emptyCounts = (): FleetDocumentCounts => ({
        expired: 0,
        inside7Days: 0,
        inside30Days: 0,
        inOrder: 0,
      });
      const position = emptyCounts();
      const byType = new Map(
        COMPLIANCE_DOCUMENT_TYPES.map((type) => [type as string, emptyCounts()]),
      );
      const renew: FleetAnalyticsCompliance['renewThisWeek'] = [];
      const expiredVehicles = new Set<string>();
      const urgent = { documents: 0, vehicles: new Set<string>() };
      const soon = { documents: 0, vehicles: new Set<string>() };
      let vehiclesInOrder = 0;

      for (const s of stats) {
        let allInOrder = true;
        for (const document of currentDatedDocuments(s.vehicle)) {
          const daysLeft = daysBetween(today, document.expiryDate!);
          const bucket = documentBucket(daysLeft);
          position[bucket] += 1;
          byType.get(document.documentType)![bucket] += 1;
          if (bucket !== 'inOrder') allInOrder = false;
          if (bucket === 'expired') expiredVehicles.add(s.vehicle.id);
          if (bucket === 'inside7Days') {
            urgent.documents += 1;
            urgent.vehicles.add(s.vehicle.id);
          }
          if (bucket === 'inside30Days') {
            soon.documents += 1;
            soon.vehicles.add(s.vehicle.id);
          }
          if (bucket === 'expired' || bucket === 'inside7Days') {
            renew.push({
              vehicle: s.summary,
              documentType: document.documentType,
              label: DOCUMENT_LABELS[document.documentType] ?? document.documentType,
              expiryDate: document.expiryDate!,
              daysLeft,
              ...(canSeeCosts ? { standingPerDay: money(s.currentDailyFixed) } : {}),
            });
          }
        }
        if (allInOrder) vehiclesInOrder += 1;
      }

      const documentsOf = new Map(stats.map((s) => [s.vehicle.id, s.vehicle.documents ?? []]));
      const loadsOnExpired = loadsStarted.filter((load) => {
        const departure = loadDeparture(load);
        return (
          departure !== null &&
          hadExpiredDocumentAt(documentsOf.get(load.vehicleId ?? '') ?? [], departure, now)
        );
      });

      const driversOnLoads = new Set(loadsStarted.map((load) => load.driverId).filter(Boolean));
      const driverItems = drivers
        .map((relation) => {
          const driver = relation.driver;
          const verification = (driver.verifications ?? [])
            .filter((v) => !v.deletedAt)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .at(0);
          const validTo = licenceValidTo(relation);
          const daysLeft = validTo ? daysBetween(today, validTo) : null;
          const status: 'expired' | 'expiring' | 'valid' | 'unknown' =
            daysLeft === null
              ? 'unknown'
              : daysLeft < 0
                ? 'expired'
                : documentBucket(daysLeft) === 'inOrder'
                  ? 'valid'
                  : 'expiring';
          return {
            driverId: driver.id,
            name: driver.fullName,
            licenceNumber: driver.licenseNumber ?? verification?.licenseNumber ?? null,
            licenceClass: verification?.licenseClass ?? null,
            hazmat: (driver.licenseEndorsements ?? []).includes('hazmat'),
            validTo,
            daysLeft,
            status,
          };
        })
        .sort((a, b) => (a.daysLeft ?? Infinity) - (b.daysLeft ?? Infinity));
      const licencesExpired = driverItems.filter((d) => d.status === 'expired').length;
      const licencesExpiring = driverItems.filter((d) => d.status === 'expiring').length;

      return {
        period: periodView,
        vehicles: stats.length,
        documentsInOrder: { vehicles: vehiclesInOrder, of: stats.length },
        trucksWithExpiredDocuments: {
          vehicles: expiredVehicles.size,
          loadsCarried: loadsOnExpired.length,
        },
        expiringIn7Days: { documents: urgent.documents, vehicles: urgent.vehicles.size },
        expiringIn8To30Days: { documents: soon.documents, vehicles: soon.vehicles.size },
        licences: {
          expiredOrExpiring: licencesExpired + licencesExpiring,
          expired: licencesExpired,
        },
        position: {
          ...position,
          total: position.expired + position.inside7Days + position.inside30Days + position.inOrder,
        },
        byDocumentType: [...byType.entries()].map(([documentType, counts]) => ({
          documentType,
          label: DOCUMENT_LABELS[documentType] ?? documentType,
          ...counts,
        })),
        renewThisWeek: renew
          .sort((a, b) => a.daysLeft - b.daysLeft)
          .slice(0, RENEW_THIS_WEEK_LIMIT),
        drivers: {
          onRoll: driverItems.length,
          hazmatEndorsed: driverItems.filter((d) => d.hazmat).length,
          licencesExpired,
          expiringIn30Days: licencesExpiring,
          ranALoadPct: pct(
            driverItems.filter((d) => driversOnLoads.has(d.driverId)).length,
            driverItems.length,
          ),
          items: driverItems,
        },
        ...unavailable(context, {}),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet compliance');
    }
  }

  /** The three or four things worth acting on, each a plain sentence with the tab holding the
   *  evidence, ranked by money at stake over the period. */
  async getFindings(
    tenantId: string,
    filters: FleetAnalyticsFilters,
  ): Promise<FleetAnalyticsFindings> {
    try {
      const context = await this.loadContext(tenantId, filters);
      const { periodView, stats, today, loadsStarted } = context;
      const findings: FleetFinding[] = [];

      const notWorking = (s: VehicleStats) => s.buckets.idle + s.buckets.workshop;
      const idlest = [...stats]
        .filter((s) => notWorking(s) * s.dailyFixed > 0)
        .sort((a, b) => notWorking(b) * b.dailyFixed - notWorking(a) * a.dailyFixed)
        .at(0);
      if (idlest) {
        const amount = notWorking(idlest) * idlest.dailyFixed;
        findings.push({
          id: 'idle_truck',
          text:
            `${idlest.summary.registrationNumber} did not work ${notWorking(idlest)} of ` +
            `${context.days.length} days and still cost ${inr(amount)} in fixed cost.`,
          amount: money(amount),
          tab: 'utilisation',
          vehicleId: idlest.vehicle.id,
          laneKey: null,
        });
      }

      const running = stats.filter((s) => s.km.km > 0);
      const replace = replacementCandidates(
        running.map((s) => ({
          row: s,
          truckTypeKey: `${s.body.key}|${s.size?.key ?? ''}`,
          ageYears: s.ageYears,
          perKm: s.maintenanceCost / s.km.km,
        })),
        NEW_TRUCK_MAX_AGE_YEARS,
        MIN_BENCHMARK_TRUCKS,
      ).at(0);
      if (replace) {
        const amount = replace.extraPerKm * replace.row.km.km;
        findings.push({
          id: 'replacement_candidate',
          text:
            `${replace.row.summary.registrationNumber} costs ${inr(replace.extraPerKm)} more per ` +
            `km to maintain than the youngest trucks of its type, ` +
            `${inr(amount)} over the ${replace.row.km.km.toLocaleString('en-IN')} km it ran.`,
          amount: money(amount),
          tab: 'maintenance',
          vehicleId: replace.row.vehicle.id,
          laneKey: null,
        });
      }

      const expiredNow = stats.filter((s) =>
        currentDatedDocuments(s.vehicle).some((d) => daysBetween(today, d.expiryDate!) < 0),
      );
      if (expiredNow.length > 0) {
        findings.push({
          id: 'expired_documents',
          text:
            `${expiredNow.length} ${expiredNow.length === 1 ? 'truck has' : 'trucks have'} an ` +
            `expired document. They can still be dispatched; renew soon.`,
          amount: null,
          tab: 'compliance',
          vehicleId: expiredNow.length === 1 ? expiredNow[0].vehicle.id : null,
          laneKey: null,
        });
      }

      const jobs = stats.flatMap((s) => s.jobs);
      const maintenanceSpend = sum(jobs, jobCost);
      const unplannedSpend = sum(
        jobs.filter((job) => jobCategory(job) !== 'preventive'),
        jobCost,
      );
      if (maintenanceSpend > 0 && unplannedSpend / maintenanceSpend > 0.5) {
        findings.push({
          id: 'unplanned_maintenance',
          text:
            `Unplanned repairs and breakdowns took ${pct(unplannedSpend, maintenanceSpend)}% of ` +
            `maintenance spend (${inr(unplannedSpend)}); a fleet where unplanned work dominates ` +
            `is not servicing on time.`,
          amount: money(unplannedSpend),
          tab: 'maintenance',
          vehicleId: null,
          laneKey: null,
        });
      }

      const lanes = new Map<string, { label: string; rows: ReturnType<typeof deliveredWithDue> }>();
      for (const row of deliveredWithDue(loadsStarted)) {
        const lane = laneOf(row.load);
        if (!lane) continue;
        const group = lanes.get(lane.key) ?? { label: lane.label, rows: [] };
        group.rows.push(row);
        lanes.set(lane.key, group);
      }
      const worstLane = [...lanes.entries()]
        .filter(([, group]) => group.rows.length >= 2)
        .map(([laneKey, group]) => ({ laneKey, label: group.label, ...onTimeOf(group.rows) }))
        .filter((lane) => lane.pct < 75)
        .sort((a, b) => a.pct - b.pct)
        .at(0);
      if (worstLane) {
        findings.push({
          id: 'late_lane',
          text:
            `${worstLane.label} delivered on time ${worstLane.pct}% of the time ` +
            `(${worstLane.late} of ${worstLane.delivered} loads late).`,
          amount: null,
          tab: 'operations',
          vehicleId: null,
          laneKey: worstLane.laneKey,
        });
      }

      return {
        period: periodView,
        findings: findings
          .sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1))
          .slice(0, FINDINGS_LIMIT),
        ...unavailable(context, {}),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet findings');
    }
  }

  /** Customer and lane narrow loads only (§10); truck-level numbers don't change. */
  private applyLoadFilters(loads: LoadEntity[], filters: FleetAnalyticsFilters): LoadEntity[] {
    return loads.filter((load) => {
      const requisition = load.requisition;
      if (filters.customerId && requisition?.customerId !== filters.customerId) return false;
      if (filters.laneKey && laneOf(load)?.key !== filters.laneKey) return false;
      return true;
    });
  }

  /** The filtered fleet with its per-truck figures over the period, read once per request. */
  private async loadContext(
    tenantId: string,
    filters: FleetAnalyticsFilters,
  ): Promise<FleetContext> {
    const now = new Date();
    const today = toIstDateString(now);
    const period = resolveFleetPeriod(filters.period, filters.from, filters.to, now);
    const days = periodDays(period.fromDate, period.toDate, today);
    const window: TimeWindow = {
      from: period.from,
      to: new Date(Math.min(period.to.getTime(), now.getTime())),
    };

    const scoped = await this.repository.listScopedVehicles(tenantId, filters);
    const vehicles = scoped.filter(
      (vehicle) =>
        (!filters.bodyType || bodyTypeOf(vehicle).key === filters.bodyType) &&
        (!filters.size || sizeOf(vehicle)?.key === filters.size),
    );
    const vehicleIds = vehicles.map((vehicle) => vehicle.id);
    const [jobs, allLoads, points, drivers] = await Promise.all([
      this.repository.listJobsOverlapping(tenantId, vehicleIds, period),
      this.repository.listLoadsInWindow(tenantId, vehicleIds, period, {}),
      this.odometerPoints(tenantId, vehicles, now),
      this.repository.listActiveDrivers(tenantId),
    ]);

    // Driver salaries (§7): charged to the assigned truck; drivers with no truck to the fleet.
    const salaryByVehicle = new Map<string, number>();
    let unassignedMonthlySalary = 0;
    for (const relation of drivers) {
      const salary = fixedMonthlySalary(relation);
      const vehicleId = assignedVehicleId(relation);
      if (vehicleId) salaryByVehicle.set(vehicleId, (salaryByVehicle.get(vehicleId) ?? 0) + salary);
      else unassignedMonthlySalary += salary;
    }

    const loadsInPeriod = allLoads.filter((load) => {
      const interval = onLoadInterval(load, now);
      return interval !== null && overlapDays(interval.from, interval.to, window) > 0;
    });
    const jobsByVehicle = groupBy(jobs, (job) => job.vehicleId);
    const loadsByVehicle = groupBy(loadsInPeriod, (load) => load.vehicleId!);

    const stats = vehicles.map((vehicle): VehicleStats => {
      const vehicleJobs = jobsByVehicle.get(vehicle.id) ?? [];
      const vehicleLoads = loadsByVehicle.get(vehicle.id) ?? [];
      const driverSalary = salaryByVehicle.get(vehicle.id) ?? 0;
      const fixed = fixedCostOver(vehicle, driverSalary, days);
      const periodJobs = vehicleJobs.filter(
        (job) => job.openedAt >= period.from && job.openedAt <= period.to && isCountedJob(job),
      );
      const vehiclePoints = points.get(vehicle.id) ?? [];

      return {
        vehicle,
        summary: toFleetVehicleSummary(vehicle),
        body: bodyTypeOf(vehicle),
        size: sizeOf(vehicle),
        driverSalary,
        buckets: dayBuckets(
          days,
          vehicleLoads.flatMap((load) => onLoadInterval(load, now) ?? []),
          vehicleJobs.map((job) => jobInterval(job, now)),
        ),
        fixed,
        dailyFixed: days.length ? fixed.total / days.length : 0,
        currentDailyFixed: dailyFixedCost(vehicle, driverSalary, today).total,
        jobs: periodJobs,
        maintenanceCost: sum(periodJobs, jobCost),
        downtimeDays: sum(vehicleJobs, (job) =>
          downtimeDaysInWindow(job.openedAt, job.closedAt, window, now),
        ),
        ageYears: vehicleAgeYears(vehicle, today),
        loads: vehicleLoads,
        points: vehiclePoints,
        km: kmInWindow(vehiclePoints, window),
      };
    });

    const loads = this.applyLoadFilters(loadsInPeriod, filters);
    const context: FleetContext = {
      filters,
      period,
      periodView: {
        from: period.fromDate,
        to: period.toDate,
        days: days.length,
        label: period.label,
      },
      days,
      window,
      now,
      today,
      stats,
      loads,
      loadsStarted: loads.filter((load) => isWithin(loadDeparture(load), window)),
      drivers,
      unassignedMonthlySalary,
      unassignedSalaryCost: (unassignedMonthlySalary / DAYS_PER_MONTH) * days.length,
      emptyBecause: null,
    };
    context.emptyBecause = await this.emptyBecause(tenantId, context, scoped);
    return context;
  }

  /**
   * An empty slice is an answer, not an error — but say which filter emptied it. For an empty
   * fleet, the narrowest vehicle filter whose removal brings trucks back; for trucks with no
   * loads under a lane or customer filter, that filter.
   */
  private async emptyBecause(
    tenantId: string,
    context: FleetContext,
    scoped: VehicleEntity[],
  ): Promise<FleetEmptyBecause | null> {
    const { filters } = context;
    if (context.stats.length === 0) {
      if (filters.size && scoped.some((v) => bodyTypeOf(v).key === filters.bodyType)) {
        return 'size';
      }
      if ((filters.bodyType || filters.size) && scoped.length > 0) return 'bodyType';
      if (filters.vehicleId) {
        const count = await this.repository.countScopedVehicles(tenantId, {
          heldAs: filters.heldAs,
        });
        if (count > 0) return 'vehicleId';
      }
      if (filters.heldAs !== 'owned_and_attached') {
        const count = await this.repository.countScopedVehicles(tenantId, {
          heldAs: 'owned_and_attached',
          vehicleId: filters.vehicleId,
        });
        if (count > 0) return 'heldAs';
      }
      return null;
    }
    if (context.loads.length === 0) {
      if (filters.laneKey) return 'laneKey';
      if (filters.customerId) return 'customerId';
    }
    return null;
  }

  /** Every dated odometer reading per truck, plus the last service and the current odometer on
   *  the truck record — km run in any window is read off these (§3, recorded readings). */
  private async odometerPoints(
    tenantId: string,
    vehicles: VehicleEntity[],
    now: Date,
  ): Promise<Map<string, OdometerPoint[]>> {
    const readings = await this.repository.listOdometerReadings(
      tenantId,
      vehicles.map((vehicle) => vehicle.id),
      now,
    );
    const points = new Map<string, OdometerPoint[]>();
    const add = (vehicleId: string, at: Date | string, km: number) => {
      const date = typeof at === 'string' ? startOfIstDate(at) : at;
      if (date > now) return;
      points.set(vehicleId, [...(points.get(vehicleId) ?? []), { at: date, km }]);
    };

    for (const reading of readings) add(reading.vehicleId, reading.at, reading.km);
    for (const vehicle of vehicles) {
      const usage = vehicle.serviceUsage;
      if (usage?.lastServiceDate && usage.lastServiceOdometerKm != null) {
        add(vehicle.id, usage.lastServiceDate, usage.lastServiceOdometerKm);
      }
      if (usage?.odometerKm != null) add(vehicle.id, now, usage.odometerKm);
    }
    return points;
  }
}
