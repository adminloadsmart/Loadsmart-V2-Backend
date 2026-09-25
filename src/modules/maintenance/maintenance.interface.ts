import { DateFilter } from '../../shared/utils/date-filter';
import {
  MaintenanceJobType,
  ServiceType,
  TyreCasingCondition,
  TyreRemovalReason,
  TyreWorkAction,
} from './maintenance.types';

/** Who is writing — the role is needed to resolve an attached invoice's storage key. */
export interface Actor {
  id: string;
  role: string;
}

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
  /** One total, as the Log a service / tyre modals take it. Wins over labour + parts. */
  cost?: number;
  labourCost?: number;
  partsCost?: number;
  partsReplaced?: ReplacedPartInput[];
  /** Confirmed storage key, purpose `maintenance/invoice`. */
  invoiceFileKey?: string;
}

/** Log a service — a finished service, dated the day it is logged unless `serviceDate` says
 *  otherwise. If the truck has an open workshop visit, logging finishes that visit. */
export interface LogServiceInput extends JobCostInput {
  vehicleId: string;
  serviceType: ServiceType;
  odometerKm: number;
  /** The Garage field. */
  workshopName?: string;
  description?: string;
  /** YYYY-MM-DD, not in the future; defaults to today (IST). */
  serviceDate?: string;
}

/** Send a truck to the workshop for a service — it leaves dispatch until the visit is finished
 *  (Log a service, POST /services/:jobId/complete) or released. */
export interface CheckInServiceInput {
  vehicleId: string;
  odometerKm?: number;
  startedAt?: string;
  serviceType?: ServiceType;
  workshopName?: string;
  description?: string;
}

export interface ReleaseFromWorkshopInput {
  closedAt?: string;
  odometerKm?: number;
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
  /** Defaults to what the visit was checked in for, else preventive_service. */
  serviceType?: ServiceType;
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

/** Record Tyre Maintenance — one entry across one or more wheel positions. */
export interface RecordTyreWorkInput {
  vehicleId: string;
  positions: string[];
  action: TyreWorkAction;
  brand: string;
  sizeCode?: string;
  odometerKm: number;
  /** YYYY-MM-DD — the invoice date, also the fitment date. */
  invoiceDate: string;
  workshopName: string;
  totalCost: number;
  invoiceFileKey?: string;
  originalTreadMm?: number;
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
