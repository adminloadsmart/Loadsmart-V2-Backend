import type { AuditService } from '../audit/audit.service';
import type { StorageService } from '../storage/storage.service';
import type { LoadActivityService } from '../loads/load-activity.service';
import type { LoadBidService } from '../loads/bids/load-bid.service';
import type { LoadEntity } from '../loads/entities/load.entity';
import type { LoadMemoService } from '../loads/memo/load-memo.service';
import type { LoadPaymentService } from '../loads/load-payment.service';
import type { LoadRepository } from '../loads/load.repository';
import type { LoadService } from '../loads/load.service';
import type { LoadStageService } from '../loads/load-stage.service';
import type { LoadPostingHooks } from '../loads/load-posting/utils/load-posting.interface';
import type { LoadStageHook } from '../loads/utils/load.interface';
import type { LoadStatus } from '../loads/utils/loads.types';
import type { LoadVerificationService } from '../loads/verification/load-verification.service';
import type { NotificationTriggers } from '../notifications/notifications.interface';
import type { LoadClaimEntity } from './entities/load-claim.entity';
import type { LsInvoiceEntity } from './entities/ls-invoice.entity';
import type { LsPartnerBidEntity } from './entities/ls-partner-bid.entity';
import type { LsSourcingEntity } from './entities/ls-sourcing.entity';
import type { ChargeType, PartnerStatus, PartnerType } from './loadsmart.types';

/** Loadsmart ops shapes — service inputs, views and amounts (value sets live in loadsmart.types.ts). */

/** Route params of the ops console endpoints (`:partnerId`, `:sourcingId`, `:tenantId`, …). */
export type LoadsmartRouteParams = Record<string, string>;

export interface PartnerPaymentAmounts {
  gross: number;
  tds: number;
  deductions: number;
  net: number;
}

export interface InvoiceAmounts {
  freight: number;
  charges: number;
  claimCredit: number;
  taxable: number;
  gstPercent: number;
  gst: number;
  total: number;
  advanceReceived: number;
  balanceDue: number;
}

export interface BundleDocument {
  type: string;
  label: string;
  fileKey: string;
  downloadUrl: string | null;
}

export interface PartnerInput {
  name: string;
  phone: string;
  partnerType: PartnerType;
  status?: PartnerStatus;
  tdsPercent?: number;
  bankAccountNumber?: string;
  bankIfsc?: string;
  upiId?: string;
}

/** A partner as a bid shows it. */
export interface PartnerSummary {
  id: string;
  name: string;
  partnerType: PartnerType;
}

/** A partner on Placement's call list. */
export interface PartnerContact {
  id: string;
  name: string;
  phone: string;
}

export interface PartnerBidView {
  id: string;
  partner: PartnerSummary;
  rate: string;
  vehicleNumber: string | null;
  truckVerified: boolean | null;
  status: LsPartnerBidEntity['status'];
  /** Loadsmart's price to the shipper at the sourcing's margin. */
  shipperPrice: number;
  createdAt: string;
}

export interface PlacementView {
  sourcing: LsSourcingEntity;
  bids: PartnerBidView[];
  /** "Calls partners who haven't bid in 5 minutes" — empty until the load has been on the board
   *  for 5 minutes. */
  callList: PartnerContact[];
}

export interface LoadBoardRoute {
  from: string | null;
  to: string | null;
}

/** Partners see only Loadsmart's rate to them — never the shipper, the target or the margin. */
export interface LoadBoardRow {
  sourcingId: string;
  loadCode: string;
  partnerRate: string | null;
  pickupAt: string | null;
  route: LoadBoardRoute;
  truckTypeId: string | null;
  weightTonnes: string | null;
}

/** Who is acting on the ops console — platform staff (role decides e.g. "no bids from sales"). */
export interface LoadsmartActor {
  id: string;
  role: string;
}

/** The sourcing fields a timeline/audit step needs (LsServiceBase.step). */
export type SourcingRef = Pick<LsSourcingEntity, 'id' | 'tenantId' | 'loadId'>;

/** A shipper's margin and trucker advance (PUT /terms/:tenantId). */
export interface CommercialTermsInput {
  marginPercent: number;
  truckerAdvancePercent: number;
}

