import { rethrow } from '../../../shared/errors';
import { endOfIstDate, startOfIstDate, toIstDateString } from '../../../shared/utils/ist-time';
import { VehicleEntity } from '../../masters/vehicle/entities/vehicle.entity';
import { MaintenanceJobEntity } from '../../maintenance/entities/maintenance-job.entity';
import { LoadEntity } from '../../loads/entities/load.entity';
import { downtimeDaysInWindow, money } from '../../maintenance/calculations/downtime';
import { daysBetween, msToDays, round } from '../../maintenance/calculations/dates';
import { computeTyreWear } from '../../maintenance/calculations/tyre-wear';
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
  FleetDocumentCounts,
  FleetEmptyBecause,
  FleetFinding,
  FleetLaneAmount,
  FleetLaneOnTimeRow,
  FleetTruckUtilisationRow,
  FleetVehicleSummary,
} from './utils/fleet-analytics.interface';
import {
  DOCUMENT_LABELS,
  FINDINGS_LIMIT,
  FLEET_ANALYTICS_HELD_AS,
  HELD_AS_LABELS,
  LEAST_USED_TRUCKS_LIMIT,
  LOAD_STAGES,
  MIN_BENCHMARK_TRUCKS,
  NEW_TRUCK_MAX_AGE_YEARS,
  RENEW_THIS_WEEK_LIMIT,
  REPLACEMENT_CANDIDATES_LIMIT,
  TYRE_PAST_LIFE_LEFT_PCT,
  UNAVAILABLE_REASONS,
  UnavailableKey,
} from './utils/fleet-analytics.constants';
import { FleetPeriod, resolveFleetPeriod } from './utils/fleet-analytics.period';
import {
  StandingCost,
  TimeWindow,
  activeWindow,
  blockedDaysInWindow,
  currentDatedDocuments,
  documentBucket,
  hoursBetween,
  intersect,
  isCountedJob,
  isOnTime,
  istMonth,
  jobCategory,
  jobCost,
  kmInWindow,
  laneOf,
  laneOfRequisition,
  lateDays,
  loadInterval,
  loadStart,
  median,
  monthlyEmiAndLease,
  OdometerPoint,
  overlapDays,
  pct,
  perKm,
  promisedBy,
  replacementCandidates,
  standingCostIn,
  toFleetVehicleSummary,
  tyreCondition,
  unionDaysInWindow,
  vehicleAgeYears,
} from './utils/fleet-analytics.calculations';
import { VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY } from '../../masters/vehicle/vehicle.type';

/** One truck's figures over the period — every tab builds from these rows. */
interface VehicleStats {
  vehicle: VehicleEntity;
  summary: FleetVehicleSummary;
  active: TimeWindow;
  activeDays: number;
  /**
   * The active days split by why (§6.9): on a load first, then the workshop, then blocked on an
   * expired paper; whatever is left the truck stood. The four always add up to activeDays.
   */
  onLoadDays: number;
  workshopDays: number;
  blockedDays: number;
  standingDays: number;
  /** Days jobs kept the truck off the road, whether or not it was also on a load. */
  downtimeDays: number;
  /** Standing cost over the active window, by head. */
  standing: StandingCost;
  /** Average standing cost per active day — what each idle/workshop/blocked day carried. */
  perDay: number;
  /** Standing cost per day as of today — for "what it costs while the paper is out". */
  currentPerDay: number;
  /** Counted jobs opened inside the period. */
  jobs: MaintenanceJobEntity[];
  /** All counted job cost, tyres included. */
  maintenanceCost: number;
  ageYears: number | null;
  /** Loads the truck was on during the period. */
  loads: LoadEntity[];
  points: OdometerPoint[];
  km: { km: number; estimated: boolean };
}

interface FleetContext {
  filters: FleetAnalyticsFilters;
  period: FleetPeriod;
  periodView: FleetAnalyticsPeriodView;
  now: Date;
  today: string;
  stats: VehicleStats[];
  /** Every load in `stats`, flattened. */
  loads: LoadEntity[];
  emptyBecause: FleetEmptyBecause | null;
}

const ON_THE_ROAD_STATUSES = ['in_transit'];

const PARTIAL_COST_NOTE =
  'Built from standing and maintenance cost only. ' +
  [UNAVAILABLE_REASONS.fuel, UNAVAILABLE_REASONS.tolls, UNAVAILABLE_REASONS.driverPay].join(' ');

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function average(values: number[]): number {
  return values.length ? sum(values, (value) => value) / values.length : 0;
}

function roundOrNull(value: number | null, digits = 1): number | null {
  return value === null ? null : round(value, digits);
}

function inr(amount: number): string {
  return `₹${Math.round(amount).toLocaleString('en-IN')}`;
}

/** What a truck cost over the period: standing plus maintenance. */
function vehicleCost(s: VehicleStats): number {
  return s.standing.total + s.maintenanceCost;
}

/** Total cost and km over the trucks whose km could be read — the per-km figures divide one by
 *  the other, so a truck with no km never inflates the cost side. */
function costOverKm(rows: VehicleStats[], cost: (s: VehicleStats) => number) {
  const running = rows.filter((s) => s.km.km > 0);
  const km = sum(running, (s) => s.km.km);
  return {
    perKm: perKm(sum(running, cost), km),
    km,
    vehicles: running.length,
    estimated: running.some((s) => s.km.estimated),
  };
}

function isWithin(at: Date | null, window: TimeWindow): at is Date {
  return at !== null && at >= window.from && at <= window.to;
}

/** Loads loaded in the period — the base of loads moved, tonnes and trips (§6.3). */
function loadedInPeriod(context: FleetContext): LoadEntity[] {
  return context.loads.filter((load) => isWithin(loadStart(load), context.period));
}

/** Loads delivered in the period with a promise to judge them against. */
function deliveredInPeriod(loads: LoadEntity[], period: TimeWindow) {
  return loads.flatMap((load) => {
    const promised = promisedBy(load);
    if (!isWithin(load.deliveredAt, period) || !promised) return [];
    return [{ load, deliveredAt: load.deliveredAt, promised }];
  });
}

