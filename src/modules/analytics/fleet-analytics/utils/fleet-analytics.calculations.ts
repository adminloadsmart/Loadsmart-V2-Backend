import { VehicleEntity } from '../../../masters/vehicle/entities/vehicle.entity';
import { VehicleDocumentEntity } from '../../../masters/vehicle/entities/vehicle-document.entity';
import { MaintenanceJobEntity } from '../../../maintenance/entities/maintenance-job.entity';
import { TyreEntity } from '../../../maintenance/entities/tyre.entity';
import { money } from '../../../maintenance/calculations/downtime';
import { LoadEntity } from '../../../loads/entities/load.entity';
import { RequisitionEntity } from '../../../loads/entities/requisition.entity';
import { addDays, daysBetween, msToDays, round } from '../../../maintenance/calculations/dates';
import { endOfIstDate, startOfIstDate, toIstDateString } from '../../../../shared/utils/ist-time';
import {
  DocumentBucket,
  FleetVehicleSummary,
  TyreConditionLabel,
} from './fleet-analytics.interface';
import {
  AXLE_BODY_TYPE_LABELS,
  COMPLIANCE_DOCUMENT_TYPES,
  DAYS_PER_MONTH,
  DAYS_PER_YEAR,
  EXPIRING_SOON_DAYS,
  EXPIRING_URGENT_DAYS,
  NATIONAL_PERMIT_YEARLY_FEE,
  ON_TIME_WINDOW_MS,
  TRUCK_BODY_TYPE_LABELS,
  TYRE_LEGAL_FLOOR_MM,
  TYRE_NEW_TREAD_MM,
  TYRE_REPLACE_NOW_MM,
  TYRE_RETREAD_FACTOR,
  TYRE_WORN_MM,
  UNCLASSIFIED_BODY_TYPE,
} from './fleet-analytics.constants';

// Calculations for the Fleet Analytics Metric Guide (v1.0, October 2026). Section numbers in the
// comments refer to that document.

export interface TimeWindow {
  from: Date;
  to: Date;
}

