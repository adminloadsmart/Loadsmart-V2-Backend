import type { LoadPostingService } from '../loads/load-posting/load-posting.service';
import type { LoadDocumentService } from '../loads/documents/load-document.service';
import type { SettingsReader } from '../settings/settings.types';
import type { AuditService } from '../audit/audit.service';
import type { StorageService } from '../storage/storage.service';
import type { LoadActivityService } from '../loads/activity/load-activity.service';
import type { LoadBidService } from '../loads/bids/load-bid.service';
import type { LoadMemoService } from '../loads/memo/load-memo.service';
import type { LoadPaymentService } from '../loads/payments/load-payment.service';
import type { LoadRepository } from '../loads/core/load.repository';
import type { LoadService } from '../loads/core/load.service';
import type { LoadStageService } from '../loads/core/load-stage.service';
import type { LoadPostingHooks } from '../loads/load-posting/utils/load-posting.interface';
import type { LoadStageHook } from '../loads/utils/load.interface';
import type { LoadStatus } from '../loads/utils/loads.types';
import type { LoadVerificationService } from '../loads/verification/load-verification.service';
import type { LsPartnerBidEntity } from './entities/ls-partner-bid.entity';
import type { LsSourcingEntity } from './entities/ls-sourcing.entity';
import type { ElrService } from '../loads/elr/elr.service';
import type { BillingInstruction } from './billing-rules';
import type { TrackingClient } from '../../adapters/tracking.client';
import type { LoadCancelService } from '../loads/sourcing/load-cancel.service';
import type { ChargeType, PartnerStatus, PartnerType, PodType } from './loadsmart.types';

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
  /** Loadsmart's own copy of a paper the shipper hasn't uploaded — the shipper's takes over. */
  referenceOnly?: boolean;
}

/** The loading papers Tracking attaches itself (the shipper's copy always takes precedence). */
export interface PapersInput {
  invoiceNumber?: string;
  invoiceFileKey?: string;
  ewayBillNumber?: string;
  ewayBillFileKey?: string;
  /** The validity date printed on the e-way bill. */
  ewayBillExpiresAt?: Date;
  elrNumber?: string;
  elrFileKey?: string;
}

/** A POD Loadsmart's own team captured: no approval step, so the outcome is given with it. */
export interface ConsolePodInput {
  podFileKey: string;
  podBackFileKey?: string;
  outcome: 'delivered_ok' | 'delivered_with_issues';
  /** Required with `delivered_with_issues`. */
  issueType?: 'damage' | 'shortage' | 'pilferage';
  remark?: string;
  receiverName?: string;
  quantityReceived?: number;
  numberOfTonnesShort?: number;
}

export interface DocumentsPageQuery {
  /** Load code, LR / e-LR number or invoice number. */
  q?: string;
  /** An e-LR series prefix, e.g. LSLR. */
  series?: string;
  docType?: string;
  from?: Date;
  to?: Date;
  includeHistory?: boolean;
  page?: number;
  limit?: number;
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

/** A shipper's margin and trucker advance (PUT /terms/:tenantId). marginPercent is Admin-team
 *  only (LS_MARGIN_MANAGE); omitted, the shipper's current margin is kept. */
export interface CommercialTermsInput {
  marginPercent?: number;
  truckerAdvancePercent: number;
  preapprovedCharges?: { head: string; maxAmount?: number | null }[];
  /** Null: the settings' default. */
  creditDays?: number | null;
  podType?: PodType;
  billingInstructions?: BillingInstruction[];
  billingNote?: string | null;
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

/** A bank/UPI payment reference. */
export interface UtrInput {
  utrReference: string;
}

/** What Payables records when it pays a carrier: the UTR, the payment advice, or both. */
export interface PartnerPayInput {
  utrReference?: string;
  /** Uploaded by the Payables member for purpose loads/payment-proof. */
  proofFileKey?: string;
}

/** The shipper's decision on a charge Loadsmart raised. */
export interface ChargeDecisionInput {
  /** `queried`: the shipper asks Loadsmart about it; Tracking's answer brings it back. */
  decision: 'approved' | 'rejected' | 'queried';
  /** Required when rejecting or querying. */
  reason?: string;
}

/** A loading, unloading or detention charge entered by the shipper. */
export interface AddChargeInput {
  chargeType: ChargeType;
  amount: number;
  note?: string;
}

/** The shipper's claim value on a load delivered with issues. */
export interface ClaimValueInput {
  claimValue: number;
  note?: string;
}

/** The POD team's 1–5 scores for shipper and partner. */
export interface RateLoadInput {
  shipperScore: number;
  partnerScore: number;
  note?: string;
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
  settings: SettingsReader;
  loadDocumentService: LoadDocumentService;
  loadPostingService: LoadPostingService;
  elrService: ElrService;
  /** The live map reads each trip's last position and ETA from the tracking service. */
  trackingClient: TrackingClient;
  /** Super Admin approves or rejects a shipper's cancellation of a load Loadsmart has won. */
  loadCancelService: LoadCancelService;
}
