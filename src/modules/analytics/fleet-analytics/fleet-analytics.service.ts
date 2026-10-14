import { rethrow } from '../../../shared/errors';
import { endOfIstDate, startOfIstDate, toIstDateString } from '../../../shared/utils/ist-time';
import { VehicleEntity } from '../../masters/vehicle/entities/vehicle.entity';
import { MaintenanceJobEntity } from '../../maintenance/entities/maintenance-job.entity';
import { downtimeDaysInWindow, money } from '../../maintenance/calculations/downtime';
import { daysBetween, round } from '../../maintenance/calculations/dates';
import { computeTyreWear } from '../../maintenance/calculations/tyre-wear';
import { FleetAnalyticsRepository } from './fleet-analytics.repository';
import {
  FleetAnalyticsCompliance,
  FleetAnalyticsCost,
  FleetAnalyticsEnergy,
  FleetAnalyticsFilterOptions,
  FleetAnalyticsFilters,
  FleetAnalyticsMaintenance,
  FleetAnalyticsOperations,
  FleetAnalyticsOverview,
  FleetAnalyticsPeriodView,
  FleetAnalyticsSummary,
  FleetAnalyticsUtilisation,
  FleetCostHead,
  FleetDocumentCounts,
  FleetTruckUtilisationRow,
  FleetVehicleSummary,
} from './utils/fleet-analytics.interface';
import {
  DOCUMENT_LABELS,
  FLEET_ANALYTICS_HELD_AS,
  HELD_AS_LABELS,
  LEAST_USED_TRUCKS_LIMIT,
  LOAD_STAGES,
  MIN_BENCHMARK_TRUCKS,
  NEW_TRUCK_MAX_AGE_YEARS,
  RENEW_THIS_WEEK_LIMIT,
  REPLACEMENT_CANDIDATES_LIMIT,
  TYRE_PAST_LIFE_LEFT_PCT,
} from './utils/fleet-analytics.constants';
import { FleetPeriod, resolveFleetPeriod } from './utils/fleet-analytics.period';
import {
  StandingCost,
  TimeWindow,
  activeWindow,
  blockedOnPaperDays,
  currentDatedDocuments,
  documentBucket,
  isCountedJob,
  istMonth,
  jobCategory,
  jobCost,
  kmInWindow,
  monthlyEmiAndLease,
  OdometerPoint,
  replacementCandidates,
  overlapDays,
  pct,
  intersect,
  standingCostIn,
  toFleetVehicleSummary,
  tyreCondition,
  vehicleAgeYears,
} from './utils/fleet-analytics.calculations';
import { VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY } from '../../masters/vehicle/vehicle.type';

/** One truck's figures over the period — every tab builds from these rows. */
interface VehicleStats {
  vehicle: VehicleEntity;
  summary: FleetVehicleSummary;
  active: TimeWindow;
  activeDays: number;
  /** Always 0 until loads are wired in. */
  onLoadDays: number;
  workshopDays: number;
  blockedDays: number;
  standingDays: number;
  /** Standing cost over the active window, by head. */
  standing: StandingCost;
  /** Average standing cost per active day — what each idle/workshop/blocked day carried. */
  perDay: number;
  /** Standing cost per day as of today — for "what it costs while the paper is out". */
  currentPerDay: number;
  /** Counted jobs opened inside the period. */
  jobs: MaintenanceJobEntity[];
  maintenanceCost: number;
  ageYears: number | null;
}

interface FleetContext {
  period: FleetPeriod;
  periodView: FleetAnalyticsPeriodView;
  now: Date;
  today: string;
  stats: VehicleStats[];
}

function sum<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((total, row) => total + pick(row), 0);
}

function average(values: number[]): number {
  return values.length ? sum(values, (value) => value) / values.length : 0;
}

export class FleetAnalyticsService {
  constructor(private readonly repository: FleetAnalyticsRepository) {}

