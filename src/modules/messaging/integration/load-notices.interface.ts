import { LoadBidEntity } from '../../loads/bids/load-bid.entity';
import { LoadEntity } from '../../loads/entities/load.entity';
import { LoadPaymentEntity } from '../../loads/entities/load-payment.entity';
import { LoadMemoEntity } from '../../loads/memo/load-memo.entity';
import { AcceptMemoInput } from '../../loads/utils/load-memo.interface';
import { LsPartnerPaymentEntity } from '../../loadsmart-ops/entities/ls-partner-payment.entity';
import { InboundResolution } from '../messaging.types';
import { TemplateKey } from '../templates/template-registry';

/**
 * The shapes behind the load-flow WhatsApp notices (load-party-whatsapp.ts, load-notice-store.ts)
 * and the shipper's WhatsApp answers (shipper-reply-actions.ts): what they read, and the ports
 * the load services satisfy.
 */

// ---- Load notices

/** Someone a load notice goes to. */
export interface NoticeContact {
  id: string;
  name: string | null;
  phone: string;
}

/** A load with the places and times its notices quote. */
export interface NoticeLoad {
  load: LoadEntity;
  /** Pickup area ("Gurugram 122001") — {{origin}} / {{from_area}}. */
  origin: string;
  /** Drop city — {{destination}} / {{to_area}}. */
  destination: string;
  /** "lat,lng" of the drop point, else its address — the Get directions link. */
  destinationQuery: string;
  /** When the truck must report at pickup. */
  reportingAt: Date | null;
  /** "32 ft" ({{truck_type}}). */
  truckLabel: string;
}

/** A load's live bids as the shipper sees them: how many, and the lowest rate. */
export interface LiveBidSummary {
  count: number;
  bestRate: string | null;
}

/** The last time a template went to a recipient for a load, and what it said. */
export interface LastSent {
  createdAt: Date;
  variables: Record<string, unknown> | null;
}

/** The partner Loadsmart put on a load it won, with the rate agreed with them. */
export interface LoadPartner {
  contact: NoticeContact;
  partnerRate: string | null;
}

/** An original POD still awaited from the partner. */
export interface AwaitedOriginalPod {
  tenantId: string;
  loadId: string;
  deliveredOn: string;
}

export interface LoadNoticeStore {
  findLoad(tenantId: string, loadId: string): Promise<NoticeLoad | null>;
  findTransporter(tenantId: string, transporterId: string): Promise<NoticeContact | null>;
  findLoadPartner(loadId: string): Promise<LoadPartner | null>;
  findUser(userId: string): Promise<(NoticeContact & { tenantId: string | null }) | null>;
  shipperName(tenantId: string): Promise<string | null>;
  findBid(tenantId: string, bidId: string): Promise<LoadBidEntity | null>;
  findMemo(tenantId: string, memoId: string): Promise<LoadMemoEntity | null>;
  findPartnerPayment(partnerPaymentId: string): Promise<LsPartnerPaymentEntity | null>;
  findLoadPayment(tenantId: string, paymentId: string): Promise<LoadPaymentEntity | null>;
  /** The driver with this number is signed in on the driver app (a live session with a push token). */
  driverHasApp(phone: string): Promise<boolean>;
  /** A WhatsApp with this template already went (or is queued) to this recipient for this load,
   *  since `since` when given. Suppressed rows don't count. */
  hasSent(
    loadId: string,
    templateKey: TemplateKey,
    recipientRefId: string,
    since?: Date,
  ): Promise<boolean>;
  /** Original PODs the partner is still being chased for. */
  listAwaitedOriginalPods(): Promise<AwaitedOriginalPod[]>;
  /** The partner wrote back about this load (a tap or a message) since `since`. */
  partnerRepliedSince(loadId: string, partnerId: string, since: Date): Promise<boolean>;
  liveBidSummary(tenantId: string, loadId: string): Promise<LiveBidSummary>;
  lastSent(
    loadId: string,
    templateKey: TemplateKey,
    recipientRefId: string,
  ): Promise<LastSent | null>;
  /** The shipper's transporters who bid on the load. */
  listTransporterBidders(tenantId: string, loadId: string): Promise<NoticeContact[]>;
  /** The partners who bid on Loadsmart's sourcing of the load. */
  listPartnerBidders(loadId: string): Promise<NoticeContact[]>;
}

/** A signed link to a stored file (the payment proof), fetchable by MSG91 / Meta. */
export type FileLinker = (fileKey: string) => Promise<string>;

/** One load whose bids roll up for the shipper (LS_N_0103). */
export interface BidsRollupJob {
  tenantId: string;
  loadId: string;
}

/** Queues the roll-up for later — one pending per load. */
export type RollupScheduler = (job: BidsRollupJob, delayMs: number) => Promise<void>;

export interface NoticeSendOptions {
  /** Send only if this template never went to this recipient for this load. */
  once?: boolean;
  headerDocument?: { link: string; filename: string };
  driverHasApp?: boolean;
}

// ---- The shipper's answers (Loadsmart's bid, the load memo)

/** A shipper user who posted loads. */
export interface ShipperUser {
  id: string;
  tenantId: string | null;
}

/** A load the shipper user may answer on WhatsApp. */
export interface ShipperLoad {
  tenantId: string;
  loadId: string;
  loadCode: string;
  vehicleNumber: string | null;
  driverName: string | null;
}

/** Loadsmart's live bid on a load, as the shipper answers it. */
export interface LiveLoadsmartBid {
  id: string;
  rate: string;
}

export interface ShipperLoadStore {
  findUser(userId: string): Promise<ShipperUser | null>;
  findUsersByPhone(phones: string[]): Promise<ShipperUser[]>;
  /** Loads this user posted that wait at Bids received with the memo not yet accepted. */
  findLoadsAwaitingMemo(user: ShipperUser): Promise<ShipperLoad[]>;
  /** Market loads this user posted, not awarded yet, with a live bid from Loadsmart. */
  findLoadsWithLoadsmartBid(user: ShipperUser): Promise<ShipperLoad[]>;
  findLoad(user: ShipperUser, loadId: string | null, loadRef: string): Promise<ShipperLoad | null>;
  findLiveLoadsmartBid(tenantId: string, loadId: string): Promise<LiveLoadsmartBid | null>;
  /** The user's latest answer (Accept / Counter / Reject) on this load. */
  latestAnswer(loadId: string, userId: string): Promise<InboundResolution | null>;
}

/** LoadMemoService satisfies this. */
export interface MemoGateway {
  getCurrent(tenantId: string, loadId: string): Promise<{ status: string; vehicleNumber: string }>;
  accept(
    tenantId: string,
    actorId: string,
    loadId: string,
    input: AcceptMemoInput,
  ): Promise<unknown>;
}

/** LoadBidService satisfies this — the shipper's own bid actions, as in the app. */
export interface ShipperBidGateway {
  acceptBid(tenantId: string, actorId: string, loadId: string, bidId: string): Promise<unknown>;
  counterBid(
    tenantId: string,
    actorId: string,
    loadId: string,
    bidId: string,
    input: { rate: number },
  ): Promise<unknown>;
  rejectBid(tenantId: string, actorId: string, loadId: string, bidId: string): Promise<unknown>;
}
