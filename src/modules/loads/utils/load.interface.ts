import type { StageChannel } from '../entities/load-stage-history.entity';
import type { StageActorType, StageTrigger } from '../core/stage-rules';
import { PaginationInput } from '../../../shared/utils/pagination';
import {
  AssignmentComplianceSubject,
  FreightType,
  LoadPostingType,
  LoadRoute,
  LoadStatus,
  LoadStatusGroup,
  PodStatus,
  ManualTrackingStatus,
  PodReviewDecision,
  SealStatus,
  ShortageOrDamageStatus,
} from './loads.types';
import type { AuditAction } from '../../audit/audit.types';
import type { UpdateLoadData } from '../core/load.repository';
import type { LoadEntity } from '../entities/load.entity';

/** Runs after a load enters a stage (LoadStageService.transition) — e.g. queue the no-tracking
 *  alerts, or open a Loadsmart claim. */
export type LoadStageHook = (load: LoadEntity, to: LoadStatus) => Promise<void>;

/** "Withdraw load": the shipper takes the load back before the load memo is accepted. */
export interface WithdrawLoadInput {
  /** Defaults to `shipper_cancelled`. */
  reasonCode?: string;
  note?: string;
}

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
  /** Typed with the invoice number when no invoice file is uploaded (`YYYY-MM-DD`). */
  invoiceDate?: string;
  invoiceValue?: number;
  ewayBillNumber?: string;
  ewayBillFileKey?: string;
  /** Validity date printed on the e-way bill. */
  ewayBillExpiresAt?: Date;
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
  /** Own transporter / indent: whether a deduction was taken from the transporter, and how much. */
  hasDeduction?: boolean;
  deductionAmount?: number;
}

/** Who meets the truck at the loading point, for this load only. */
export interface SetLoadingContactInput {
  name: string;
  phone: string;
  /** "Use for every load from this point": also save it as the loading point master's contact. */
  applyToPoint?: boolean;
}

/** Unloading details — a receiver (name and mobile) or a warehouse appointment (ID, date, slot);
 *  at least one of the two. */
/** Own transporter / indent: whether the shipper took a deduction for the issue, and how much. */
export interface IssueDeductionInput {
  hasDeduction?: boolean;
  amount?: number;
}

export interface UnloadingDetailsInput {
  receiverName?: string;
  receiverPhone?: string;
  appointmentId?: string;
  /** YYYY-MM-DD */
  appointmentDate?: string;
  appointmentSlot?: string;
}

export interface SetLoadingPointInput {
  loadingPointId: string;
}

/** Stage 11 on own transporter / indent — the transporter's invoice, uploaded by the shipper. */
export interface TransporterInvoiceInput {
  fileKey: string;
  invoiceNumber?: string;
  amount?: number;
}

export interface ReviewPodInput {
  decision: PodReviewDecision;
  /** Required when rejecting — what the driver has to fix. */
  reason?: string;
  /** Accepting: the issue on the delivery, 'none' for a clean one. Defaults to the driver's. */
  shortageOrDamage?: ShortageOrDamageStatus;
  issueDetails?: string;
}

/** The delivery receipt — photo of the signed/stamped POD, who took it, what came off the truck,
 *  and the seal check, all captured together in one submission. Only podRemarks is optional. */
export interface UploadPodInput {
  podFileKey: string;
  /** The POD's back side — the receiver's remarks on damage, shortage or pilferage. */
  podBackFileKey?: string;
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
  /** Optional: the invoice stamped by the receiver — kept in the documents register only. */
  stampedInvoiceFileKey?: string;
  podRemarks?: string;
}

export interface ListLoadsInput extends PaginationInput {
  requisitionId?: string;
  status?: LoadStatus;
  /** Trips Home-page tab filter — mutually exclusive with `status` (see load.validators.ts). */
  group?: LoadStatusGroup;
  postingType?: LoadPostingType;
  route?: LoadRoute;
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

/** GET /loads/live — `cursor` is the previous page's opaque nextCursor. */
export interface ListLiveLoadsInput {
  limit: number;
  cursor?: string;
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
  /** Blocks the assignment — an expired driver licence. */
  failure: AssignmentComplianceFailure | null;
  /** Allowed with a warning — each expired vehicle paper, earliest expiry first. */
  warnings: AssignmentComplianceFailure[];
}

export interface StageTransitionInput {
  tenantId: string;
  loadId: string;
  /** What happened — core/stage-rules.ts decides the stage it leads to. */
  trigger: StageTrigger;
  /** Who took the step. Defaults to `driver` with driverOwnerId, `system` with no actorId, and
   *  `shipper` otherwise; Loadsmart ops callers pass `ls_team`. */
  actorType?: StageActorType;
  /** Null for a system move (live tracking) — no user made it. */
  actorId: string | null;
  /** How the move reached us, for the stage history. Derived from the actor when omitted:
   *  driver → driver_app, ls_team → console, tracking metadata → tracking, system, else web. */
  channel?: StageChannel;
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
  postingType: LoadPostingType;
  status: LoadStatus;
  deliveryIssueSettledAt: Date | null;
  /** Only on a cancelled load. */
  cancelledFromStage?: LoadStatus | null;
}

/** What a truck can be tracked with (tracking-source.ts's initialTrackingSource). */
export interface TruckTrackingCapabilities {
  hasGps: boolean;
  hasDriverApp: boolean;
  /** A usable driver mobile number — SIM tracking texts it for consent. */
  hasDriverNumber: boolean;
  hasVehicleNumber: boolean;
}
