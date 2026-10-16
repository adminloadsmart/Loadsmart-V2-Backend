import { FleetAnalyticsHeldAs, FleetAnalyticsPeriod } from './fleet-analytics.constants';

/**
 * Fleet Analytics responses, per the Fleet Analytics Metric Guide (v1.0, October 2026).
 *
 * Fleet cost = running cost + fixed cost. Running cost is maintenance (service jobs, breakdowns,
 * tyre jobs) until fuel, tolls, trip expenses, e-challans and hire are recorded; fixed cost is
 * EMI or lease, insurance, National Permit and driver salaries per day. Km come from recorded
 * odometer readings. Every figure whose source isn't recorded yet stays 0 and is named under
 * `unavailable` with the reason, so a 0 is never read as a measurement.
 */

export interface FleetAnalyticsFilters {
  period: FleetAnalyticsPeriod;
  from?: string;
  to?: string;
  /** Body type key: an axle type for containers sold by axle, else the truck type master's. */
  bodyType?: string;
  /** Size label, e.g. "18T, 32 ft" — only meaningful with a body type. */
  size?: string;
  heldAs: FleetAnalyticsHeldAs;
  vehicleId?: string;
  /** `${loadingPointId}:${customerDeliveryPointId}` — narrows load figures to one lane. */
  laneKey?: string;
  /** Narrows load figures to one customer's loads; truck-level numbers are unchanged. */
  customerId?: string;
}

/** The filter whose removal brings rows back, when a filter combination returns nothing. */
export type FleetEmptyBecause =
  'vehicleId' | 'bodyType' | 'size' | 'heldAs' | 'laneKey' | 'customerId';

/** Carried on every tab response. */
export interface FleetAnalyticsMeta {
  /** Field (or field prefix) → why it reads 0 or is approximated. */
  unavailable: Record<string, string>;
  /** Set when the fleet or the loads came back empty: the filter that emptied it. */
  emptyBecause: FleetEmptyBecause | null;
}

export interface FleetAnalyticsPeriodView {
  from: string;
  to: string;
  /** Days in period: start to today, or to the period end if earlier. */
  days: number;
  label: string;
}

export interface FleetVehicleSummary {
  id: string;
  registrationNumber: string;
  /** "Body type · Size", e.g. "Multi Axle · 18T, 32 ft". */
  truckTypeName: string;
  bodyType: string;
  size: string | null;
  ownershipType: string;
}

export interface FleetAnalyticsOption {
  id: string;
  name: string;
}

// ─── Filters ───────────────────────────────────────────────────────────────

export interface FleetAnalyticsFilterOptions {
  periods: { value: FleetAnalyticsPeriod; label: string }[];
  /** Body types in the fleet, each with the sizes its trucks come in. */
  bodyTypes: (FleetAnalyticsOption & { sizes: FleetAnalyticsOption[] })[];
  heldAs: { value: FleetAnalyticsHeldAs; label: string }[];
  /** Customers with at least one load. */
  customers: FleetAnalyticsOption[];
  vehicles: FleetAnalyticsOption[];
  /** id is the laneKey. */
  lanes: FleetAnalyticsOption[];
}

// ─── Header KPIs ───────────────────────────────────────────────────────────

export interface FleetAnalyticsSummary extends FleetAnalyticsMeta {
  period: FleetAnalyticsPeriodView;
  vehicles: number;
  /** Fleet cost ÷ km driven by all trucks; null when no km could be read. */
  costPerKm: { value: number | null; distanceKm: number; vehicles: number; estimated: boolean };
  /** on the road = running cost; standing = fixed cost. */
  fleetCost: { total: number; onRoad: number; standing: number };
  costPerTonneKm: { value: number; tonnes: number; distanceKm: number };
  /** Load days ÷ (trucks × days in period). */
  utilisation: { pct: number; workingDays: number; truckDays: number };
}

// ─── Overview ──────────────────────────────────────────────────────────────

export interface FleetMonthlyCostPoint {
  month: string;
  totalCost: number;
  costPerKm: number | null;
}

export interface FleetCostBuildUpPoint {
  month: string;
  fuelAndEnergy: number;
  tolls: number;
  /** Bhatta + driver salary. */
  driver: number;
  maintenance: number;
  otherTripExpensesAndChallans: number;
  /** EMI, lease, insurance, permit, depreciation, rental and per-trip hire. */
  fixedAndHire: number;
  total: number;
}

export interface FleetOwnershipCost {
  cost: number;
  distanceKm: number;
  perKm: number | null;
}

/** A lane's cost: daily fixed cost × the days its loads held the truck (trip costs aren't
 *  recorded yet). */