function onTimeOf(delivered: ReturnType<typeof deliveredInPeriod>) {
  const late = delivered.filter((row) => !isOnTime(row.deliveredAt, row.promised));
  return {
    pct: pct(delivered.length - late.length, delivered.length),
    late: late.length,
    delivered: delivered.length,
    medianLateDays: roundOrNull(median(late.map((row) => lateDays(row.deliveredAt, row.promised)))),
  };
}

function tonnesOf(loads: LoadEntity[]): number {
  return sum(loads, (load) => Number(load.plannedCapacityTonnes ?? 0));
}

/** Days from the plant to delivery, per delivered load. */
function turnaroundDaysOf(loads: LoadEntity[]): number[] {
  return loads.flatMap((load) => {
    const start = loadStart(load);
    return start && load.deliveredAt && load.deliveredAt > start
      ? [msToDays(load.deliveredAt.getTime() - start.getTime())]
      : [];
  });
}

function loadingHoursOf(loads: LoadEntity[]): number[] {
  return loads.flatMap((load) => {
    const hours = hoursBetween(load.atPlantAt, load.inTransitAt ?? load.loadingConfirmedAt);
    return hours === null ? [] : [hours];
  });
}

function unloadingHoursOf(loads: LoadEntity[]): number[] {
  return loads.flatMap((load) => {
    const hours = hoursBetween(load.reachedDeliveryPointAt, load.deliveredAt);
    return hours === null ? [] : [hours];
  });
}

/** Where a load sits on the "Where the loads are" chart. */
function stageOf(load: LoadEntity): (typeof LOAD_STAGES)[number] {
  switch (load.status) {
    case 'created':
      return 'created';
    case 'assigned':
      return 'assigned';
    case 'at_plant':
      return 'at_loading_point';
    case 'loading_confirmed':
      return 'loaded';
    case 'in_transit':
      return 'in_transit';
    case 'reached_delivery_point':
      return 'reached_delivery';
    case 'delivered':
      return load.podStatus === 'accepted' ? 'pod_received' : 'unloaded';
    case 'closed':
      return 'closed';
  }
}

/** Standing cost of the truck-days spent on each lane's loads in the period. */
function costByLaneOf(context: FleetContext): FleetLaneAmount[] {
  const lanes = new Map<string, FleetLaneAmount>();
  for (const s of context.stats) {
    for (const load of s.loads) {
      const lane = laneOf(load);
      const interval = loadInterval(load, context.now);
      if (!lane || !interval || !isWithin(loadStart(load), context.period)) continue;
      const row = lanes.get(lane.key) ?? { lane: lane.label, laneKey: lane.key, loads: 0, cost: 0 };
      row.loads += 1;
      row.cost += overlapDays(interval.from, interval.to, s.active) * s.perDay;
      lanes.set(lane.key, row);
    }
  }
  return [...lanes.values()]
    .map((row) => ({ ...row, cost: money(row.cost) }))
    .sort((a, b) => b.cost - a.cost);
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
  if (context.filters.yardId) reasons.yardId = UNAVAILABLE_REASONS.yard;
  return { unavailable: reasons, emptyBecause: context.emptyBecause };
}

export class FleetAnalyticsService {
  constructor(private readonly repository: FleetAnalyticsRepository) {}

