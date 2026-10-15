import { FleetAnalyticsHeldAs, FleetAnalyticsPeriod } from './fleet-analytics.constants';

/**
 * Fleet Analytics responses (spec §5.14, figures per §6.9). Vehicle, maintenance, tyre, paper,
 * driver and own-fleet load figures are real; km run is read off odometer readings. Figures with
 * no source records yet (fuel, tolls, driver pay, per-load distance, detention, on-road price)
 * stay 0 so the screen keeps its shape, and every tab names them under `unavailable` with the
 * reason, so a 0 is never read as a measurement.
 */

export interface FleetAnalyticsFilters {
  period: FleetAnalyticsPeriod;
  from?: string;
  to?: string;
  truckTypeId?: string;
  heldAs: FleetAnalyticsHeldAs;
  vehicleId?: string;
  /** `${loadingPointId}:${customerDeliveryPointId}` — narrows load figures to one lane. */
  laneKey?: string;
  /** Accepted, not applied — there is no yard model yet. */
  yardId?: string;
  /** Narrows load figures to one customer's loads. */
  customerId?: string;
}

/** The filter whose removal brings rows back, when a filter combination returns nothing. */
export type FleetEmptyBecause =
  'vehicleId' | 'truckTypeId' | 'heldAs' | 'laneKey' | 'customerId' | 'period';

/** Carried on every tab response. */
export interface FleetAnalyticsMeta {
  /** Field (or field prefix) → why it reads 0. */
  unavailable: Record<string, string>;
  /** Set when the fleet or the loads came back empty: the filter that emptied it. */
  emptyBecause: FleetEmptyBecause | null;
}

export interface FleetAnalyticsPeriodView {
  from: string;
  to: string;
  days: number;
  label: string;
}

export interface FleetVehicleSummary {
  id: string;
  registrationNumber: string;
  truckTypeName: string | null;
  ownershipType: string;
}

export interface FleetAnalyticsOption {
  id: string;
  name: string;
}

// ─── Filters ───────────────────────────────────────────────────────────────

export interface FleetAnalyticsFilterOptions {
  periods: { value: FleetAnalyticsPeriod; label: string }[];
  truckClasses: FleetAnalyticsOption[];
  heldAs: { value: FleetAnalyticsHeldAs; label: string }[];
  yards: FleetAnalyticsOption[];
  customers: FleetAnalyticsOption[];
  vehicles: FleetAnalyticsOption[];
  /** id is the laneKey. */
  lanes: FleetAnalyticsOption[];
}

// ─── Header KPIs ───────────────────────────────────────────────────────────

export interface FleetAnalyticsSummary extends FleetAnalyticsMeta {
  period: FleetAnalyticsPeriodView;
  vehicles: number;
  /** All-in cost per km over the trucks whose km could be read; null when none could. */
  costPerKm: { value: number | null; distanceKm: number; vehicles: number; estimated: boolean };
  fleetCost: { total: number; onRoad: number; standing: number };
  costPerTonneKm: { value: number; tonnes: number; distanceKm: number };
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
  driver: number;
  maintenance: number;
  otherHireAndChallans: number;
  fixed: number;
  total: number;
}

export interface FleetOwnershipCost {
  cost: number;
  distanceKm: number;
  perKm: number | null;
}

