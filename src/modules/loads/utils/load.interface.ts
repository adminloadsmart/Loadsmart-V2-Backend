import { PaginationInput } from '../../masters/utils/masters.types';
import {
  FreightType,
  LoadSourceType,
  LoadStatus,
  LoadStatusGroup,
  ManualTrackingStatus,
  SealStatus,
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

/** Any subset of the three document pairs may be submitted per call — invoiceNumber+
 *  invoiceFileKey and ewayBillNumber+ewayBillFileKey must arrive together, elrFileKey may
 *  arrive without elrNumber (unchanged asymmetry), and at least one document must be present
 *  (see load.validators.ts's confirmLoading). Completeness is decided against the load's
 *  persisted row, not a single call's payload — the load only flips to loading_confirmed once
 *  all three are present, whether accumulated across calls or sent together in one. */
export interface ConfirmLoadingInput {
  invoiceNumber?: string;
  invoiceFileKey?: string;
  ewayBillNumber?: string;
  ewayBillFileKey?: string;
  elrNumber?: string;
  elrFileKey?: string;
}

export interface UpdateLoadStatusInput {
  toStatus: ManualTrackingStatus;
}

/** The delivery receipt — photo of the signed/stamped POD, who took it, what came off the truck,
 *  and the seal check, all captured together in one submission. Only podRemarks is optional. */
export interface UploadPodInput {
  podFileKey: string;
  podReceiverName: string;
  podReceiverMobile: string;
  podReceiverDesignation: string;
  podQuantityReceived: number;
  sealStatus: SealStatus;
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
  /** Matches against the load's requisition's customer name (case-insensitive, partial). */
  search?: string;
}

export type LoadParams = { loadId: string };

export interface EwayBillExpiry {
  expiresAt: string | null;
  expired: boolean;
}
