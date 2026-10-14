import { VehicleEntity } from '../../../masters/vehicle/entities/vehicle.entity';
import { VehicleDocumentEntity } from '../../../masters/vehicle/entities/vehicle-document.entity';
import { VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY } from '../../../masters/vehicle/vehicle.type';
import { MaintenanceJobEntity } from '../../../maintenance/entities/maintenance-job.entity';
import { SERVICE_CLOCK_TYPES } from '../../../maintenance/maintenance.types';
import { dailyFixedCost } from '../../../maintenance/calculations/downtime';
import { addDays, daysBetween, msToDays, round } from '../../../maintenance/calculations/dates';
import { endOfIstDate, startOfIstDate, toIstDateString } from '../../../../shared/utils/ist-time';
import {
  DocumentBucket,
  FleetVehicleSummary,
  TyreConditionLabel,
} from './fleet-analytics.interface';
import { EXPIRING_SOON_DAYS, EXPIRING_URGENT_DAYS } from './fleet-analytics.constants';

const DAYS_PER_YEAR = 365;
const DAYS_PER_MONTH = 30;

export interface TimeWindow {
  from: Date;
  to: Date;
}

export function toFleetVehicleSummary(vehicle: VehicleEntity): FleetVehicleSummary {
  return {
    id: vehicle.id,
    registrationNumber: vehicle.registrationNumber,
    truckTypeName: vehicle.truckType?.name ?? null,
    ownershipType: vehicle.ownershipType,
  };
}

/** part / whole as a percentage to one decimal, 0 when there is no whole. */
export function pct(part: number, whole: number): number {
  return whole > 0 ? round((part / whole) * 100, 1) : 0;
}

/** Days (fractional) that [start, end] overlaps the window. */
export function overlapDays(start: Date, end: Date, window: TimeWindow): number {
  const from = Math.max(start.getTime(), window.from.getTime());
  const to = Math.min(end.getTime(), window.to.getTime());
  return to > from ? msToDays(to - from) : 0;
}

/** The part of the period the vehicle was on the books for — from onboarding (or the period
 *  start) to the period end, never past now. */
export function activeWindow(vehicle: VehicleEntity, period: TimeWindow, now: Date): TimeWindow {
  const from = new Date(Math.max(vehicle.createdAt.getTime(), period.from.getTime()));
  const to = new Date(Math.min(period.to.getTime(), now.getTime()));
  return { from, to: to > from ? to : from };
}

export interface StandingCost {
  emiAndLease: number;
  insurance: number;
  /** fixed_cost_monthly as entered — already bundles EMI, insurance, salaries etc. */
  otherFixed: number;
  total: number;
}

/** Days of the window that fall on or before `endDate` (all of it when there is no end). */
function daysUntil(window: TimeWindow, endDate: string | null): number {
  const end = endDate ? endOfIstDate(endDate) : window.to;
  return overlapDays(window.from, end, window);
}

/**
 * What a truck cost over the window whether it moved or not. An attached truck costs us nothing
 * standing. Otherwise fixed_cost_monthly wins when entered (it already includes EMI and
 * insurance — same precedence as dailyFixedCost); else EMI until emi_end_date + lease rent until
 * lease_end_date + the yearly insurance premium, each prorated by day.
 */
export function standingCostIn(vehicle: VehicleEntity, window: TimeWindow): StandingCost {
  const zero = { emiAndLease: 0, insurance: 0, otherFixed: 0, total: 0 };
  const meta = vehicle.telemetryMeta;
  if (vehicle.ownershipType === 'attached' || !meta || meta.deletedAt) return zero;

  const days = overlapDays(window.from, window.to, window);
  const base = dailyFixedCost(meta.fixedCostMonthly, null);
  if (base.source === 'fixed') {
    const otherFixed = base.perDay * days;
    return { ...zero, otherFixed, total: otherFixed };
  }

  const emi = (Number(meta.emiAmount ?? 0) / DAYS_PER_MONTH) * daysUntil(window, meta.emiEndDate);
  const lease =
    (Number(meta.leaseRentMonthly ?? 0) / DAYS_PER_MONTH) * daysUntil(window, meta.leaseEndDate);
  const insurance = (Number(meta.insurancePremiumYearly ?? 0) / DAYS_PER_YEAR) * days;
  return { emiAndLease: emi + lease, insurance, otherFixed: 0, total: emi + lease + insurance };
}