/** One IST calendar day of the period. */
export interface PeriodDay extends TimeWindow {
  /** "YYYY-MM-DD" */
  date: string;
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

/** The part of `window` inside `bounds`, collapsed to an empty window when they don't meet. */
export function intersect(window: TimeWindow, bounds: TimeWindow): TimeWindow {
  const from = new Date(Math.max(window.from.getTime(), bounds.from.getTime()));
  const to = new Date(Math.min(window.to.getTime(), bounds.to.getTime()));
  return { from, to: to > from ? to : from };
}

function overlaps(interval: TimeWindow, window: TimeWindow): boolean {
  return interval.from < window.to && interval.to > window.from;
}

/**
 * The calendar days of the period (§1 "Days in period"): from period start to today, or to the
 * period end if earlier. Sundays included.
 */
export function periodDays(fromDate: string, toDate: string, today: string): PeriodDay[] {
  const last = toDate < today ? toDate : today;
  const days: PeriodDay[] = [];
  for (let date = fromDate; date <= last; date = addDays(date, 1)) {
    days.push({ date, from: startOfIstDate(date), to: endOfIstDate(date) });
  }
  return days;
}

// ─── Truck type (§2) ─────────────────────────────────────────────────────────

export interface TruckTypeKey {
  key: string;
  label: string;
}

/** Body type: the axle type for a container sold by axle, else the truck type master's body. */
export function bodyTypeOf(vehicle: VehicleEntity): TruckTypeKey {
  if (vehicle.axleType) {
    return { key: vehicle.axleType, label: AXLE_BODY_TYPE_LABELS[vehicle.axleType] };
  }
  const bodyType = vehicle.truckType?.bodyType;
  if (bodyType) return { key: bodyType, label: TRUCK_BODY_TYPE_LABELS[bodyType] ?? bodyType };
  return { key: UNCLASSIFIED_BODY_TYPE, label: 'Unclassified' };
}

/** Size: tonnage and length, e.g. "18T, 32 ft". Null when neither is on file. */
export function sizeOf(vehicle: VehicleEntity): TruckTypeKey | null {
  const tons = vehicle.capacityTons ?? vehicle.truckType?.capacityTons ?? null;
  const feet = vehicle.bodyLengthFt;
  const parts = [
    tons !== null && Number(tons) > 0 ? `${Number(tons)}T` : null,
    feet ? `${feet} ft` : null,
  ].filter((part): part is string => part !== null);
  if (parts.length === 0) return null;
  const label = parts.join(', ');
  return { key: label, label };
}

/** "Multi Axle · 18T, 32 ft" — the guide's truck label after the truck number. */
export function truckTypeLabel(vehicle: VehicleEntity): string {
  const size = sizeOf(vehicle);
  return [bodyTypeOf(vehicle).label, size?.label].filter(Boolean).join(' · ');
}

export function toFleetVehicleSummary(vehicle: VehicleEntity): FleetVehicleSummary {
  return {
    id: vehicle.id,
    registrationNumber: vehicle.registrationNumber,
    truckTypeName: truckTypeLabel(vehicle),
    bodyType: bodyTypeOf(vehicle).key,
    size: sizeOf(vehicle)?.key ?? null,
    ownershipType: vehicle.ownershipType,
  };
}

export function isAttached(vehicle: VehicleEntity): boolean {
  return vehicle.ownershipType === 'attached';
}

// ─── Daily fixed cost (§7) ───────────────────────────────────────────────────

export interface FixedCostParts {
  emiAndLease: number;
  insurance: number;
  permit: number;
  driverSalary: number;
  total: number;
}

export const ZERO_FIXED_COST: FixedCostParts = {
  emiAndLease: 0,
  insurance: 0,
  permit: 0,
  driverSalary: 0,
  total: 0,
};

export function addFixedCost(a: FixedCostParts, b: FixedCostParts): FixedCostParts {
  return {
    emiAndLease: a.emiAndLease + b.emiAndLease,
    insurance: a.insurance + b.insurance,
    permit: a.permit + b.permit,
    driverSalary: a.driverSalary + b.driverSalary,
    total: a.total + b.total,
  };
}

/**
 * A truck's fixed cost on one calendar day (§7).
 *
 * Owned (outright, financed or leased): EMI or lease ÷ 30 while it runs + insurance premium ÷ 365
 * + permit ÷ 365 + the assigned driver's monthly salary ÷ 30. Permit is the National Permit
 * default for a truck VAHAN lists with one; state permit fees aren't recorded, so 0. Depreciation
 * needs the truck price, which isn't recorded, so it is left out.
 *
 * Attached: the hire is a running cost and rentals aren't recorded, so only our driver's salary.
 */
export function dailyFixedCost(
  vehicle: VehicleEntity,
  driverMonthlySalary: number,
  date: string,
): FixedCostParts {
  const driverSalary = driverMonthlySalary / DAYS_PER_MONTH;
  if (isAttached(vehicle)) return { ...ZERO_FIXED_COST, driverSalary, total: driverSalary };

  const meta =
    vehicle.telemetryMeta && !vehicle.telemetryMeta.deletedAt ? vehicle.telemetryMeta : null;
  const running = (endDate: string | null) => !endDate || endDate >= date;
  const emi = meta && running(meta.emiEndDate) ? Number(meta.emiAmount ?? 0) : 0;
  const lease = meta && running(meta.leaseEndDate) ? Number(meta.leaseRentMonthly ?? 0) : 0;
  const emiAndLease = (emi + lease) / DAYS_PER_MONTH;
  const insurance = Number(meta?.insurancePremiumYearly ?? 0) / DAYS_PER_YEAR;
  const permit = vehicle.hasNationalPermit ? NATIONAL_PERMIT_YEARLY_FEE / DAYS_PER_YEAR : 0;

  return {
    emiAndLease,
    insurance,
    permit,
    driverSalary,
    total: emiAndLease + insurance + permit + driverSalary,
  };
}

/** The truck's fixed cost summed over the given days. */
export function fixedCostOver(
  vehicle: VehicleEntity,
  driverMonthlySalary: number,
  days: PeriodDay[],
): FixedCostParts {
  return days.reduce(
    (total, day) => addFixedCost(total, dailyFixedCost(vehicle, driverMonthlySalary, day.date)),
    ZERO_FIXED_COST,
  );
}

/** Current monthly EMI + lease outgo for one owned truck (each 0 once it has run out). */
export function monthlyEmiAndLease(vehicle: VehicleEntity, today: string): number {
  return dailyFixedCost(vehicle, 0, today).emiAndLease * DAYS_PER_MONTH;
}

// ─── Day status (§8) ─────────────────────────────────────────────────────────

export interface DayBuckets {
  onLoad: number;
  workshop: number;
  idle: number;
}

/**
 * Every day of the period falls in exactly one bucket, checked in this order: on a load (any
 * load overlaps the day), workshop (no load, but a service job or breakdown overlaps it), idle.
 */
export function dayBuckets(
  days: PeriodDay[],
  loadIntervals: TimeWindow[],
  jobIntervals: TimeWindow[],
): DayBuckets {
  const buckets: DayBuckets = { onLoad: 0, workshop: 0, idle: 0 };
  for (const day of days) {
    if (loadIntervals.some((interval) => overlaps(interval, day))) buckets.onLoad += 1;
    else if (jobIntervals.some((interval) => overlaps(interval, day))) buckets.workshop += 1;
    else buckets.idle += 1;
  }
  return buckets;
}

// ─── Loads (§1, §6, §8) ──────────────────────────────────────────────────────

/** Departure: gate-out at the first loading point, or the driver's "Start trip". */
export function loadDeparture(load: LoadEntity): Date | null {
  return load.inTransitAt ?? load.loadingConfirmedAt ?? null;
}

/** Arrival: entry into the unloading geofence, or the driver's "Reached". */
export function loadArrival(load: LoadEntity): Date | null {
  return load.reachedDeliveryPointAt ?? load.deliveredAt ?? null;
}

/** The days the load held the truck: departure to arrival (or now, if still running). */
export function onLoadInterval(load: LoadEntity, now: Date): TimeWindow | null {
  const from = loadDeparture(load);
  if (!from) return null;
  const to = loadArrival(load) ?? now;
  return { from, to: to > from ? to : from };
}

/** Delivered: the load has reached Unloaded. */
export function isDelivered(load: LoadEntity): boolean {
  return load.status === 'delivered' || load.status === 'closed';
}

/** Due time: the promised delivery. Only a date is recorded, so the end of that IST day. */
export function dueAt(load: LoadEntity): Date | null {
  const date = load.requisition?.expectedDeliveryDate;
  return date ? endOfIstDate(date) : null;
}

/** On time (§6): arrived before the window closes, 4 hours after the due time. */
export function isOnTime(arrival: Date, due: Date): boolean {
  return arrival.getTime() <= due.getTime() + ON_TIME_WINDOW_MS;
}

/** Days late past the window close, 0 when on time. */
export function lateDays(arrival: Date, due: Date): number {
  return Math.max(0, msToDays(arrival.getTime() - due.getTime() - ON_TIME_WINDOW_MS));
}

export function hoursBetween(from: Date | null, to: Date | null): number | null {
  if (!from || !to || to <= from) return null;
  return (to.getTime() - from.getTime()) / 3_600_000;
}

/** Hours at the loading point: gate-in to gate-out. */
export function loadingHours(load: LoadEntity): number | null {
  return hoursBetween(load.atPlantAt, load.inTransitAt ?? load.loadingConfirmedAt);
}

/** Hours at the unloading point: gate-in to gate-out. */
export function unloadingHours(load: LoadEntity): number | null {
  return hoursBetween(load.reachedDeliveryPointAt, load.deliveredAt);
}

/** Turnaround (§13): first loading gate-in to last unloading gate-out, in days. */
export function turnaroundDays(load: LoadEntity): number | null {
  const hours = hoursBetween(load.atPlantAt, load.deliveredAt);
  return hours === null ? null : hours / 24;
}

export interface Lane {
  /** `${loadingPointId}:${customerDeliveryPointId}` — the value the lane filter takes. */
  key: string;
  label: string;
}

/** The lane a requisition runs: loading point city to delivery point city. */
export function laneOfRequisition(requisition: RequisitionEntity | null | undefined): Lane | null {
  if (!requisition) return null;
  const from = requisition.loadingPoint?.city ?? 'Unknown';
  const delivery = requisition.customerDeliveryPoint;
  const to = delivery?.city ?? delivery?.location ?? 'Unknown';
  return {
    key: `${requisition.loadingPointId}:${requisition.customerDeliveryPointId}`,
    label: `${from} → ${to}`,
  };
}

export function laneOf(load: LoadEntity): Lane | null {
  return laneOfRequisition(load.requisition);
}

// ─── Documents (§18) ─────────────────────────────────────────────────────────

function isComplianceDocument(document: VehicleDocumentEntity): boolean {
  return (
    !document.deletedAt &&
    Boolean(document.expiryDate) &&
    (COMPLIANCE_DOCUMENT_TYPES as readonly string[]).includes(document.documentType)
  );
}

/** The current copy of each compliance document — the latest expiry per type, so a renewed
 *  paper doesn't leave its expired predecessor counting against the truck. */
export function currentDatedDocuments(vehicle: VehicleEntity): VehicleDocumentEntity[] {
  const latest = new Map<string, VehicleDocumentEntity>();
  for (const document of vehicle.documents ?? []) {
    if (!isComplianceDocument(document)) continue;
    const existing = latest.get(document.documentType);
    if (!existing || document.expiryDate! > existing.expiryDate!) {
      latest.set(document.documentType, document);
    }
  }
  return [...latest.values()];
}

/** Expired: below 0 days left. Within 7 days: 0–7. Then 8–30. In order: above 30. */
export function documentBucket(daysLeft: number): DocumentBucket {
  if (daysLeft < 0) return 'expired';
  if (daysLeft <= EXPIRING_URGENT_DAYS) return 'inside7Days';
  if (daysLeft <= EXPIRING_SOON_DAYS) return 'inside30Days';
  return 'inOrder';
}

/** When a paper starts covering the truck: its issue date, else when it was entered. */
function coverageStart(document: VehicleDocumentEntity): Date {
  return document.issueDate ? startOfIstDate(document.issueDate) : document.createdAt;
}

/**
 * Every stretch a compliance document was out — for each type, from the day after a copy expired
 * until a later copy started covering the truck (or now, if none has). Reads every copy, so a
 * paper that lapsed and was renewed still shows the days it was out.
 */
export function lapsedPaperIntervals(documents: VehicleDocumentEntity[], now: Date): TimeWindow[] {
  const byType = new Map<string, VehicleDocumentEntity[]>();
  for (const document of documents) {
    if (!isComplianceDocument(document)) continue;
    byType.set(document.documentType, [...(byType.get(document.documentType) ?? []), document]);
  }

  const intervals: TimeWindow[] = [];
  for (const copies of byType.values()) {
    const sorted = [...copies].sort((a, b) => a.expiryDate!.localeCompare(b.expiryDate!));
    sorted.forEach((copy, index) => {
      const lapsedFrom = startOfIstDate(addDays(copy.expiryDate!, 1));
      if (lapsedFrom >= now) return;
      const renewal = sorted.slice(index + 1).find((next) => next.expiryDate! > copy.expiryDate!);
      const renewedAt = renewal ? coverageStart(renewal) : now;
      const to = renewedAt < now ? renewedAt : now;
      if (to > lapsedFrom) intervals.push({ from: lapsedFrom, to });
    });
  }
  return intervals;
}

/** Whether any compliance document was expired at that instant. */
export function hadExpiredDocumentAt(
  documents: VehicleDocumentEntity[],
  at: Date,
  now: Date,
): boolean {
  return lapsedPaperIntervals(documents, now).some(
    (interval) => at >= interval.from && at < interval.to,
  );
}

// ─── Maintenance (§16) ───────────────────────────────────────────────────────

/** Age in years from the VAHAN registration date (no purchase date is recorded), else from when
 *  the truck was onboarded. */
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

/** Preventive service jobs are planned; every other service job and every tyre replacement is
 *  unplanned; breakdowns are roadside. */
export function jobCategory(job: MaintenanceJobEntity): JobCategory {
  if (job.jobType === 'breakdown') return 'roadsideBreakdown';
  if (job.jobType === 'service' && job.serviceType === 'preventive_service') return 'preventive';
  return 'unplannedRepair';
}

/** The preventive share counts service jobs and breakdowns, not tyre replacements. */
export function isServiceOrBreakdown(job: MaintenanceJobEntity): boolean {
  return job.jobType === 'service' || job.jobType === 'breakdown';
}

export function jobCost(job: MaintenanceJobEntity): number {
  return Number(job.totalCost ?? 0);
}

/** The stretch a job kept the truck in the workshop: opened to closed (or now). */
export function jobInterval(job: MaintenanceJobEntity, now: Date): TimeWindow {
  const to = job.closedAt ?? now;
  return { from: job.openedAt, to: to > job.openedAt ? to : job.openedAt };
}

export function istMonth(date: Date): string {
  return toIstDateString(date).slice(0, 7);
}

/** New tread depth of a tyre: by size, else its recorded original tread; a retread casing starts
 *  at 78% of it. */
export function newTreadMm(
  tyre: Pick<TyreEntity, 'sizeCode' | 'originalTreadMm' | 'retreadCount'>,
): number {
  const size = tyre.sizeCode?.replace(/\s+/g, '').toUpperCase() ?? '';
  const base = TYRE_NEW_TREAD_MM[size] ?? Number(tyre.originalTreadMm);
  return tyre.retreadCount > 0 ? base * TYRE_RETREAD_FACTOR : base;
}

/** Tyre life left (§16): tread above the legal floor over new tread above the floor, 0 to 1. */
export function tyreLifeLeft(treadMm: number, newTread: number): number {
  const usable = newTread - TYRE_LEGAL_FLOOR_MM;
  if (usable <= 0) return 0;
  return Math.min(1, Math.max(0, (treadMm - TYRE_LEGAL_FLOOR_MM) / usable));
}

/** Tyre condition bands (§16). */
export function tyreBand(treadMm: number, lifeLeft: number): TyreConditionLabel {
  if (treadMm <= TYRE_REPLACE_NOW_MM) return 'very_worn';
  if (treadMm <= TYRE_WORN_MM) return 'worn';
  if (lifeLeft >= 0.8) return 'new_like';
  if (lifeLeft >= 0.5) return 'good';
  return 'fair';
}

// ─── Kilometres (§3) ─────────────────────────────────────────────────────────

export interface OdometerPoint {
  at: Date;
  km: number;
}

/**
 * Km run inside the window, read off the truck's dated odometer readings (§3 "Recorded odometer
 * readings"; there is no GPS yet). The odometer at each edge of the window is the reading on that
 * instant if there is one, else interpolated between the readings either side; before the first
 * reading it is the first reading, after the last it runs on at the truck's average km/day. A
 * reading lower than an earlier one is a typo and is dropped.
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

/** Cost per km, or null when no km could be read — a ratio over nothing is not a measurement. */
export function perKm(cost: number, km: number): number | null {
  return km > 0 ? money(cost / km) : null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function average(values: number[]): number | null {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

// ─── Replacement candidates (interim) ────────────────────────────────────────

export interface ReplacementInput<T> {
  row: T;
  truckTypeKey: string;
  ageYears: number | null;
  perKm: number;
}

/**
 * Interim until truck prices exist (the guide's formula needs a new truck's price): how much more
 * per km a truck costs to maintain than the young trucks (age ≤ newMaxAge) of its truck type; a
 * type with fewer than minBenchmark young trucks falls back to the fleet's young median. Young
 * trucks are the benchmark, so they are never candidates themselves.
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

  const typeBenchmark = new Map<string, number | null>();
  const benchmarkOf = (key: string) => {
    if (!typeBenchmark.has(key)) {
      const ofType = young.filter((input) => input.truckTypeKey === key);
      typeBenchmark.set(
        key,
        ofType.length >= minBenchmark ? median(ofType.map((input) => input.perKm)) : null,
      );
    }
    return typeBenchmark.get(key) ?? null;
  };

  return inputs
    .filter((input) => !isYoung(input))
    .flatMap((input) => {
      const ofType = benchmarkOf(input.truckTypeKey);
      const benchmark = ofType ?? fleetBenchmark;
      if (benchmark === null) return [];
      const extraPerKm = input.perKm - benchmark;
      if (extraPerKm <= 0) return [];
      return [
        {
          row: input.row,
          perKm: input.perKm,
          benchmarkPerKm: benchmark,
          benchmarkScope: ofType !== null ? ('class' as const) : ('fleet' as const),
          extraPerKm,
        },
      ];
    })
    .sort((a, b) => b.extraPerKm - a.extraPerKm);
}