export interface FleetLaneAmount {
  lane: string;
  laneKey: string;
  loads: number;
  cost: number;
}

export interface FleetAnalyticsOverview extends FleetAnalyticsMeta {
  period: FleetAnalyticsPeriodView;
  loads: { carried: number; perMonth: number };
  tonnes: { moved: number; costPerTonne: number };
  tripsPerVehicle: { value: number; vehicles: number };
  onTime: { pct: number; late: number; delivered: number };
  /** Trucks with an expired document. They can still be dispatched. */
  complianceExpired: { vehicles: number };
  /** Trucks with an open service job or breakdown right now. */
  trucksInWorkshop: { count: number; of: number };
  openBreakdowns: { count: number };
  /** Daily fixed cost × (idle + workshop days). */
  idleStandingCost: { amount: number; idleDays: number; perDay: number };
  monthlyCost: FleetMonthlyCostPoint[];
  costBuildUp: FleetCostBuildUpPoint[];
  ownedVsAttached: {
    own: FleetOwnershipCost;
    attached: FleetOwnershipCost;
    hirePaidOut: { amount: number; vendors: number };
    tripsOverClassRate: { count: number; total: number; pct: number };
  };
  /** Top 8 lanes by cost. */
  costByLane: FleetLaneAmount[];
}

// ─── Utilisation ───────────────────────────────────────────────────────────

export interface FleetDayBucket {
  days: number;
  pct: number;
  fixedCost: number;
}

export interface FleetTruckUtilisationRow {
  vehicle: FleetVehicleSummary;
  onLoadDays: number;
  idleDays: number;
  workshopDays: number;
  /** On-a-load days ÷ days in period. */
  utilisationPct: number;
  /** Daily fixed cost × (idle + workshop days). */
  idleCost: number;
}

export interface FleetIdleTruckRow {
  vehicle: FleetVehicleSummary;
  trips: number;
  distanceKm: number;
  downtimeDays: number;
  /** No revenue per load is recorded yet. */
  net: number | null;
}

export interface FleetAnalyticsUtilisation extends FleetAnalyticsMeta {
  period: FleetAnalyticsPeriodView;
  /** Load days ÷ (trucks × days in period); standing = idle + workshop truck-days. */
  loadUtilisation: { pct: number; standingTruckDays: number };
  loadedShareOfDistance: { pct: number; emptyKm: number };
  deadRunningCost: { amount: number; pctOfVariable: number };
  trucksBelowHalfAverage: { count: number };
  tripsPerVehicle: number;
  tonnesMoved: { tonnes: number; perLoad: number };
  /** Average days from first loading gate-in to last unloading gate-out. */
  turnaroundDays: number;
  /** Average hours at loading and unloading points per load. */
  loadingPlusUnloadingHours: number;
  days: {
    truckDays: number;
    onLoad: FleetDayBucket;
    workshop: FleetDayBucket;
    idle: FleetDayBucket;
    /** Detention, no-entry and unplanned halts on loads — needs GPS. */
    lostOnLoads: FleetDayBucket;
  };
  leastUsedTrucks: FleetTruckUtilisationRow[];
  /** "What a load day is spent doing", in hours — needs GPS. */
  loadDayHours: {
    moving: number;
    atGates: number;
    detention: number;
    cityNoEntry: number;
    unplannedHalts: number;
    normalStops: number;
  };
  idleDaysByTrips: FleetIdleTruckRow[];
  emptyRunningByLane: { lane: string; pct: number }[];
  plannedVsActual: {
    months: { month: string; overPct: number }[];
    plannedKm: number;
    actualKm: number;
    overPct: number;
    extraEnergyCost: number;
  };
}

// ─── Cost ──────────────────────────────────────────────────────────────────

/** The heads of "Operating cost by head" (§14). They add up to fleet cost. */
export type FleetCostHead =
  | 'fuel_and_energy'
  | 'hire_and_rental'
  | 'emi_and_lease'
  | 'depreciation'
  | 'maintenance_and_tyres'
  | 'tolls'
  | 'insurance'
  | 'permits'
  | 'driver_salary_and_bhatta'
  | 'other_trip_expenses'
  | 'e_challans';

export interface FleetTruckTypeCost {
  /** Body type key. */
  bodyType: string;
  name: string;
  vehicles: number;
  cost: number;
  distanceKm: number;
  perKm: number | null;
  /** The same split by size, for the table. */
  sizes: {
    size: string;
    vehicles: number;
    cost: number;
    distanceKm: number;
    perKm: number | null;
  }[];
}

