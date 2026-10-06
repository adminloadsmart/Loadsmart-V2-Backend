import { PaginationInput } from '../../../shared/utils/pagination';
import {
  FreightType,
  LoadSourceType,
  LoadStatus,
  LoadStatusGroup,
  PodStatus,
  ManualTrackingStatus,
  PodReviewDecision,
  SealStatus,
  ShortageOrDamageStatus,
} from './loads.types';

/** Market loads only — own-fleet loads are assigned at Dispatch Planning and never reach this
 *  endpoint (Plan Dispatch v2.0 R-16). `freightValue` is optional: defaults to the load's
 *  `expectedRate` (captured at planning) if the caller doesn't override it with the agreed rate. */
export interface AssignLoadInput {
  transporterId: string;
  vehicleNumber: string;
  driverNumber: string;
  driverName?: string;
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
  /** Non-mandatory — up to 3 photos of the loaded truck (back + sides). Never gates the
   *  at_plant -> loading_confirmed flip, unlike the mandatory documents above. */
  loadingPhotoFileKeys?: string[];
  /** Non-mandatory. */
  weighingSlipFileKey?: string;
}

export interface UpdateLoadStatusInput {
  toStatus: ManualTrackingStatus;
}

/** Staff's decision on a pending E-POD — see LoadService.reviewPod. `reason` is required when
 *  rejecting (see load.validators.ts's reviewPodBody), unused when accepting. */
export interface ReviewPodInput {
  decision: PodReviewDecision;
  reason?: string;
}

/** The delivery receipt — photo of the signed/stamped POD, who took it, what came off the truck,
 *  and the seal check, all captured together in one submission. Only podRemarks is optional. */
export interface UploadPodInput {
  podFileKey: string;
  podReceiverName: string;
  podReceiverMobile: string;
  podReceiverDesignation?: string;
  podQuantityReceived: number;
  sealStatus?: SealStatus;
  shortageOrDamage?: ShortageOrDamageStatus;
  numberOfTonnesShort?: number;
  damagePhotoKey?: string;
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
  /** Driver-app POD Status filter. */
  podStatus?: PodStatus;
  /** Inclusive YYYY-MM-DD range (UTC). Applies to deliveredAt when group is 'completed',
   *  otherwise to createdAt. */
  fromDate?: string;
  toDate?: string;
  /** Matches against the load's requisition's customer name (case-insensitive, partial). */
  search?: string;
}

export type LoadParams = { loadId: string };

export interface EwayBillExpiry {
  expiresAt: string | null;
  expired: boolean;
}
