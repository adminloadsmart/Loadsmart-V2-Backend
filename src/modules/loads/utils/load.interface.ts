import { PaginationInput } from '../../masters/utils/masters.types';
import {
  FreightType,
  LoadSourceType,
  LoadStatus,
  LoadStatusGroup,
  ManualTrackingStatus,
} from './loads.types';

/** Market loads only — own-fleet loads are assigned at Dispatch Planning and never reach this
 *  endpoint (Plan Dispatch v2.0 R-16). `freightValue` is optional: defaults to the load's
 *  `expectedRate` (captured at planning) if the caller doesn't override it with the agreed rate. */
export interface AssignLoadInput {
  transporterId: string;
  vehicleNumber: string;
  driverNumber: string;
  freightType: FreightType;
  freightValue?: number;
}

export interface ConfirmLoadingInput {
  invoiceNumber: string;
  invoiceFileKey: string;
  ewayBillNumber: string;
  ewayBillFileKey: string;
  elrNumber?: string;
  elrFileKey: string;
}

export interface UpdateLoadStatusInput {
  toStatus: ManualTrackingStatus;
}

/** Exactly one of {podFileKey} or {podReceiverName + podQuantityReceived} — enforced by the
 *  validator's `.refine` and re-checked in the service. */
export interface UploadPodInput {
  podFileKey?: string;
  podReceiverName?: string;
  podQuantityReceived?: number;
  podRemarks?: string;
}

export interface ListLoadsInput extends PaginationInput {
  requisitionId?: string;
  status?: LoadStatus;
  /** Trips Home-page tab filter — mutually exclusive with `status` (see load.validators.ts). */
  group?: LoadStatusGroup;
  sourceType?: LoadSourceType;
  transporterId?: string;
  vehicleId?: string;
  driverId?: string;
}

export type LoadParams = { loadId: string };

export interface EwayBillExpiry {
  expiresAt: string | null;
  expired: boolean;
}