export interface FleetAnalyticsCost extends FleetAnalyticsMeta {
  period: FleetAnalyticsPeriodView;
  /** Fleet cost ÷ km driven. */
  costPerKm: number | null;
  /** Running cost ÷ km driven. */
  onRoadPerKm: number | null;
  /** Fixed cost ÷ km driven. */
  standingPerKm: number | null;
  distanceKm: number;
  costPerTonneKm: { value: number; avgLoadTonnes: number };
  energyPerKm: { value: number; spent: number };
  tollsPerKm: { value: number; spent: number };
  emiAndLease: { monthly: number; trucks: number };
  costByHead: { head: FleetCostHead; label: string; amount: number }[];
  /** Equals fleet cost. */
  totalCost: number;
  /** Every lane, dearest first; perKm is null until loads carry a distance. */
  costByLane: {
    lane: string;
    laneKey: string;
    loads: number;
    cost: number;
    perKm: number | null;
  }[];
  /** One row per body type. */
  costByTruckType: FleetTruckTypeCost[];
  /** The 14 dearest trucks per km. */
  costByTruck: {
    vehicle: FleetVehicleSummary;
    cost: number;
    distanceKm: number;
    kmEstimated: boolean;
    perKm: number | null;
  }[];
}

// ─── Energy ────────────────────────────────────────────────────────────────

export interface FleetAnalyticsEnergy extends FleetAnalyticsMeta {
  period: FleetAnalyticsPeriodView;
  dieselMileage: { kmPerLitre: number; km: number; spend: number };
  dieselPerKm: { value: number; pricePerLitre: number };
  electricPerKm: { value: number; pctBelowDiesel: number };
  blendedCostPerKwh: { value: number; yardRate: number; publicRate: number };
  electricConsumption: { kwhPerKm: number; kwhDrawn: number };
  cngPerKm: { value: number; km: number; spend: number };
  vehiclesOffBenchmark: { count: number };
  avoidableSpend: { amount: number };
  byPowertrain: { fuelType: string; vehicles: number; costPerKm: number }[];
  offBenchmark: { vehicle: FleetVehicleSummary; costOverClassAverage: number }[];
  byTruckType: { bodyType: string; name: string; vehicles: number; costPerKm: number }[];
  byLane: { lane: string; costPerKm: number }[];
}

// ─── Maintenance ───────────────────────────────────────────────────────────

export type TyreConditionLabel = 'new_like' | 'good' | 'fair' | 'worn' | 'very_worn';

/**
 * Money fields (marked optional) are omitted for a seat without maintenance.costs.view — the
 * workshop figures go to everybody, same split as the maintenance screen.
 */
export interface FleetAnalyticsMaintenance extends FleetAnalyticsMeta {
  period: FleetAnalyticsPeriodView;
  /** perKm = spend ÷ km driven by all trucks. */
  spend?: { total: number; perKm: number; jobs: number };
  distance: { km: number; vehicles: number; estimated: boolean };
  /** Preventive service jobs ÷ (service jobs + breakdowns). */
  preventiveShare: { pct: number; planned: number; total: number };
  /** Workshop days + breakdown days; cost = days × each truck's daily fixed cost (cost seats). */
  downtime: { days: number; trucks: number; cost?: number };
  /** km is null when there were no breakdowns in the period. */
  meanDistanceBetweenFailures: { km: number | null; breakdowns: number };
  /** Owned trucks only. */
  averageFleetAge: { years: number; vehicles: number };
  lifetimeDistance: { km: number; vehicles: number };
  /** null until trucks carry a price and purchase date. */
  writtenDownValue?: { value: number | null; onRoadValue: number | null };
  /** Positions at or below 4 mm of tread; replaceNow at or below 2 mm. */
  tyresToReplace: { positions: number; replaceNow: number };
  /** `amount` in rupees for a seat that can see cost, else `count` of jobs. */
  plannedVsUnplannedUnit: 'amount' | 'count';
  plannedVsUnplanned: {
    month: string;
    preventive: number;
    unplannedRepair: number;
    roadsideBreakdown: number;
    total: number;
    counts: { preventive: number; unplannedRepair: number; roadsideBreakdown: number };
  }[];
  /** The 12 trucks with the highest maintenance per km. */
  byVehicle: {
    vehicle: FleetVehicleSummary;
    ageYears: number | null;
    kmRun: number;
    kmEstimated: boolean;
    cost?: number;
    perKm?: number;
  }[];
  replacementCandidates?: {
    vehicle: FleetVehicleSummary;
    ageYears: number | null;
    perKm: number;
    benchmarkPerKm: number;
    benchmarkScope: 'class' | 'fleet';
    extraPerKm: number;
    /** Same as extraPerKm — the name the screen reads. */
    overNewPerKm: number;
  }[];
  /** Each truck's condition is its worst tyre. */
  tyresByVehicle: {
    vehicle: FleetVehicleSummary;
    ageYears: number | null;
    tyres: number;
    /** Life left of the worst tyre, %. */
    treadLeftPct: number;
    condition: TyreConditionLabel;
    kmRun: number;
    kmEstimated: boolean;
    cost?: number;
    perKm?: number;
  }[];
}