/** Approval team posts the load on the board, optionally changing the terms. */
export interface ApproveSourcingInput {
  marginPercent?: number;
  truckerAdvancePercent?: number;
  /** Required when the posting has missing fields. */
  acknowledgeMissing?: boolean;
}

/** Placement records a partner's rate and truck. */
export interface PartnerBidInput {
  partnerId: string;
  rate: number;
  vehicleNumber?: string;
}

/** Placement sends one partner bid to the shipper as Loadsmart's. */
export interface SendBidInput {
  partnerBidId: string;
  shipperPrice?: number;
  /** Required under MIN_MARGIN_PERCENT. */
  negotiationNote?: string;
}

/** Verification team approval — fills the loading contact when the shipper hasn't. */
export interface ApproveVerificationInput {
  loadingContactName?: string;
  loadingContactPhone?: string;
}

/** The shipper's papers check at the loading point. */
export interface ApprovePapersInput {
  ewayBillNamesLoadsmart: boolean;
}

/** A bank/UPI payment reference. */
export interface UtrInput {
  utrReference: string;
}

/** The shipper's decision on a charge Loadsmart raised. */
export interface ChargeDecisionInput {
  decision: 'approved' | 'rejected';
  /** Required when rejecting. */
  reason?: string;
}

/** A loading, unloading or detention charge entered by the shipper. */
export interface AddChargeInput {
  chargeType: ChargeType;
  amount: number;
  note?: string;
}

/** Who will receive the truck at the drop. */
export interface UnloadingContactInput {
  name: string;
  phone: string;
}

/** The shipper's claim value on a load delivered with issues. */
export interface ClaimValueInput {
  claimValue: number;
  note?: string;
}

/** Settling a claim: what is recovered from the partner. */
export interface SettleClaimInput {
  partnerRecovery: number;
  note: string;
}

/** The POD team's 1–5 scores for shipper and partner. */
export interface RateLoadInput {
  shipperScore: number;
  partnerScore: number;
  note?: string;
}

/** The signed original POD received at the office. */
export interface OriginalPodInput {
  courierName?: string;
  trackingNumber?: string;
}

export interface GenerateInvoiceInput {
  gstPercent?: number;
  dueDays?: number;
}

export interface GeneratedInvoice {
  invoice: LsInvoiceEntity;
  downloadUrl: string | null;
}

/** One row of the CS queue — a load delivered with issues and its claim. */
export interface ClaimQueueItem {
  load: LoadEntity;
  claim: LoadClaimEntity | null;
}

/** When a charge type can be added, and what to say otherwise. */
export interface ChargeStageRule {
  statuses: readonly LoadStatus[];
  message: string;
}

/** A document key on the load, before its download URL is resolved. */
export interface LoadDocumentKey {
  type: string;
  label: string;
  key: string | null;
}

/** What the partner's balance is worked out from. */
export interface PartnerBalanceInput {
  partnerTrip: number;
  approvedCharges: number;
  advanceGross: number;
  claimRecovery: number;
  tdsPercent: number;
}

/** What the shipper's invoice is worked out from. */
export interface InvoiceAmountsInput {
  freight: number;
  approvedCharges: number;
  claimCredit: number;
  gstPercent: number;
  advanceReceived: number;
}

/** A pickup/drop pin as the posting stores it. */
export interface PostingPin {
  latitude: number | null;
  longitude: number | null;
}

/** The posting fields the Approval team checks before posting the load. */
export interface SourcingPostingFields {
  customerId: string | null;
  rate: string | null;
  pickupAt: Date | null;
  weightTonnes: string | null;
  truckTypeId: string | null;
  pickupAddress: PostingPin | null;
  dropAddress: PostingPin | null;
}

/** What the Loadsmart ops module needs from the rest of the app (createLoadsmartOpsModule). */
export interface LoadsmartOpsModuleDeps {
  auditService: AuditService;
  storageService: StorageService;
  notificationTriggers: NotificationTriggers;
  loadActivityService: LoadActivityService;
  loadRepository: LoadRepository;
  loadService: LoadService;
  loadStageService: LoadStageService;
  loadBidService: LoadBidService;
  loadMemoService: LoadMemoService;
  loadVerificationService: LoadVerificationService;
  loadPaymentService: LoadPaymentService;
  postingHooks: LoadPostingHooks;
  stageHooks: LoadStageHook[];
}
