import { FleetAnalyticsHeldAs, FleetAnalyticsPeriod } from './fleet-analytics.constants';

/**
 * Fleet Analytics responses. Every figure that comes from loads or dispatch (km run, trips,
 * tonnes, on-time, detention, lanes, fuel/toll spend, hire) is returned as 0 or [] for now —
 * the fields already have their final shape so the frontend won't change when loads are wired
 * in. Vehicle, maintenance, tyre, paper and driver figures are real.
 */

export interface FleetAnalyticsFilters {
  period: FleetAnalyticsPeriod;
  from?: string;
  to?: string;
  truckTypeId?: string;
  heldAs: FleetAnalyticsHeldAs;
  /** Accepted, not applied — there is no yard model yet. */
  yardId?: string;
  /** Accepted, not applied — only narrows load metrics, which are 0 for now. */
  customerId?: string;
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
}

// ─── Header KPIs ───────────────────────────────────────────────────────────

export interface FleetAnalyticsSummary {
  period: FleetAnalyticsPeriodView;
  vehicles: number;
  costPerKm: { value: number; distanceKm: number };
  fleetCost: { total: number; onRoad: number; standing: number };
  costPerTonneKm: { value: number; tonnes: number; distanceKm: number };
  utilisation: { pct: number; workingDays: number; truckDays: number };
}

// ─── Overview ──────────────────────────────────────────────────────────────

export interface FleetMonthlyCostPoint {
  month: string;
  totalCost: number;
  costPerKm: number;
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
  perKm: number;
}

export interface FleetLaneAmount {
  lane: string;
  amount: number;
}

export interface FleetAnalyticsOverview {
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
  idleCost: number;
}

export interface FleetAnalyticsUtilisation {
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
  idleDaysByTrips: { vehicle: FleetVehicleSummary; trips: number }[];
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

export type FleetCostHead =
  | 'fuel_and_energy'
  | 'attached_truck_hire'
  | 'emi_and_lease'
  | 'depreciation'
  | 'empty_running'
  | 'maintenance_and_tyres'
  | 'tolls_and_fastag'
  | 'insurance_and_permits'
  | 'other_fixed_cost'
  | 'driver_wages_and_bhatta';

export interface FleetAnalyticsCost {
  period: FleetAnalyticsPeriodView;
  costPerKm: number;
  onRoadPerKm: number;
  standingPerKm: number;
  costPerTonneKm: { value: number; avgLoadTonnes: number };
  energyPerKm: { value: number; spent: number };
  tollsPerKm: { value: number; spent: number };
  emiAndLease: { monthly: number; trucks: number };
  costByHead: { head: FleetCostHead; label: string; amount: number }[];
  totalCost: number;
  costByLane: { lane: string; perKm: number }[];
  costByClass: {
    truckTypeId: string | null;
    name: string;
    vehicles: number;
    cost: number;
    perKm: number;
  }[];
  costByTruck: { vehicle: FleetVehicleSummary; cost: number; perKm: number }[];
}

// ─── Energy ────────────────────────────────────────────────────────────────

export interface FleetAnalyticsEnergy {
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
  offBenchmark: { vehicle: FleetVehicleSummary; gapCost: number }[];
  byClass: { truckTypeId: string | null; name: string; vehicles: number; costPerKm: number }[];
  byLane: { lane: string; costPerKm: number }[];
}

// ─── Maintenance ───────────────────────────────────────────────────────────

export type TyreConditionLabel = 'new_like' | 'good' | 'fair' | 'worn' | 'very_worn';

/**
 * Money fields (marked optional) are omitted for a seat without maintenance.costs.view — the
 * workshop figures go to everybody, same split as the maintenance screen.
 */
export interface FleetAnalyticsMaintenance {
  period: FleetAnalyticsPeriodView;
  /** perKm is spend over km read off odometer readings; 0 when no km could be read. */
  spend?: { total: number; perKm: number; jobs: number };
  /** Distance the trucks ran in the period, from odometer readings. */
  distance: { km: number; vehicles: number; estimated: boolean };
  preventiveShare: { pct: number; planned: number; total: number };
  downtime: { days: number; trucks: number };
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

export interface FleetAnalyticsOperations {
  period: FleetAnalyticsPeriodView;
  onTime: { pct: number; late: number; delivered: number };
  turnaroundDays: number;
  detention: { hours: number; loadsPastFreeHours: number };
  recoverableDetention: { amount: number };
  loadingHours: number;
  unloadingHours: number;
  durationAgainstPlan: { pct: number; extraKm: number };
  onTheRoad: { count: number; runningBehind: number };
  detentionByConsignor: { consignor: string; amount: number }[];
  onTimeByLane: { lane: string; pct: number }[];
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

export interface FleetAnalyticsCompliance {
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
    /** What the truck costs standing per day while the paper is out. */
    standingPerDay: number;
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
