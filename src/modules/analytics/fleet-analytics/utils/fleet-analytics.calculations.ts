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