/** Current monthly EMI + lease outgo for one truck (each 0 once it has run out). */
export function monthlyEmiAndLease(vehicle: VehicleEntity, today: string): number {
  const meta = vehicle.telemetryMeta;
  if (!meta || meta.deletedAt || vehicle.ownershipType === 'attached') return 0;
  const emiRunning = !meta.emiEndDate || meta.emiEndDate >= today;
  const leaseRunning = !meta.leaseEndDate || meta.leaseEndDate >= today;
  return (
    (emiRunning ? Number(meta.emiAmount ?? 0) : 0) +
    (leaseRunning ? Number(meta.leaseRentMonthly ?? 0) : 0)
  );
}

/** The part of `window` inside `bounds`, collapsed to an empty window when they don't meet. */
export function intersect(window: TimeWindow, bounds: TimeWindow): TimeWindow {
  const from = new Date(Math.max(window.from.getTime(), bounds.from.getTime()));
  const to = new Date(Math.min(window.to.getTime(), bounds.to.getTime()));
  return { from, to: to > from ? to : from };
}

/** The current copy of each dated paper — the latest expiry per document type, so a renewed
 *  paper doesn't leave its expired predecessor counting against the truck. */
export function currentDatedDocuments(vehicle: VehicleEntity): VehicleDocumentEntity[] {
  const latest = new Map<string, VehicleDocumentEntity>();
  for (const document of vehicle.documents ?? []) {
    if (document.deletedAt || !document.expiryDate) continue;
    if (
      !(VEHICLE_DOCUMENT_TYPES_WITH_EXPIRY as readonly string[]).includes(document.documentType)
    ) {
      continue;
    }
    const existing = latest.get(document.documentType);
    if (!existing || document.expiryDate > existing.expiryDate!) {
      latest.set(document.documentType, document);
    }
  }
  return [...latest.values()];
}

export function documentBucket(daysLeft: number): DocumentBucket {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= EXPIRING_URGENT_DAYS) return 'inside7Days';
  if (daysLeft <= EXPIRING_SOON_DAYS) return 'inside30Days';
  return 'inOrder';
}

/** Days inside the window the truck stood blocked because a current paper had lapsed — from the
 *  day after the earliest lapsed paper's expiry until now. */
export function blockedOnPaperDays(
  documents: VehicleDocumentEntity[],
  window: TimeWindow,
  today: string,
  now: Date,
): number {
  const lapsed = documents
    .map((document) => document.expiryDate!)
    .filter((expiry) => expiry < today)
    .sort();
  if (lapsed.length === 0) return 0;
  return overlapDays(startOfIstDate(addDays(lapsed[0], 1)), now, window);
}

/** Age in years from the VAHAN registration date, else from when the truck was onboarded. */
export function vehicleAgeYears(vehicle: VehicleEntity, today: string): number | null {
  const registeredOn = (vehicle.verificationSnapshots ?? [])
    .filter((snapshot) => !snapshot.deletedAt && snapshot.registeredOn)
    .map((snapshot) => snapshot.registeredOn!)
    .sort()
    .at(0);
  const since = registeredOn ?? toIstDateString(vehicle.createdAt);
  const days = daysBetween(since, today);
  return days >= 0 ? round(days / DAYS_PER_YEAR, 1) : null;
}

/** A service check-in released without being serviced isn't a job — same exclusion as the
 *  maintenance spend headline (MaintenanceJobRepository.spendByType). */
export function isCountedJob(job: MaintenanceJobEntity): boolean {
  return !(job.jobType === 'service' && job.status === 'closed' && job.serviceType === null);
}

export type JobCategory = 'preventive' | 'unplannedRepair' | 'roadsideBreakdown';

export function jobCategory(job: MaintenanceJobEntity): JobCategory {
  if (job.jobType === 'breakdown') return 'roadsideBreakdown';
  if (
    job.jobType === 'service' &&
    job.serviceType &&
    SERVICE_CLOCK_TYPES.includes(job.serviceType)
  ) {
    return 'preventive';
  }
  return 'unplannedRepair';
}

export function jobCost(job: MaintenanceJobEntity): number {
  return Number(job.totalCost ?? 0);
}

export function istMonth(date: Date): string {
  return toIstDateString(date).slice(0, 7);
}

export function tyreCondition(treadLeftPct: number): TyreConditionLabel {
  if (treadLeftPct >= 85) return 'new_like';
  if (treadLeftPct >= 70) return 'good';
  if (treadLeftPct >= 50) return 'fair';
  if (treadLeftPct >= 30) return 'worn';
  return 'very_worn';
}