/** Standing cost of the truck-days spent on that lane's loads (no variable cost recorded yet). */
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
  complianceExpired: { vehicles: number };
  /** Running trucks not in the workshop and not blocked on papers. */
  trucksInService: { count: number; of: number };
  openBreakdowns: { count: number };
  idleStandingCost: { amount: number; idleDays: number; perDay: number };
  monthlyCost: FleetMonthlyCostPoint[];
  costBuildUp: FleetCostBuildUpPoint[];
  ownedVsAttached: {
    own: FleetOwnershipCost;
    attached: FleetOwnershipCost;
    hirePaidOut: { amount: number; vendors: number };
    tripsOverClassRate: { count: number; total: number; pct: number };
  };
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
  blockedDays: number;
  utilisationPct: number;
  /** Fixed cost per day × standing days — the same definition as the overview. */
  idleCost: number;
  workshopCost: number;
  blockedCost: number;
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
  capacityUsed: { pct: number; standingTruckDays: number };
  loadedShareOfDistance: { pct: number; emptyKm: number };
  deadRunningCost: { amount: number; pctOfVariable: number };
  trucksBelowHalfAverage: { count: number };
  tripsPerVehicle: number;
  tonnesMoved: { tonnes: number; perLoad: number };
  turnaroundDays: number;
  loadingPlusUnloadingHours: number;
  days: {
    truckDays: number;
    onLoad: FleetDayBucket;
    standing: FleetDayBucket;
    workshop: FleetDayBucket;
    blockedOnPaper: FleetDayBucket;
  };
  leastUsedTrucks: FleetTruckUtilisationRow[];
  workingDayHours: {
    moving: number;
    atGate: number;
    heldPastFreeHours: number;
    waitingCityNoEntry: number;
    driverResting: number;
    stoppedBrokenDown: number;
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

/** The cost heads the Cost tab lists; `other_fixed_cost` only appears when some truck has a
 *  fixed_cost_monthly entered. */
export type FleetCostHead =
  | 'fuel_and_energy'
  | 'attached_truck_hire'
  | 'emi_and_lease'
  | 'depreciation'
  | 'empty_running'
  | 'maintenance_and_tyres'
  | 'tolls_and_fastag'
  | 'insurance_and_permits'
  | 'driver_wages_and_bhatta'
  | 'other_fixed_cost';

export interface FleetAnalyticsCost extends FleetAnalyticsMeta {
  period: FleetAnalyticsPeriodView;
  costPerKm: number | null;
  onRoadPerKm: number | null;
  standingPerKm: number | null;
  distanceKm: number;
  costPerTonneKm: { value: number; avgLoadTonnes: number };
  energyPerKm: { value: number; spent: number };
  tollsPerKm: { value: number; spent: number };
  emiAndLease: { monthly: number; trucks: number };
  costByHead: { head: FleetCostHead; label: string; amount: number }[];
  /** The standing head split by what makes it up. */
  standingBreakdown: { emiAndLease: number; insurance: number; otherFixed: number };
  /** Which inputs the standing cost was built from across the fleet. */
  fixedCostBasis: { fixedCostMonthly: number; emiLeaseInsurance: number; none: number };
  totalCost: number;
  /** The heads must add up to the headline; the note says why standing is bigger than what
   *  trips carried. */
  reconciliation: { headsTotal: number; headlineTotal: number; difference: number; note: string };
  /** perKm is null until loads carry a distance. */
  costByLane: {
    lane: string;
    laneKey: string;
    loads: number;
    cost: number;
    perKm: number | null;
  }[];
  costByClass: {
    truckTypeId: string | null;
    name: string;
    vehicles: number;
    cost: number;
    distanceKm: number;
    perKm: number | null;
  }[];
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
  byClass: { truckTypeId: string | null; name: string; vehicles: number; costPerKm: number }[];
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
  /** perKm is spend over km read off odometer readings; 0 when no km could be read. */
  spend?: { total: number; perKm: number; jobs: number };
  /** Distance the trucks ran in the period, from odometer readings. */
  distance: { km: number; vehicles: number; estimated: boolean };
  preventiveShare: { pct: number; planned: number; total: number };
  /** cost = days off the road × each truck's own fixed cost per day (cost seats only). */
  downtime: { days: number; trucks: number; cost?: number };
  /** km is null when there were no breakdowns in the period. */
  meanDistanceBetweenFailures: { km: number | null; breakdowns: number };
  averageFleetAge: { years: number; vehicles: number };
  lifetimeDistance: { km: number; vehicles: number };
  /** null until vehicles carry a purchase price. */
  writtenDownValue?: { value: number | null; onRoadValue: number | null };
  tyresPastLife: { positions: number; thresholdPct: number };
  /** `amount` in rupees for a seat that can see cost, else `count` of jobs. */
  plannedVsUnplannedUnit: 'amount' | 'count';
  plannedVsUnplanned: {
    month: string;
    preventive: number;
    unplannedRepair: number;
    roadsideBreakdown: number;
    total: number;
    /** Job counts, always present — §6.9 compares planned and unplanned by count and by cost. */
    counts: { preventive: number; unplannedRepair: number; roadsideBreakdown: number };
  }[];
  /** Worst per km first; trucks with no km read in the period are left out. */
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
  tyresByVehicle: {
    vehicle: FleetVehicleSummary;
    ageYears: number | null;
    tyres: number;
    avgTreadLeftPct: number;
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
  turnaroundDays: number;
  detention: { hours: number; loadsPastFreeHours: number };
  recoverableDetention: { amount: number };
  loadingHours: number;
  unloadingHours: number;
  durationAgainstPlan: { pct: number; extraKm: number };
  /** Median days late across late loads (§6.3: median, not average). */
  medianLateDays: number | null;
  onTheRoad: { count: number; runningBehind: number };
  detentionByConsignor: { consignor: string; amount: number }[];
  onTimeByLane: FleetLaneOnTimeRow[];
  loadStages: { stage: string; count: number }[];
  loadPipeline: {
    onTheRoad: number;
    runningBehind: number;
    deliveredPodNotIn: number;
    podInNotInvoiced: number;
  };
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
  documentsInOrder: { vehicles: number; of: number };
  blockedFromDispatch: { vehicles: number; expiredPaper: number; inWorkshop: number };
  expiringIn7Days: { documents: number; vehicles: number };
  expiringIn30Days: { documents: number; vehicles: number };
  licences: { expiredOrExpiring: number; expired: number };
  position: FleetDocumentCounts & { total: number };
  byDocumentType: (FleetDocumentCounts & { documentType: string; label: string })[];
  renewThisWeek: {
    vehicle: FleetVehicleSummary;
    documentType: string;
    label: string;
    expiryDate: string;
    daysLeft: number;
    /** What the truck costs standing per day while the paper is out — cost seats only. */
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
