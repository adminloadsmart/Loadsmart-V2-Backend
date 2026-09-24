import { DateFilter } from '../../shared/utils/date-filter';
import { MaintenanceJobType, TyreCasingCondition, TyreRemovalReason } from './maintenance.types';

/* Period — what follows the window (spend, downtime, job history) and what does not. */

export interface PeriodInput {
  filter?: DateFilter;
  from?: string;
  to?: string;
}

/* Jobs */

export interface ReplacedPartInput {
  name: string;
  quantity: number;
  cost?: number;
}

export interface JobCostInput {
  labourCost?: number;
  partsCost?: number;
  partsReplaced?: ReplacedPartInput[];
}

/**
 * Without `completedAt` this checks the truck in to the workshop (open job, out of dispatch)
 * and POST /services/:jobId/complete checks it out. With `completedAt` it records a service that
 * already happened, in one call, without touching dispatch.
 */
export interface LogServiceInput extends JobCostInput {
  vehicleId: string;
  /** When the truck went in — defaults to now on check-in, or to completedAt for a past service. */
  startedAt?: string;
  completedAt?: string;
  /** Odometer on arrival (check-in) or at the service (past service). */
  odometerKm: number;
  workshopName?: string;
  description?: string;
}

export interface OpenBreakdownInput extends JobCostInput {
  vehicleId: string;
  occurredAt?: string;
  odometerKm?: number;
  locationLabel?: string;
  latitude?: number;
  longitude?: number;
  towed?: boolean;
  workshopName?: string;
  description?: string;
  sourceIssueReportId?: string;
}

export interface CompleteServiceInput extends JobCostInput {
  completedAt?: string;
  odometerKm: number;
  workshopName?: string;
  description?: string;
}

/** Location/towing only mean anything on a breakdown; a service accepts the rest. */
export interface UpdateJobInput extends JobCostInput {
  locationLabel?: string;
  latitude?: number;
  longitude?: number;
  towed?: boolean;
  workshopName?: string;
  description?: string;
}

export interface CloseBreakdownInput extends JobCostInput {
  closedAt?: string;
  odometerKm?: number;
  description?: string;
  /** The due service was also done on this visit — resets the service clock (needs odometerKm). */
  serviceCompleted?: boolean;
}

export interface ListJobsInput extends PeriodInput {
  vehicleId?: string;
  jobType?: MaintenanceJobType;
  page: number;
  limit: number;
}

export interface SetServicePolicyInput {
  serviceIntervalKm: number;
  serviceIntervalMonths: number;
}

/* Tyres */

export interface FitTyreInput {
  vehicleId: string;
  position: string;
  serialNumber?: string;
  brand?: string;
  originalTreadMm: number;
  fittedAt?: string;
  /** Defaults to the vehicle's current odometer. */
  fittedOdometerKm?: number;
  retreadCount?: number;
  maxRetreads?: number;
}

export interface RecordTyreReadingInput {
  treadMm: number;
  readingDate?: string;
  odometerKm?: number;
}

export interface RemoveTyreInput {
  reason: TyreRemovalReason;
  removedAt?: string;
  odometerKm?: number;
  casingCondition?: TyreCasingCondition;
}

/* Batteries */

export interface RegisterBatteryPackInput {
  vehicleId: string;
  serialNumber?: string;
  capacityKwh?: number;
  warrantyStart: string;
  warrantyEnd: string;
  warrantySohFloorPct?: number;
}

export interface RecordBatteryReadingInput {
  /** Any date in the month — normalised to the first. */
  readingMonth: string;
  sohPct: number;
  odometerKm?: number;
}

/* Route params */

export type JobParams = { jobId: string };
export type VehicleParams = { vehicleId: string };
export type TyreParams = { tyreId: string };
export type BatteryPackParams = { packId: string };