export interface OdometerPoint {
  at: Date;
  km: number;
}

/**
 * Km run inside the window, read off the truck's dated odometer readings (loads carry no
 * distance yet). The odometer at each edge of the window is the reading on that instant if there
 * is one, else interpolated between the readings either side; before the first reading it is
 * the first reading (the truck wasn't on our books), after the last it runs on at the truck's
 * average km/day. A reading lower than an earlier one is a typo and is dropped.
 *
 * `estimated` is true whenever either edge was not an actual reading.
 */
export function kmInWindow(
  points: OdometerPoint[],
  window: TimeWindow,
): { km: number; estimated: boolean } {
  const sorted = [...points].sort((a, b) => a.at.getTime() - b.at.getTime() || a.km - b.km);
  const clean: OdometerPoint[] = [];
  for (const point of sorted) {
    const last = clean.at(-1);
    if (last && point.km < last.km) continue;
    if (last && point.at.getTime() === last.at.getTime()) clean.pop();
    clean.push(point);
  }
  if (clean.length < 2) return { km: 0, estimated: true };

  const first = clean[0];
  const last = clean[clean.length - 1];
  const kmPerMs = (last.km - first.km) / (last.at.getTime() - first.at.getTime());

  const odometerAt = (at: Date): { km: number; exact: boolean } => {
    const t = at.getTime();
    if (t <= first.at.getTime()) return { km: first.km, exact: t === first.at.getTime() };
    if (t >= last.at.getTime()) {
      return { km: last.km + kmPerMs * (t - last.at.getTime()), exact: t === last.at.getTime() };
    }
    const after = clean.findIndex((point) => point.at.getTime() >= t);
    const next = clean[after];
    if (next.at.getTime() === t) return { km: next.km, exact: true };
    const prev = clean[after - 1];
    const share = (t - prev.at.getTime()) / (next.at.getTime() - prev.at.getTime());
    return { km: prev.km + share * (next.km - prev.km), exact: false };
  };

  const start = odometerAt(window.from);
  const end = odometerAt(window.to);
  return {
    km: Math.max(0, Math.round(end.km - start.km)),
    estimated: !start.exact || !end.exact,
  };
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export interface ReplacementInput<T> {
  row: T;
  truckTypeId: string | null;
  ageYears: number | null;
  perKm: number;
}

/**
 * "How much more per km it costs than a new truck of the same class would." The new-truck
 * figure is the median maintenance per km of the young trucks (age ≤ newMaxAge) in the class;
 * a class with fewer than minBenchmark young trucks falls back to the fleet's young median.
 * Young trucks are the benchmark, so they are never candidates themselves.
 */
export function replacementCandidates<T>(
  inputs: ReplacementInput<T>[],
  newMaxAge: number,
  minBenchmark: number,
): {
  row: T;
  perKm: number;
  benchmarkPerKm: number;
  benchmarkScope: 'class' | 'fleet';
  extraPerKm: number;
}[] {
  const isYoung = (input: ReplacementInput<T>) =>
    input.ageYears !== null && input.ageYears <= newMaxAge;
  const young = inputs.filter(isYoung);
  const fleetBenchmark = median(young.map((input) => input.perKm));

  const classBenchmark = new Map<string | null, number | null>();
  const benchmarkOf = (truckTypeId: string | null) => {
    if (!classBenchmark.has(truckTypeId)) {
      const inClass = young.filter((input) => input.truckTypeId === truckTypeId);
      classBenchmark.set(
        truckTypeId,
        truckTypeId !== null && inClass.length >= minBenchmark
          ? median(inClass.map((input) => input.perKm))
          : null,
      );
    }
    return classBenchmark.get(truckTypeId) ?? null;
  };

  return inputs
    .filter((input) => !isYoung(input))
    .flatMap((input) => {
      const ofClass = benchmarkOf(input.truckTypeId);
      const benchmark = ofClass ?? fleetBenchmark;
      if (benchmark === null) return [];
      const extraPerKm = input.perKm - benchmark;
      if (extraPerKm <= 0) return [];
      return [
        {
          row: input.row,
          perKm: input.perKm,
          benchmarkPerKm: benchmark,
          benchmarkScope: ofClass !== null ? ('class' as const) : ('fleet' as const),
          extraPerKm,
        },
      ];
    })
    .sort((a, b) => b.extraPerKm - a.extraPerKm);
}