// ─── Operations ────────────────────────────────────────────────────────────

export interface FleetLaneOnTimeRow {
  lane: string;
  laneKey: string;
  loads: number;
  /** Median days from pickup date to promised delivery date. */
  transitCommittedDays: number | null;
  onTimePct: number;
  averageTurnaroundDays: number | null;
}

export interface FleetAnalyticsOperations extends FleetAnalyticsMeta {
  period: FleetAnalyticsPeriodView;
  onTime: { pct: number; late: number; delivered: number };
  /** Median days late past the window close, across late loads. */
  medianLateDays: number | null;
  turnaroundDays: number;
  detention: { hours: number; loadsPastFreeHours: number };
  recoverableDetention: { amount: number };
  loadingHours: number;
  unloadingHours: number;
  durationAgainstPlan: { pct: number; extraKm: number };
  /** Today's position, not filtered by period. */
  onTheRoad: { count: number; runningBehind: number };
  detentionByConsignor: { consignor: string; amount: number }[];
  /** The 12 lanes with the lowest on-time %. */
  onTimeByLane: FleetLaneOnTimeRow[];
  loadStages: { stage: string; count: number }[];
  loadPipeline: {
    onTheRoad: number;
    runningBehind: number;
    deliveredPodPending: number;
    podInExpensesNotSettled: number;
  };
  /** Today's position, not filtered by period. */
  drivers: {
    availableToDispatch: number;
    awayOrOffRoll: number;
    medianSafetyScore: number;
    needCoaching: number;
    onTimePct: number;
  };
}

// ─── Compliance ────────────────────────────────────────────────────────────

export type DocumentBucket = 'expired' | 'inside7Days' | 'inside30Days' | 'inOrder';

export interface FleetDocumentCounts {
  expired: number;
  inside7Days: number;
  inside30Days: number;
  inOrder: number;
}

export interface FleetAnalyticsCompliance extends FleetAnalyticsMeta {
  period: FleetAnalyticsPeriodView;
  vehicles: number;
  /** Trucks with every document valid for more than 30 days. */
  documentsInOrder: { vehicles: number; of: number };
  /** Trucks with an expired document (they can still be dispatched); loadsCarried = loads in the
   *  period that started while the truck had an expired document. */
  trucksWithExpiredDocuments: { vehicles: number; loadsCarried: number };
  /** Documents with 0–7 days left. */
  expiringIn7Days: { documents: number; vehicles: number };
  /** Documents with 8–30 days left. */
  expiringIn8To30Days: { documents: number; vehicles: number };
  licences: { expiredOrExpiring: number; expired: number };
  position: FleetDocumentCounts & { total: number };
  byDocumentType: (FleetDocumentCounts & { documentType: string; label: string })[];
  renewThisWeek: {
    vehicle: FleetVehicleSummary;
    documentType: string;
    label: string;
    expiryDate: string;
    daysLeft: number;
    /** The truck's daily fixed cost — cost seats only. */
    standingPerDay?: number;
  }[];
  drivers: {
    onRoll: number;
    hazmatEndorsed: number;
    licencesExpired: number;
    expiringIn30Days: number;
    ranALoadPct: number;
    items: {
      driverId: string;
      name: string;
      licenceNumber: string | null;
      licenceClass: string | null;
      hazmat: boolean;
      validTo: string | null;
      daysLeft: number | null;
      status: 'expired' | 'expiring' | 'valid' | 'unknown';
    }[];
  };
}

// ─── Findings ──────────────────────────────────────────────────────────────

export type FleetFindingTab = 'utilisation' | 'cost' | 'maintenance' | 'compliance' | 'operations';

export interface FleetFinding {
  id: string;
  /** One plain sentence naming the thing worth acting on. */
  text: string;
  /** Money at stake over the period, used to rank findings; null when not money. */
  amount: number | null;
  /** Where the evidence is. */
  tab: FleetFindingTab;
  vehicleId: string | null;
  laneKey: string | null;
}

export interface FleetAnalyticsFindings extends FleetAnalyticsMeta {
  period: FleetAnalyticsPeriodView;
  findings: FleetFinding[];
}
