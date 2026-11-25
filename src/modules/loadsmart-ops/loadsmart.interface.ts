import type { BrokerResponse, BrokerResponseChannel } from './placement-board-rules';
import type { LaneMatchService } from '../lane-matching';
import type { BalancePayer } from './receivables-rules';
import type { LoadPostingService } from '../loads/load-posting/load-posting.service';
import type { LoadPostingLookupService } from '../loads/load-posting/load-posting-lookup.service';
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
import type {
  ChargeType,
  PartnerStatus,
  PartnerType,
  PodType,
  RequirementSendStatus,
} from './loadsmart.types';
import { LoadPartyNotifier } from '../loads/utils/load-party-notifier.interface';

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
  /** How the bid's latest rate came in (the broker's own WhatsApp reply, or Placement's entry);
   *  null when not known. */
  channel: BrokerResponseChannel | null;
  createdAt: string;
  /** Last change to the bid — a revised rate, a truck, or its status. */
  updatedAt: string;
}

/** The broker's latest answer that came in on WhatsApp (their own tap or typed reply). */
export interface BrokerWhatsappReply {
  /** `bid` (a rate), `declined` (Reject), `negotiating` (Negotiate / Give rate tapped, rate not
   *  sent yet), or another logged response marked as WhatsApp. */
  response: BrokerResponse;
  rate: number | null;
  at: string;
}

/** The load's WhatsApp requirement to one broker (ls_requirement_recipients), for Placement. */
export interface BrokerWhatsappActivity {
  /** `sent`; `not_on_whatsapp` (nothing went — call them); `failed` (see failReason). */
  status: RequirementSendStatus;
  /** When it was last sent (or tried). */
  sentAt: string;
  /** Receipts from WhatsApp; `delivered` is often skipped and comes with `read`. */
  deliveredAt: string | null;
  readAt: string | null;
  failReason: string | null;
  lastReply: BrokerWhatsappReply | null;
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
  /** The shipper's advance to Loadsmart, % of freight + approved loading charges. Null: the
   *  load's own advance %, else the settings' default. */
  shipperAdvancePercent?: number | null;
  balancePayer?: BalancePayer;
  shipperAdvanceDays?: number | null;
  physicalLr?: boolean;
  physicalLrNote?: string | null;
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
  /** Required for a bid; optional for a decline / no truck / call back. */
  rate?: number;
  vehicleNumber?: string;
  /** What the broker said (default `bid`). Only a bid becomes the broker's live bid. */
  response?: BrokerResponse;
  /** How it came in (default `manual_entry`). */
  channel?: BrokerResponseChannel;
  note?: string;
}

/** A load just posted on the load board, as partners may see it — Loadsmart's margin taken
 *  out, never the shipper's name. */
export interface LoadBoardOffer {
  sourcingId: string;
  tenantId: string;
  loadId: string;
  loadCode: string;
  /** The partner target rate; null when the shipper asked for quotes. */
  partnerRate: string | null;
  pickupLabel: string;
  dropLabel: string;
  truckLabel: string;
  /** Load weight in tonnes, as posted (null when not given). */
  weightTonnes: string | null;
  pickupAt: Date | null;
  /** The brokers on the load's lane (lane-matching) — the only ones the offer goes to. */
  partners: BoardPartner[];
}

/** A partner a board offer goes to. */
export interface BoardPartner {
  id: string;
  name: string;
  phone: string;
}

/** Tells partners about a load on the board (WhatsApp, from the messaging module). Must not
 *  throw — the load is already posted. */
export interface LoadBoardNotifier {
  postedToBoard(offer: LoadBoardOffer): Promise<void>;
  /** Sends the offer to each of `offer.partners` and says, per partner, whether it went. */
  sendRequirement(offer: LoadBoardOffer): Promise<RequirementSendResult[]>;
}

/** One partner's WhatsApp offer: queued to go (`sent`) or refused before sending (`failed`). */
export interface RequirementSendResult {
  partnerId: string;
  status: 'sent' | 'failed';
  messageLogId: string | null;
  failReason: string | null;
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

/** Super Admin's manual amount/deduction, raised in place of the computed balance and its
 *  holds. */
export interface RaiseBalanceOverride {
  amount: number;
  deduction: number;
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
  loadPostingLookupService: LoadPostingLookupService;
  elrService: ElrService;
  /** The live map reads each trip's last position and ETA from the tracking service. */
  trackingClient: TrackingClient;
  /** Super Admin approves or rejects a shipper's cancellation of a load Loadsmart has won. */
  loadCancelService: LoadCancelService;
  /** Tells the partner on WhatsApp about payments and the original POD (modules/messaging). */
  partyNotifier?: LoadPartyNotifier;
  /** Which of Loadsmart's brokers run a load's lane (modules/lane-matching). */
  brokerMatcher?: BrokerMatcher;
}

/** Loadsmart's brokers on a load's lane, best first (LaneMatchService.matchBrokers). */
export type BrokerMatcher = Pick<
  LaneMatchService,
  'matchBrokers' | 'matchBrokersMany' | 'partnerForBroker'
>;