  async getFilters(tenantId: string): Promise<FleetAnalyticsFilterOptions> {
    try {
      const [truckTypes, customers] = await Promise.all([
        this.repository.listTruckTypes(tenantId),
        this.repository.listCustomers(tenantId),
      ]);
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
      const { periodView, stats } = await this.loadContext(tenantId, filters);
      const onRoad = sum(stats, (s) => s.maintenanceCost);
      const standing = sum(stats, (s) => s.standing.total);
      const truckDays = sum(stats, (s) => s.activeDays);
      const workingDays = sum(stats, (s) => s.onLoadDays);

      return {
        period: periodView,
        vehicles: stats.length,
        costPerKm: { value: 0, distanceKm: 0 },
        fleetCost: {
          total: money(onRoad + standing),
          onRoad: money(onRoad),
          standing: money(standing),
        },
        costPerTonneKm: { value: 0, tonnes: 0, distanceKm: 0 },
        utilisation: {
          pct: pct(workingDays, truckDays),
          workingDays: Math.round(workingDays),
          truckDays: Math.round(truckDays),
        },
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
        return {
          month: month.month,
          fuelAndEnergy: 0,
          tolls: 0,
          driver: 0,
          maintenance: money(maintenance),
          otherHireAndChallans: 0,
          fixed: money(fixed),
          total: money(maintenance + fixed),
        };
      });

      const own = stats.filter((s) => s.vehicle.ownershipType !== 'attached');
      const attached = stats.filter((s) => s.vehicle.ownershipType === 'attached');
      const costOf = (rows: VehicleStats[]) =>
        money(sum(rows, (s) => s.standing.total + s.maintenanceCost));

      return {
        period: periodView,
        loads: { carried: 0, perMonth: 0 },
        tonnes: { moved: 0, costPerTonne: 0 },
        tripsPerVehicle: { value: 0, vehicles: stats.length },
        onTime: { pct: 0, late: 0, delivered: 0 },
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
          costPerKm: 0,
        })),
        costBuildUp,
        ownedVsAttached: {
          own: { cost: costOf(own), distanceKm: 0, perKm: 0 },
          attached: { cost: costOf(attached), distanceKm: 0, perKm: 0 },
          hirePaidOut: { amount: 0, vendors: 0 },
          tripsOverClassRate: { count: 0, total: 0, pct: 0 },
        },
        costByLane: [],
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
      const { period, periodView, stats } = await this.loadContext(tenantId, filters);
      const truckDays = sum(stats, (s) => s.activeDays);
      const bucket = (pick: (s: VehicleStats) => number) => {
        const days = sum(stats, pick);
        const fixedCost = sum(stats, (s) => pick(s) * s.perDay);
        return { days: Math.round(days), pct: pct(days, truckDays), fixedCost: money(fixedCost) };
      };
      const standing = bucket((s) => s.standingDays);
      const workshop = bucket((s) => s.workshopDays);
      const blocked = bucket((s) => s.blockedDays);

      const leastUsedTrucks: FleetTruckUtilisationRow[] = stats
        .map((s) => {
          const idleDays = s.standingDays + s.workshopDays + s.blockedDays;
          return {
            vehicle: s.summary,
            onLoadDays: Math.round(s.onLoadDays),
            idleDays: Math.round(s.standingDays),
            workshopDays: Math.round(s.workshopDays),
            blockedDays: Math.round(s.blockedDays),
            utilisationPct: pct(s.onLoadDays, s.activeDays),
            idleCost: money(idleDays * s.perDay),
          };
        })
        .sort((a, b) => a.utilisationPct - b.utilisationPct || b.idleCost - a.idleCost)
        .slice(0, LEAST_USED_TRUCKS_LIMIT);

      return {
        period: periodView,
        capacityUsed: {
          pct: 0,
          standingTruckDays: standing.days + workshop.days + blocked.days,
        },
        loadedShareOfDistance: { pct: 0, emptyKm: 0 },
        deadRunningCost: { amount: 0, pctOfVariable: 0 },
        trucksBelowHalfAverage: { count: 0 },
        tripsPerVehicle: 0,
        tonnesMoved: { tonnes: 0, perLoad: 0 },
        turnaroundDays: 0,
        loadingPlusUnloadingHours: 0,
        days: {
          truckDays: Math.round(truckDays),
          onLoad: { days: 0, pct: 0, fixedCost: 0 },
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
        idleDaysByTrips: [],
        emptyRunningByLane: [],
        plannedVsActual: {
          months: period.months.map((month) => ({ month: month.month, overPct: 0 })),
          plannedKm: 0,
          actualKm: 0,
          overPct: 0,
          extraEnergyCost: 0,
        },
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet utilisation');
    }
  }

  async getCost(tenantId: string, filters: FleetAnalyticsFilters): Promise<FleetAnalyticsCost> {
    try {
      const { periodView, stats, today } = await this.loadContext(tenantId, filters);

      const fixedHead = (pick: (standing: StandingCost) => number) =>
        money(sum(stats, (s) => pick(s.standing)));
      const heads: { head: FleetCostHead; label: string; amount: number }[] = [
        { head: 'fuel_and_energy', label: 'Fuel and energy', amount: 0 },
        { head: 'attached_truck_hire', label: 'Attached-truck hire', amount: 0 },
        { head: 'emi_and_lease', label: 'EMI and lease', amount: fixedHead((p) => p.emiAndLease) },
        // No purchase price on the vehicle yet, so nothing to depreciate from.
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
          amount: fixedHead((p) => p.insurance),
        },
        {
          head: 'other_fixed_cost',
          label: 'Other fixed cost',
          amount: fixedHead((p) => p.otherFixed),
        },
        { head: 'driver_wages_and_bhatta', label: 'Driver wages and bhatta', amount: 0 },
      ];
      const costByHead = heads.sort((a, b) => b.amount - a.amount);

      const vehicleCost = (s: VehicleStats) => s.standing.total + s.maintenanceCost;
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

      const emiTrucks = stats.filter((s) => monthlyEmiAndLease(s.vehicle, today) > 0);

      return {
        period: periodView,
        costPerKm: 0,
        onRoadPerKm: 0,
        standingPerKm: 0,
        costPerTonneKm: { value: 0, avgLoadTonnes: 0 },
        energyPerKm: { value: 0, spent: 0 },
        tollsPerKm: { value: 0, spent: 0 },
        emiAndLease: {
          monthly: money(sum(emiTrucks, (s) => monthlyEmiAndLease(s.vehicle, today))),
          trucks: emiTrucks.length,
        },
        costByHead,
        totalCost: money(sum(costByHead, (head) => head.amount)),
        costByLane: [],
        costByClass: [...byClass.values()]
          .map((group) => ({
            truckTypeId: group.truckTypeId,
            name: group.name,
            vehicles: group.rows.length,
            cost: money(sum(group.rows, vehicleCost)),
            perKm: 0,
          }))
          .sort((a, b) => b.cost - a.cost),
        costByTruck: stats
          .map((s) => ({ vehicle: s.summary, cost: money(vehicleCost(s)), perKm: 0 }))
          .sort((a, b) => b.cost - a.cost),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet cost');
    }
  }

  async getEnergy(tenantId: string, filters: FleetAnalyticsFilters): Promise<FleetAnalyticsEnergy> {
    try {
      const { periodView, stats } = await this.loadContext(tenantId, filters);

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
      const { period, periodView, stats, now, today } = await this.loadContext(tenantId, filters);
      const vehicleIds = stats.map((s) => s.vehicle.id);
      const [tyres, distance] = await Promise.all([
        this.repository.listFittedTyres(tenantId, vehicleIds),
        this.distanceByVehicle(tenantId, stats, now),
      ]);

      const jobs = stats.flatMap((s) => s.jobs);
      const planned = jobs.filter((job) => jobCategory(job) === 'preventive').length;
      const breakdowns = jobs.filter((job) => job.jobType === 'breakdown').length;
      const spend = sum(jobs, jobCost);

      const aged = stats.filter((s) => s.ageYears !== null);
      const withOdometer = stats.filter((s) => s.vehicle.serviceUsage?.odometerKm != null);

      const kmOf = (s: VehicleStats) => distance.get(s.vehicle.id) ?? { km: 0, estimated: true };
      const running = stats.filter((s) => kmOf(s).km > 0);
      const totalKm = sum(running, (s) => kmOf(s).km);
      const perKmOf = (s: VehicleStats) => {
        const { km } = kmOf(s);
        return km > 0 ? s.maintenanceCost / km : 0;
      };

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
        const valueOf = (category: string) => {
          const rows = inMonth.filter((job) => jobCategory(job) === category);
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
        };
      });

      const workshop = {
        period: periodView,
        distance: {
          km: totalKm,
          vehicles: running.length,
          estimated: running.some((s) => kmOf(s).estimated),
        },
        preventiveShare: { pct: pct(planned, jobs.length), planned, total: jobs.length },
        downtime: {
          days: round(
            sum(stats, (s) => s.workshopDays),
            1,
          ),
          trucks: stats.filter((s) => s.workshopDays > 0).length,
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
            kmRun: kmOf(s).km,
            kmEstimated: kmOf(s).estimated,
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
              kmRun: kmOf(s).km,
              kmEstimated: kmOf(s).estimated,
              ...costFields(s),
            };
          }),
      };

      if (!canSeeCosts) return workshop;

      return {
        ...workshop,
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
          })),
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet maintenance');
    }
  }

  /** Km each truck ran over its active window, read off its odometer readings plus the last
   *  service and the current odometer on the truck record. */
  private async distanceByVehicle(
    tenantId: string,
    stats: VehicleStats[],
    now: Date,
  ): Promise<Map<string, { km: number; estimated: boolean }>> {
    const readings = await this.repository.listOdometerReadings(
      tenantId,
      stats.map((s) => s.vehicle.id),
      now,
    );
    const points = new Map<string, OdometerPoint[]>();
    const add = (vehicleId: string, at: Date | string, km: number) => {
      const date = typeof at === 'string' ? startOfIstDate(at) : at;
      if (date > now) return;
      points.set(vehicleId, [...(points.get(vehicleId) ?? []), { at: date, km }]);
    };

    for (const reading of readings) add(reading.vehicleId, reading.at, reading.km);
    for (const { vehicle } of stats) {
      const usage = vehicle.serviceUsage;
      if (usage?.lastServiceDate && usage.lastServiceOdometerKm != null) {
        add(vehicle.id, usage.lastServiceDate, usage.lastServiceOdometerKm);
      }
      if (usage?.odometerKm != null) add(vehicle.id, now, usage.odometerKm);
    }

    return new Map(
      stats.map((s) => [s.vehicle.id, kmInWindow(points.get(s.vehicle.id) ?? [], s.active)]),
    );
  }

  /** Every figure here comes from loads/dispatch, so the tab is zero-filled for now. */
  async getOperations(
    _tenantId: string,
    filters: FleetAnalyticsFilters,
  ): Promise<FleetAnalyticsOperations> {
    try {
      const period = resolveFleetPeriod(filters.period, filters.from, filters.to);
      return {
        period: toPeriodView(period),
        onTime: { pct: 0, late: 0, delivered: 0 },
        turnaroundDays: 0,
        detention: { hours: 0, loadsPastFreeHours: 0 },
        recoverableDetention: { amount: 0 },
        loadingHours: 0,
        unloadingHours: 0,
        durationAgainstPlan: { pct: 0, extraKm: 0 },
        onTheRoad: { count: 0, runningBehind: 0 },
        detentionByConsignor: [],
        onTimeByLane: [],
        loadStages: LOAD_STAGES.map((stage) => ({ stage, count: 0 })),
        loadPipeline: { onTheRoad: 0, runningBehind: 0, deliveredPodNotIn: 0, podInNotInvoiced: 0 },
        drivers: {
          availableToDispatch: 0,
          awayOrOffRoll: 0,
          medianSafetyScore: 0,
          needCoaching: 0,
          onTimePct: 0,
        },
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet operations');
    }
  }

  /** Current state of every paper and licence — the period only echoes back. */
  async getCompliance(
    tenantId: string,
    filters: FleetAnalyticsFilters,
  ): Promise<FleetAnalyticsCompliance> {
    try {
      const { periodView, stats, today } = await this.loadContext(tenantId, filters);
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
              standingPerDay: money(s.currentPerDay),
            });
          }
        }
        if (allInOrder) vehiclesInOrder += 1;
      }
      const blocked = new Set([...expiredVehicles, ...inWorkshop]);

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
          ranALoadPct: 0,
          items: driverItems,
        },
      };
    } catch (error) {
      rethrow(error, 'Failed to fetch fleet compliance');
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
    const jobs = await this.repository.listJobsOverlapping(
      tenantId,
      vehicles.map((vehicle) => vehicle.id),
      period,
    );
    const jobsByVehicle = new Map<string, MaintenanceJobEntity[]>();
    for (const job of jobs) {
      jobsByVehicle.set(job.vehicleId, [...(jobsByVehicle.get(job.vehicleId) ?? []), job]);
    }

    const todayWindow = { from: startOfIstDate(today), to: endOfIstDate(today) };
    const stats = vehicles.map((vehicle): VehicleStats => {
      const active = activeWindow(vehicle, period, now);
      const activeDays = overlapDays(active.from, active.to, active);
      const vehicleJobs = jobsByVehicle.get(vehicle.id) ?? [];

      const workshopDays = Math.min(
        activeDays,
        sum(vehicleJobs, (job) => downtimeDaysInWindow(job.openedAt, job.closedAt, active, now)),
      );
      const blockedDays = Math.min(
        activeDays - workshopDays,
        blockedOnPaperDays(currentDatedDocuments(vehicle), active, today, now),
      );
      const onLoadDays = 0;
      const standingDays = Math.max(0, activeDays - onLoadDays - workshopDays - blockedDays);

      const standing = standingCostIn(vehicle, active);
      const periodJobs = vehicleJobs.filter(
        (job) => job.openedAt >= period.from && job.openedAt <= period.to && isCountedJob(job),
      );

      return {
        vehicle,
        summary: toFleetVehicleSummary(vehicle),
        active,
        activeDays,
        onLoadDays,
        workshopDays,
        blockedDays,
        standingDays,
        standing,
        perDay: activeDays > 0 ? standing.total / activeDays : 0,
        currentPerDay: standingCostIn(vehicle, todayWindow).total,
        jobs: periodJobs,
        maintenanceCost: sum(periodJobs, jobCost),
        ageYears: vehicleAgeYears(vehicle, today),
      };
    });

    return { period, periodView: toPeriodView(period), now, today, stats };
  }
}

function toPeriodView(period: FleetPeriod): FleetAnalyticsPeriodView {
  return { from: period.fromDate, to: period.toDate, days: period.days, label: period.label };
}