  async getFilters(tenantId: string): Promise<FleetAnalyticsFilterOptions> {
    try {
      const [truckTypes, customers, vehicles, requisitions] = await Promise.all([
        this.repository.listTruckTypes(tenantId),
        this.repository.listCustomers(tenantId),
        this.repository.listVehicleOptions(tenantId),
        this.repository.listRequisitionLanes(tenantId),
      ]);
      const lanes = new Map<string, string>();
      for (const requisition of requisitions) {
        const lane = laneOfRequisition(requisition);
        if (lane) lanes.set(lane.key, lane.label);
      }
      return {
        periods: [
          { value: 'last_month', label: 'Last month' },
          { value: '3_months', label: '3 months' },
          { value: '6_months', label: '6 months' },
          { value: 'custom', label: 'Custom Range' },
        ],
        truckClasses: truckTypes.map((type) => ({ id: type.id, name: type.name })),
        heldAs: FLEET_ANALYTICS_HELD_AS.map((value) => ({ value, label: HELD_AS_LABELS[value] })),
        yards: [],
        customers: customers.map((customer) => ({ id: customer.id, name: customer.name })),
        vehicles: vehicles.map((vehicle) => ({ id: vehicle.id, name: vehicle.registrationNumber })),
        lanes: [...lanes.entries()]
          .map(([id, name]) => ({ id, name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
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
      const { periodView, stats } = context;
      const onRoad = sum(stats, (s) => s.maintenanceCost);
      const standing = sum(stats, (s) => s.standing.total);
      const truckDays = sum(stats, (s) => s.activeDays);
      const workingDays = sum(stats, (s) => s.onLoadDays);
      const allIn = costOverKm(stats, vehicleCost);

      return {
        period: periodView,
        vehicles: stats.length,
        costPerKm: {
          value: allIn.perKm,
          distanceKm: allIn.km,
          vehicles: allIn.vehicles,
          estimated: allIn.estimated,
        },
        fleetCost: {
          total: money(onRoad + standing),
          onRoad: money(onRoad),
          standing: money(standing),
        },
        costPerTonneKm: {
          value: 0,
          tonnes: round(tonnesOf(loadedInPeriod(context)), 1),
          distanceKm: 0,
        },
        utilisation: {
          pct: pct(workingDays, truckDays),
          workingDays: Math.round(workingDays),
          truckDays: Math.round(truckDays),
        },
        ...unavailable(context, {
          costPerKm: PARTIAL_COST_NOTE,
          costPerTonneKm: 'distancePerLoad',
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
      const { period, periodView, stats, today } = context;
      const openJobs = await this.repository.listOpenJobs(
        tenantId,
        stats.map((s) => s.vehicle.id),
      );

      const expiredVehicles = new Set(
        stats
          .filter((s) =>
            currentDatedDocuments(s.vehicle).some((d) => daysBetween(today, d.expiryDate!) < 0),
          )
          .map((s) => s.vehicle.id),
      );
      const inWorkshop = new Set(openJobs.map((job) => job.vehicleId));
      const outOfService = new Set([...expiredVehicles, ...inWorkshop]);

      const standingDays = sum(stats, (s) => s.standingDays);
      const idleCost = sum(stats, (s) => s.standingDays * s.perDay);

      const costBuildUp = period.months.map((month) => {
        const maintenance = sum(stats, (s) =>
          sum(
            s.jobs.filter((job) => istMonth(job.openedAt) === month.month),
            jobCost,
          ),
        );
        const fixed = sum(
          stats,
          (s) => standingCostIn(s.vehicle, intersect(s.active, month)).total,
        );
        const km = sum(stats, (s) => kmInWindow(s.points, intersect(s.active, month)).km);
        return {
          month: month.month,
          fuelAndEnergy: 0,
          tolls: 0,
          driver: 0,
          maintenance: money(maintenance),
          otherHireAndChallans: 0,
          fixed: money(fixed),
          total: money(maintenance + fixed),
          km,
        };
      });

      const loaded = loadedInPeriod(context);
      const tonnes = tonnesOf(loaded);
      const fleetCost = sum(stats, vehicleCost);
      const onTime = onTimeOf(deliveredInPeriod(context.loads, period));

      const own = stats.filter((s) => s.vehicle.ownershipType !== 'attached');
      const attached = stats.filter((s) => s.vehicle.ownershipType === 'attached');
      const ownershipCost = (rows: VehicleStats[]) => {
        const over = costOverKm(rows, vehicleCost);
        return { cost: money(sum(rows, vehicleCost)), distanceKm: over.km, perKm: over.perKm };
      };

      return {
        period: periodView,
        loads: {
          carried: loaded.length,
          perMonth: round(loaded.length / Math.max(1, period.months.length), 1),
        },
        tonnes: {
          moved: round(tonnes, 1),
          costPerTonne: tonnes > 0 ? money(fleetCost / tonnes) : 0,
        },
        tripsPerVehicle: {
          value: stats.length ? round(loaded.length / stats.length, 1) : 0,
          vehicles: stats.length,
        },
        onTime: { pct: onTime.pct, late: onTime.late, delivered: onTime.delivered },
        complianceExpired: { vehicles: expiredVehicles.size },
        trucksInService: { count: stats.length - outOfService.size, of: stats.length },
        openBreakdowns: { count: openJobs.filter((job) => job.jobType === 'breakdown').length },
        idleStandingCost: {
          amount: money(idleCost),
          idleDays: Math.round(standingDays),
          perDay: standingDays > 0 ? money(idleCost / standingDays) : 0,
        },
        monthlyCost: costBuildUp.map((point) => ({
          month: point.month,
          totalCost: point.total,
          costPerKm: perKm(point.total, point.km),
        })),
        costBuildUp: costBuildUp.map(({ km: _km, ...point }) => point),
        ownedVsAttached: {
          own: ownershipCost(own),
          attached: ownershipCost(attached),
          hirePaidOut: { amount: 0, vendors: 0 },
          tripsOverClassRate: { count: 0, total: 0, pct: 0 },
        },
        costByLane: costByLaneOf(context),
        ...unavailable(context, {
          'costBuildUp.fuelAndEnergy': 'fuel',
          'costBuildUp.tolls': 'tolls',
          'costBuildUp.driver': 'driverPay',
          'costBuildUp.otherHireAndChallans': 'hire',
          'monthlyCost.costPerKm': PARTIAL_COST_NOTE,
          'ownedVsAttached.hirePaidOut': 'hire',
          'ownedVsAttached.tripsOverClassRate': 'hire',
          costByLane:
            'Standing cost of the truck-days spent on each lane only. ' + UNAVAILABLE_REASONS.fuel,
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
      const { period, periodView, stats } = context;
      const truckDays = sum(stats, (s) => s.activeDays);
      const bucket = (pick: (s: VehicleStats) => number) => {
        const days = sum(stats, pick);
        const fixedCost = sum(stats, (s) => pick(s) * s.perDay);
        return { days: Math.round(days), pct: pct(days, truckDays), fixedCost: money(fixedCost) };
      };
      const onLoad = bucket((s) => s.onLoadDays);
      const standing = bucket((s) => s.standingDays);
      const workshop = bucket((s) => s.workshopDays);
      const blocked = bucket((s) => s.blockedDays);

      const loaded = loadedInPeriod(context);
      const loadedIds = new Set(loaded.map((load) => load.id));
      const tripsOf = (s: VehicleStats) => s.loads.filter((load) => loadedIds.has(load.id)).length;
      const capacityOf = new Map(
        stats.map((s) => [s.vehicle.id, Number(s.vehicle.capacityTons ?? 0)]),
      );
      const withCapacity = loaded.filter((load) => (capacityOf.get(load.vehicleId!) ?? 0) > 0);
      const tonnes = tonnesOf(loaded);
      const delivered = loaded.filter((load) => isWithin(load.deliveredAt, period));

      const fleetUtilisation = pct(
        sum(stats, (s) => s.onLoadDays),
        truckDays,
      );
      const utilisationOf = (s: VehicleStats) => pct(s.onLoadDays, s.activeDays);

      const leastUsedTrucks: FleetTruckUtilisationRow[] = stats
        .map((s) => ({
          vehicle: s.summary,
          onLoadDays: Math.round(s.onLoadDays),
          idleDays: Math.round(s.standingDays),
          workshopDays: Math.round(s.workshopDays),
          blockedDays: Math.round(s.blockedDays),
          utilisationPct: utilisationOf(s),
          idleCost: money(s.standingDays * s.perDay),
          workshopCost: money(s.workshopDays * s.perDay),
          blockedCost: money(s.blockedDays * s.perDay),
        }))
        .sort((a, b) => a.utilisationPct - b.utilisationPct || b.idleCost - a.idleCost)
        .slice(0, LEAST_USED_TRUCKS_LIMIT);

      const loadingHours = median(loadingHoursOf(delivered));
      const unloadingHours = median(unloadingHoursOf(delivered));

      return {
        period: periodView,
        capacityUsed: {
          pct: pct(
            tonnesOf(withCapacity),
            sum(withCapacity, (load) => capacityOf.get(load.vehicleId!) ?? 0),
          ),
          standingTruckDays: standing.days + workshop.days + blocked.days,
        },
        loadedShareOfDistance: { pct: 0, emptyKm: 0 },
        deadRunningCost: { amount: 0, pctOfVariable: 0 },
        trucksBelowHalfAverage: {
          count:
            fleetUtilisation > 0
              ? stats.filter((s) => utilisationOf(s) < fleetUtilisation / 2).length
              : 0,
        },
        tripsPerVehicle: stats.length ? round(loaded.length / stats.length, 1) : 0,
        tonnesMoved: {
          tonnes: round(tonnes, 1),
          perLoad: loaded.length ? round(tonnes / loaded.length, 1) : 0,
        },
        turnaroundDays: round(median(turnaroundDaysOf(delivered)) ?? 0, 1),
        loadingPlusUnloadingHours: round((loadingHours ?? 0) + (unloadingHours ?? 0), 1),
        days: {
          truckDays: Math.round(truckDays),
          onLoad,
          standing,
          workshop,
          blockedOnPaper: blocked,
        },
        leastUsedTrucks,
        workingDayHours: {
          moving: 0,
          atGate: 0,
          heldPastFreeHours: 0,
          waitingCityNoEntry: 0,
          driverResting: 0,
          stoppedBrokenDown: 0,
        },
        idleDaysByTrips: stats
          .map((s) => ({
            vehicle: s.summary,
            trips: tripsOf(s),
            distanceKm: s.km.km,
            downtimeDays: round(s.downtimeDays, 1),
            net: null,
          }))
          .sort((a, b) => a.trips - b.trips || b.downtimeDays - a.downtimeDays)
          .slice(0, LEAST_USED_TRUCKS_LIMIT),
        emptyRunningByLane: [],
        plannedVsActual: {
          months: period.months.map((month) => ({ month: month.month, overPct: 0 })),
          plannedKm: 0,
          actualKm: 0,
          overPct: 0,
          extraEnergyCost: 0,
        },
        ...unavailable(context, {
          loadedShareOfDistance: 'emptyRunning',
          deadRunningCost: 'emptyRunning',
          emptyRunningByLane: 'emptyRunning',
          workingDayHours: 'workingDayHours',
          plannedVsActual: 'distancePerLoad',
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
      const { periodView, stats, today } = context;

      const standingOf = (pick: (standing: StandingCost) => number) =>
        money(sum(stats, (s) => pick(s.standing)));
      const standing = sum(stats, (s) => s.standing.total);
      const otherFixed = standingOf((p) => p.otherFixed);

      // The heads the screen lists. Other fixed cost (fixed_cost_monthly as entered, which
      // already bundles EMI and insurance) only appears when some truck carries it — without it
      // the heads would not add up to the headline.
      const heads: { head: FleetCostHead; label: string; amount: number }[] = [
        { head: 'fuel_and_energy', label: 'Fuel and energy', amount: 0 },
        { head: 'attached_truck_hire', label: 'Attached-truck hire', amount: 0 },
        { head: 'emi_and_lease', label: 'EMI and lease', amount: standingOf((p) => p.emiAndLease) },
        { head: 'depreciation', label: 'Depreciation', amount: 0 },
        { head: 'empty_running', label: 'Empty running', amount: 0 },
        {
          head: 'maintenance_and_tyres',
          label: 'Maintenance and tyres',
          amount: money(sum(stats, (s) => s.maintenanceCost)),
        },
        { head: 'tolls_and_fastag', label: 'Tolls and FASTag', amount: 0 },
        {
          head: 'insurance_and_permits',
          label: 'Insurance and permits',
          amount: standingOf((p) => p.insurance),
        },
        { head: 'driver_wages_and_bhatta', label: 'Driver wages and bhatta', amount: 0 },
        ...(otherFixed > 0
          ? [{ head: 'other_fixed_cost' as const, label: 'Other fixed cost', amount: otherFixed }]
          : []),
      ];
      const costByHead = heads.sort((a, b) => b.amount - a.amount);
      const headsTotal = money(sum(costByHead, (head) => head.amount));
      const headlineTotal = money(sum(stats, vehicleCost));
      const standingOnLoads = sum(stats, (s) => s.onLoadDays * s.perDay);
      const idleTruckDays = sum(stats, (s) => s.standingDays + s.workshopDays + s.blockedDays);

      const byClass = new Map<
        string,
        { truckTypeId: string | null; name: string; rows: VehicleStats[] }
      >();
      for (const s of stats) {
        const key = s.vehicle.truckTypeId ?? 'unclassified';
        const group = byClass.get(key) ?? {
          truckTypeId: s.vehicle.truckTypeId,
          name: s.vehicle.truckType?.name ?? 'Unclassified',
          rows: [],
        };
        group.rows.push(s);
        byClass.set(key, group);
      }

      const basis = { fixedCostMonthly: 0, emiLeaseInsurance: 0, none: 0 };
      for (const { vehicle } of stats) {
        const meta = vehicle.telemetryMeta;
        if (vehicle.ownershipType === 'attached' || !meta || meta.deletedAt) basis.none += 1;
        else if (meta.fixedCostMonthly !== null) basis.fixedCostMonthly += 1;
        else basis.emiLeaseInsurance += 1;
      }

      const emiTrucks = stats.filter((s) => monthlyEmiAndLease(s.vehicle, today) > 0);
      const allIn = costOverKm(stats, vehicleCost);
      const loaded = loadedInPeriod(context);

      return {
        period: periodView,
        costPerKm: allIn.perKm,
        onRoadPerKm: costOverKm(stats, (s) => s.maintenanceCost).perKm,
        standingPerKm: costOverKm(stats, (s) => s.standing.total).perKm,
        distanceKm: allIn.km,
        costPerTonneKm: {
          value: 0,
          avgLoadTonnes: loaded.length ? round(tonnesOf(loaded) / loaded.length, 1) : 0,
        },
        energyPerKm: { value: 0, spent: 0 },
        tollsPerKm: { value: 0, spent: 0 },
        emiAndLease: {
          monthly: money(sum(emiTrucks, (s) => monthlyEmiAndLease(s.vehicle, today))),
          trucks: emiTrucks.length,
        },
        costByHead,
        standingBreakdown: {
          emiAndLease: standingOf((p) => p.emiAndLease),
          insurance: standingOf((p) => p.insurance),
          otherFixed,
        },
        fixedCostBasis: basis,
        totalCost: headsTotal,
        reconciliation: {
          headsTotal,
          headlineTotal,
          difference: money(headlineTotal - headsTotal),
          note:
            `Standing cost covers every truck for every day of the period, including ` +
            `${Math.round(idleTruckDays)} truck-days spent idle, in the workshop or blocked on ` +
            `papers. Only ${inr(standingOnLoads)} of the ${inr(standing)} standing cost fell on ` +
            `days a truck was on a load; the rest is the cost of not working.`,
        },
        costByLane: costByLaneOf(context).map((row) => ({ ...row, perKm: null })),
        costByClass: [...byClass.values()]
          .map((group) => {
            const over = costOverKm(group.rows, vehicleCost);
            return {
              truckTypeId: group.truckTypeId,
              name: group.name,
              vehicles: group.rows.length,
              cost: money(sum(group.rows, vehicleCost)),
              distanceKm: over.km,
              perKm: over.perKm,
            };
          })
          .sort((a, b) => b.cost - a.cost),
        costByTruck: stats
          .map((s) => ({
            vehicle: s.summary,
            cost: money(vehicleCost(s)),
            distanceKm: s.km.km,
            kmEstimated: s.km.estimated,
            perKm: perKm(vehicleCost(s), s.km.km),
          }))
          .sort((a, b) => b.cost - a.cost),
        ...unavailable(context, {
          costPerKm: PARTIAL_COST_NOTE,
          'costByHead.fuel_and_energy': 'fuel',
          'costByHead.attached_truck_hire': 'hire',
          'costByHead.depreciation': 'onRoadPrice',
          'costByHead.empty_running': 'emptyRunning',
          'costByHead.tolls_and_fastag': 'tolls',
          'costByHead.driver_wages_and_bhatta': 'driverPay',
          'costByHead.insurance_and_permits': 'permitsAllowance',
          energyPerKm: 'fuel',
          tollsPerKm: 'tolls',
          costPerTonneKm: 'distancePerLoad',
          'costByLane.perKm': 'distancePerLoad',
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

      const countBy = (key: (s: VehicleStats) => string) => {
        const counts = new Map<string, VehicleStats[]>();
        for (const s of stats) counts.set(key(s), [...(counts.get(key(s)) ?? []), s]);
        return counts;
      };
      const byFuel = countBy((s) => s.vehicle.fuelType ?? 'unknown');
      const byClass = countBy((s) => s.vehicle.truckTypeId ?? 'unclassified');

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
        byPowertrain: [...byFuel.entries()].map(([fuelType, rows]) => ({
          fuelType,
          vehicles: rows.length,
          costPerKm: 0,
        })),
        offBenchmark: [],
        byClass: [...byClass.values()].map((rows) => ({
          truckTypeId: rows[0].vehicle.truckTypeId,
          name: rows[0].vehicle.truckType?.name ?? 'Unclassified',
          vehicles: rows.length,
          costPerKm: 0,
        })),
        byLane: [],
        ...unavailable(context, { '*': 'fuel', byLane: 'distancePerLoad' }),
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
      const { period, periodView, stats, today } = context;
      const tyres = await this.repository.listFittedTyres(
        tenantId,
        stats.map((s) => s.vehicle.id),
      );

      const jobs = stats.flatMap((s) => s.jobs);
      const planned = jobs.filter((job) => jobCategory(job) === 'preventive').length;
      const breakdowns = jobs.filter((job) => job.jobType === 'breakdown').length;
      const spend = sum(jobs, jobCost);

      const aged = stats.filter((s) => s.ageYears !== null);
      const withOdometer = stats.filter((s) => s.vehicle.serviceUsage?.odometerKm != null);

      const running = stats.filter((s) => s.km.km > 0);
      const totalKm = sum(running, (s) => s.km.km);
      const perKmOf = (s: VehicleStats) => (s.km.km > 0 ? s.maintenanceCost / s.km.km : 0);

      const statsById = new Map(stats.map((s) => [s.vehicle.id, s]));
      const tyreLeft = new Map<string, number[]>();
      let tyresPastLife = 0;
      for (const { tyre, reading } of tyres) {
        const wear = computeTyreWear({
          originalTreadMm: Number(tyre.originalTreadMm),
          fittedAt: tyre.fittedAt,
          fittedOdometerKm: tyre.fittedOdometerKm,
          vehicleOdometerKm:
            statsById.get(tyre.vehicleId)?.vehicle.serviceUsage?.odometerKm ?? null,
          latestReading: reading
            ? {
                treadMm: Number(reading.treadMm),
                readingDate: reading.readingDate,
                odometerKm: reading.odometerKm,
              }
            : null,
          retreadCount: tyre.retreadCount,
          maxRetreads: tyre.maxRetreads,
          casingCondition: tyre.casingCondition,
          today,
        });
        if (wear.usableTreadLeftPct <= TYRE_PAST_LIFE_LEFT_PCT) tyresPastLife += 1;
        tyreLeft.set(tyre.vehicleId, [
          ...(tyreLeft.get(tyre.vehicleId) ?? []),
          wear.usableTreadLeftPct,
        ]);
      }

      // Money per truck is only built for a seat that may see it; the km stay for everybody.
      const costFields = (s: VehicleStats) =>
        canSeeCosts ? { cost: money(s.maintenanceCost), perKm: money(perKmOf(s)) } : {};
      const worstPerKmFirst = (a: VehicleStats, b: VehicleStats) =>
        perKmOf(b) - perKmOf(a) || b.maintenanceCost - a.maintenanceCost;

      const plannedVsUnplanned = period.months.map((month) => {
        const inMonth = jobs.filter((job) => istMonth(job.openedAt) === month.month);
        const rowsOf = (category: string) => inMonth.filter((job) => jobCategory(job) === category);
        const valueOf = (category: string) => {
          const rows = rowsOf(category);
          return canSeeCosts ? money(sum(rows, jobCost)) : rows.length;
        };
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
          km: totalKm,
          vehicles: running.length,
          estimated: running.some((s) => s.km.estimated),
        },
        preventiveShare: { pct: pct(planned, jobs.length), planned, total: jobs.length },
        downtime: {
          days: round(
            sum(stats, (s) => s.downtimeDays),
            1,
          ),
          trucks: stats.filter((s) => s.downtimeDays > 0).length,
        },
        meanDistanceBetweenFailures: {
          km: breakdowns > 0 ? Math.round(totalKm / breakdowns) : null,
          breakdowns,
        },
        averageFleetAge: {
          years: aged.length ? round(sum(aged, (s) => s.ageYears!) / aged.length, 1) : 0,
          vehicles: aged.length,
        },
        lifetimeDistance: {
          km: sum(withOdometer, (s) => s.vehicle.serviceUsage!.odometerKm!),
          vehicles: withOdometer.length,
        },
        tyresPastLife: { positions: tyresPastLife, thresholdPct: 100 - TYRE_PAST_LIFE_LEFT_PCT },
        plannedVsUnplannedUnit: canSeeCosts ? ('amount' as const) : ('count' as const),
        plannedVsUnplanned,
        byVehicle: running
          .filter((s) => s.maintenanceCost > 0)
          .sort(worstPerKmFirst)
          .map((s) => ({
            vehicle: s.summary,
            ageYears: s.ageYears,
            kmRun: s.km.km,
            kmEstimated: s.km.estimated,
            ...costFields(s),
          })),
        tyresByVehicle: stats
          .filter((s) => tyreLeft.has(s.vehicle.id))
          .sort(
            (a, b) =>
              worstPerKmFirst(a, b) ||
              average(tyreLeft.get(a.vehicle.id)!) - average(tyreLeft.get(b.vehicle.id)!),
          )
          .map((s) => {
            const avg = round(average(tyreLeft.get(s.vehicle.id)!), 1);
            return {
              vehicle: s.summary,
              ageYears: s.ageYears,
              tyres: tyreLeft.get(s.vehicle.id)!.length,
              avgTreadLeftPct: avg,
              condition: tyreCondition(avg),
              kmRun: s.km.km,
              kmEstimated: s.km.estimated,
              ...costFields(s),
            };
          }),
        ...unavailable(context, { writtenDownValue: 'onRoadPrice' }),
      };

      if (!canSeeCosts) return workshop;

      return {
        ...workshop,
        downtime: {
          ...workshop.downtime,
          cost: money(sum(stats, (s) => s.downtimeDays * s.perDay)),
        },
        spend: {
          total: money(spend),
          perKm: totalKm > 0 ? money(spend / totalKm) : 0,
          jobs: jobs.length,
        },
        writtenDownValue: { value: null, onRoadValue: null },
        replacementCandidates: replacementCandidates(
          running.map((s) => ({
            row: s,
            truckTypeId: s.vehicle.truckTypeId,
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
      const { period, periodView, now, loads } = context;
      const delivered = deliveredInPeriod(loads, period);
      const deliveredLoads = delivered.map((row) => row.load);
      const onTime = onTimeOf(delivered);

      const onTheRoad = loads.filter((load) => ON_THE_ROAD_STATUSES.includes(load.status));
      const runningBehind = onTheRoad.filter((load) => {
        const promised = promisedBy(load);
        return promised !== null && promised < now;
      });

      const stageCounts = new Map<string, number>(LOAD_STAGES.map((stage) => [stage, 0]));
      for (const load of loads) {
        const stage = stageOf(load);
        stageCounts.set(stage, (stageCounts.get(stage) ?? 0) + 1);
      }

      const lanes = new Map<string, { label: string; rows: typeof delivered }>();
      for (const row of delivered) {
        const lane = laneOf(row.load);
        if (!lane) continue;
        const group = lanes.get(lane.key) ?? { label: lane.label, rows: [] };
        group.rows.push(row);
        lanes.set(lane.key, group);
      }
      const onTimeByLane: FleetLaneOnTimeRow[] = [...lanes.entries()]
        .map(([laneKey, group]) => {
          const committed = group.rows.flatMap(({ load }) => {
            const requisition = load.requisition;
            return requisition?.pickupDate && requisition.expectedDeliveryDate
              ? [daysBetween(requisition.pickupDate, requisition.expectedDeliveryDate)]
              : [];
          });
          const turnaround = turnaroundDaysOf(group.rows.map((row) => row.load));
          return {
            lane: group.label,
            laneKey,
            loads: group.rows.length,
            transitCommittedDays: roundOrNull(median(committed)),
            onTimePct: onTimeOf(group.rows).pct,
            averageTurnaroundDays: turnaround.length ? round(average(turnaround), 1) : null,
          };
        })
        .sort((a, b) => a.onTimePct - b.onTimePct);

      return {
        period: periodView,
        onTime: { pct: onTime.pct, late: onTime.late, delivered: onTime.delivered },
        medianLateDays: onTime.medianLateDays,
        turnaroundDays: round(median(turnaroundDaysOf(deliveredLoads)) ?? 0, 1),
        detention: { hours: 0, loadsPastFreeHours: 0 },
        recoverableDetention: { amount: 0 },
        loadingHours: round(median(loadingHoursOf(deliveredLoads)) ?? 0, 1),
        unloadingHours: round(median(unloadingHoursOf(deliveredLoads)) ?? 0, 1),
        durationAgainstPlan: { pct: 0, extraKm: 0 },
        onTheRoad: { count: onTheRoad.length, runningBehind: runningBehind.length },
        detentionByConsignor: [],
        onTimeByLane,
        loadStages: LOAD_STAGES.map((stage) => ({ stage, count: stageCounts.get(stage) ?? 0 })),
        loadPipeline: {
          onTheRoad: onTheRoad.length,
          runningBehind: runningBehind.length,
          deliveredPodNotIn: loads.filter(
            (load) => load.status === 'delivered' && load.podStatus !== 'accepted',
          ).length,
          podInNotInvoiced: loads.filter(
            (load) => load.podStatus === 'accepted' && load.status !== 'closed',
          ).length,
        },
        drivers: {
          availableToDispatch: 0,
          awayOrOffRoll: 0,
          medianSafetyScore: 0,
          needCoaching: 0,
          onTimePct: 0,
        },
        ...unavailable(context, {
          detention: 'detention',
          recoverableDetention: 'detention',
          detentionByConsignor: 'detention',
          durationAgainstPlan: 'distancePerLoad',
          drivers: 'drivers',
          'loadStages.running_to_loading': 'No load status marks the run to the loading point yet.',
          'loadStages.invoiced': 'No load status marks the goods invoice yet.',
        }),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet operations');
    }
  }

  /** Current state of every paper and licence — the period only echoes back. */
  async getCompliance(
    tenantId: string,
    filters: FleetAnalyticsFilters,
    canSeeCosts: boolean,
  ): Promise<FleetAnalyticsCompliance> {
    try {
      const context = await this.loadContext(tenantId, filters);
      const { periodView, stats, today, loads } = context;
      const [openJobs, drivers] = await Promise.all([
        this.repository.listOpenJobs(
          tenantId,
          stats.map((s) => s.vehicle.id),
        ),
        this.repository.listActiveDrivers(tenantId),
      ]);
      const inWorkshop = new Set(openJobs.map((job) => job.vehicleId));

      const emptyCounts = (): FleetDocumentCounts => ({
        expired: 0,
        inside7Days: 0,
        inside30Days: 0,
        inOrder: 0,
      });
      const position = emptyCounts();
      const byType = new Map(
        VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY.map((type) => [type as string, emptyCounts()]),
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
          if (bucket === 'inside7Days' || bucket === 'inside30Days') {
            soon.documents += 1;
            soon.vehicles.add(s.vehicle.id);
          }
          if (bucket !== 'inOrder') {
            renew.push({
              vehicle: s.summary,
              documentType: document.documentType,
              label: DOCUMENT_LABELS[document.documentType] ?? document.documentType,
              expiryDate: document.expiryDate!,
              daysLeft,
              ...(canSeeCosts ? { standingPerDay: money(s.currentPerDay) } : {}),
            });
          }
        }
        if (allInOrder) vehiclesInOrder += 1;
      }
      const blocked = new Set([...expiredVehicles, ...inWorkshop]);

      const driversOnLoads = new Set(loads.map((load) => load.driverId).filter(Boolean));
      const driverItems = drivers
        .map((relation) => {
          const driver = relation.driver;
          const verification = (driver.verifications ?? [])
            .filter((v) => !v.deletedAt)
            .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            .at(0);
          const validTo = driver.licenseExpiry ?? verification?.validUntil ?? null;
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
            hazmat: false,
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
        blockedFromDispatch: {
          vehicles: blocked.size,
          expiredPaper: expiredVehicles.size,
          inWorkshop: inWorkshop.size,
        },
        expiringIn7Days: { documents: urgent.documents, vehicles: urgent.vehicles.size },
        expiringIn30Days: { documents: soon.documents, vehicles: soon.vehicles.size },
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
          hazmatEndorsed: 0,
          licencesExpired,
          expiringIn30Days: licencesExpiring,
          ranALoadPct: pct(
            driverItems.filter((d) => driversOnLoads.has(d.driverId)).length,
            driverItems.length,
          ),
          items: driverItems,
        },
        ...unavailable(context, {
          'drivers.hazmatEndorsed':
            'Hazmat endorsements are not read from the licence register yet.',
        }),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet compliance');
    }
  }

  /**
   * The three or four things worth acting on (§5.14 Findings), each a plain sentence with the
   * tab holding the evidence, ranked by money at stake over the period.
   */
  async getFindings(
    tenantId: string,
    filters: FleetAnalyticsFilters,
  ): Promise<FleetAnalyticsFindings> {
    try {
      const context = await this.loadContext(tenantId, filters);
      const { periodView, stats, period, loads, today } = context;
      const findings: FleetFinding[] = [];

      const idlest = [...stats]
        .filter((s) => s.standingDays * s.perDay > 0)
        .sort((a, b) => b.standingDays * b.perDay - a.standingDays * a.perDay)
        .at(0);
      if (idlest) {
        const amount = idlest.standingDays * idlest.perDay;
        findings.push({
          id: 'idle_truck',
          text:
            `${idlest.summary.registrationNumber} stood idle ${Math.round(idlest.standingDays)} ` +
            `of ${Math.round(idlest.activeDays)} days and still cost ${inr(amount)} in fixed cost.`,
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
          truckTypeId: s.vehicle.truckTypeId,
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
            `km to maintain than a new truck of its ${replace.benchmarkScope}, ` +
            `${inr(amount)} over the ${replace.row.km.km.toLocaleString('en-IN')} km it ran.`,
          amount: money(amount),
          tab: 'maintenance',
          vehicleId: replace.row.vehicle.id,
          laneKey: null,
        });
      }

      const blockedNow = stats.filter((s) =>
        currentDatedDocuments(s.vehicle).some((d) => daysBetween(today, d.expiryDate!) < 0),
      );
      if (blockedNow.length > 0) {
        const perDay = sum(blockedNow, (s) => s.currentPerDay);
        findings.push({
          id: 'blocked_on_papers',
          text:
            `${blockedNow.length} ${blockedNow.length === 1 ? 'truck is' : 'trucks are'} blocked ` +
            `from dispatch by an expired paper, standing at ${inr(perDay)} a day between them.`,
          amount: money(sum(blockedNow, (s) => s.blockedDays * s.perDay)),
          tab: 'compliance',
          vehicleId: blockedNow.length === 1 ? blockedNow[0].vehicle.id : null,
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

      const lanes = new Map<
        string,
        { label: string; rows: ReturnType<typeof deliveredInPeriod> }
      >();
      for (const row of deliveredInPeriod(loads, period)) {
        const lane = laneOf(row.load);
        if (!lane) continue;
        const group = lanes.get(lane.key) ?? { label: lane.label, rows: [] };
        group.rows.push(row);
        lanes.set(lane.key, group);
      }
      const worstLane = [...lanes.entries()]
        .filter(([, group]) => group.rows.length >= 2)
        .map(([laneKey, group]) => ({ laneKey, label: group.label, ...onTimeOf(group.rows) }))
        .filter((lane) => lane.pct < 80)
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

  /** The filtered fleet with its per-truck figures over the period, read once per request. */
  private async loadContext(
    tenantId: string,
    filters: FleetAnalyticsFilters,
  ): Promise<FleetContext> {
    const now = new Date();
    const today = toIstDateString(now);
    const period = resolveFleetPeriod(filters.period, filters.from, filters.to, now);

    const vehicles = await this.repository.listScopedVehicles(tenantId, filters);
    const vehicleIds = vehicles.map((vehicle) => vehicle.id);
    const [jobs, loads, points] = await Promise.all([
      this.repository.listJobsOverlapping(tenantId, vehicleIds, period),
      this.repository.listLoadsInWindow(tenantId, vehicleIds, period, filters),
      this.odometerPoints(tenantId, vehicles, now),
    ]);
    const jobsByVehicle = groupBy(jobs, (job) => job.vehicleId);
    const loadsByVehicle = groupBy(loads, (load) => load.vehicleId!);

    const todayWindow = { from: startOfIstDate(today), to: endOfIstDate(today) };
    const stats = vehicles.map((vehicle): VehicleStats => {
      const active = activeWindow(vehicle, period, now);
      const activeDays = overlapDays(active.from, active.to, active);
      const vehicleJobs = jobsByVehicle.get(vehicle.id) ?? [];
      const vehicleLoads = (loadsByVehicle.get(vehicle.id) ?? []).filter((load) => {
        const interval = loadInterval(load, now);
        return interval !== null && overlapDays(interval.from, interval.to, period) > 0;
      });

      const onLoadDays = Math.min(
        activeDays,
        unionDaysInWindow(
          vehicleLoads.flatMap((load) => loadInterval(load, now) ?? []),
          active,
        ),
      );
      const downtimeDays = Math.min(
        activeDays,
        sum(vehicleJobs, (job) => downtimeDaysInWindow(job.openedAt, job.closedAt, active, now)),
      );
      const workshopDays = Math.min(activeDays - onLoadDays, downtimeDays);
      const blockedDays = Math.min(
        activeDays - onLoadDays - workshopDays,
        blockedDaysInWindow(vehicle.documents ?? [], active, now),
      );
      const standingDays = Math.max(0, activeDays - onLoadDays - workshopDays - blockedDays);

      const standing = standingCostIn(vehicle, active);
      const periodJobs = vehicleJobs.filter(
        (job) => job.openedAt >= period.from && job.openedAt <= period.to && isCountedJob(job),
      );
      const vehiclePoints = points.get(vehicle.id) ?? [];

      return {
        vehicle,
        summary: toFleetVehicleSummary(vehicle),
        active,
        activeDays,
        onLoadDays,
        workshopDays,
        blockedDays,
        standingDays,
        downtimeDays,
        standing,
        perDay: activeDays > 0 ? standing.total / activeDays : 0,
        currentPerDay: standingCostIn(vehicle, todayWindow).total,
        jobs: periodJobs,
        maintenanceCost: sum(periodJobs, jobCost),
        ageYears: vehicleAgeYears(vehicle, today),
        loads: vehicleLoads,
        points: vehiclePoints,
        km: kmInWindow(vehiclePoints, active),
      };
    });

    const context: FleetContext = {
      filters,
      period,
      periodView: toPeriodView(period),
      now,
      today,
      stats,
      loads: stats.flatMap((s) => s.loads),
      emptyBecause: null,
    };
    context.emptyBecause = await this.emptyBecause(tenantId, context);
    return context;
  }

  /**
   * §5.14: an empty slice is an answer, not an error — but say which filter emptied it. For an
   * empty fleet, the narrowest vehicle filter whose removal brings trucks back; for trucks with
   * no loads under a lane or customer filter, that filter.
   */
  private async emptyBecause(
    tenantId: string,
    context: FleetContext,
  ): Promise<FleetEmptyBecause | null> {
    const { filters } = context;
    if (context.stats.length === 0) {
      const scope = {
        heldAs: filters.heldAs,
        truckTypeId: filters.truckTypeId,
        vehicleId: filters.vehicleId,
      };
      if (filters.vehicleId) {
        const count = await this.repository.countScopedVehicles(tenantId, {
          ...scope,
          vehicleId: undefined,
        });
        if (count > 0) return 'vehicleId';
      }
      if (filters.truckTypeId) {
        const count = await this.repository.countScopedVehicles(tenantId, {
          ...scope,
          truckTypeId: undefined,
        });
        if (count > 0) return 'truckTypeId';
      }
      if (filters.heldAs !== 'owned_and_attached') {
        const count = await this.repository.countScopedVehicles(tenantId, {
          ...scope,
          heldAs: 'owned_and_attached',
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
   *  the truck record — km run in any window is read off these. */
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

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(key(row), [...(groups.get(key(row)) ?? []), row]);
  return groups;
}

function toPeriodView(period: FleetPeriod): FleetAnalyticsPeriodView {
  return { from: period.fromDate, to: period.toDate, days: period.days, label: period.label };
}
