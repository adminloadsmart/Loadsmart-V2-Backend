import { PaginationInput } from '../../../shared/utils/pagination';
import {
  AssignmentComplianceSubject,
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
import type { AuditAction } from '../../audit/audit.types';
import type { UpdateLoadData } from '../load.repository';
import type { LoadEntity } from '../entities/load.entity';

/** Runs after a load enters a stage (LoadStageService.transition) — e.g. queue the no-tracking
 *  alerts, or open a Loadsmart claim. */
export type LoadStageHook = (load: LoadEntity, to: LoadStatus) => Promise<void>;

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
export interface SettleDeliveryIssueInput {
  /** How the damage, shortage or pilferage was settled. */
  note: string;
}

/** Who meets the truck at the loading point, for this load only. */
export interface SetLoadingContactInput {
  name: string;
  phone: string;
}

export interface SetLoadingPointInput {
  loadingPointId: string;
}

export interface ReviewPodInput {
  decision: PodReviewDecision;
  reason?: string;
}

/** The delivery receipt — photo of the signed/stamped POD, who took it, what came off the truck,
 *  and the seal check, all captured together in one submission. Only podRemarks is optional. */
export interface UploadPodInput {
  podFileKey: string;
  /** The POD's back side — the receiver's remarks on damage, shortage or pilferage. */
  podBackFileKey: string;
  podReceiverName: string;
  /** Absent when the receiver has no phone — the POD photo alone is then the proof. A driver
   *  sending it must have verified it first via LoadService.verifyPodReceiverCode. */
  podReceiverMobile?: string;
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

/** The vehicle and driver going onto a load. Own-fleet paths pass ids; a market Load Assignment
 *  passes the typed-in vehicle and phone numbers, matched to the masters here. */
export interface AssignmentTarget {
  vehicleId?: string | null;
  vehicleNumber?: string | null;
  driverId?: string | null;
  driverPhone?: string | null;
}

/** The expired document that blocks an assignment — the vehicle is checked first. */
export interface AssignmentComplianceFailure {
  subject: AssignmentComplianceSubject;
  /** "Fitness Certificate", "Driving licence". */
  docType: string;
  /** YYYY-MM-DD. */
  expiryDate: string;
}

export interface AssignmentCompliance {
  /** The vehicle / driver master the check read; null when it isn't on file. */
  vehicleId: string | null;
  driverId: string | null;
  driverName: string | null;
  vehicleChecked: boolean;
  driverChecked: boolean;
  failure: AssignmentComplianceFailure | null;
}

export interface StageTransitionInput {
  tenantId: string;
  loadId: string;
  to: LoadStatus;
  /** Null for a system move (live tracking) — no user made it. */
  actorId: string | null;
  /** Set when the driver app made the move — audit_logs.user_id has an FK to auth.users that a
   *  masters.drivers id would violate, so the driver is carried in newData instead. */
  driverOwnerId?: string;
  /** Extra columns written in the same UPDATE as the status. */
  fields?: UpdateLoadData;
  /** Already-read row, to skip a re-read; its status is the expected `from`. */
  load?: LoadEntity;
  auditAction?: AuditAction;
  metadata?: Record<string, unknown>;
}

/** The load fields its stepper path depends on (load-stages.ts's stagePathFor). */
export interface StagePathLoad {
  sourceType: LoadSourceType;
  status: LoadStatus;
  deliveryIssueSettledAt: Date | null;
}

/** The load fields a stage's business preconditions read (load-stages.ts's stageGateError). */
export interface StageGateLoad {
  sourceType: LoadSourceType;
  memoAcceptedAt: Date | null;
  lsPapersApprovedAt?: Date | null;
  podStatus?: string | null;
}

/** What a truck can be tracked with (tracking-source.ts's initialTrackingSource). */
export interface TruckTrackingCapabilities {
  hasGps: boolean;
  hasDriverApp: boolean;
  hasVehicleNumber: boolean;
}
