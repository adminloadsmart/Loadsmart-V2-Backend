import type {
  BidCounterStatus,
  BidRateStep,
  BidSource,
  BidStatus,
  LoadStatus,
} from './loads.types';
import type { LoadBidEntity } from '../bids/load-bid.entity';
import type { LoadEntity } from '../entities/load.entity';
import type { LoadParams } from './load.interface';

/** Bids on a market/indent load (bids/) — Sourcing stage 2. */

/** Loadsmart's one best bid: a partner's truck at Loadsmart's price. */
export interface LoadsmartBidInput {
  rate: string;
  /** Null when Loadsmart sends its price before the truck is named — the truck and driver are
   *  entered on the load memo after the shipper accepts, and checked there. */
  vehicleNumber: string | null;
  truckVerified: boolean | null;
  lsPartnerBidId: string;
}

/** Set by the Loadsmart ops module — marks the sourcing won and the partner on the truck. */
export type LoadsmartBidAcceptedHook = (
  bid: LoadBidEntity,
  load: LoadEntity,
  actorId: string,
) => Promise<void>;

/** The shipper countered or rejected Loadsmart's own bid (Placement picks it up). */
export type LoadsmartBidEventHook = (bid: LoadBidEntity, load: LoadEntity) => Promise<void>;

/** What the bid rules (bid-rules.ts) read from a bid. */
export interface BidLike {
  id: string;
  /** Defaults to a transporter's bid. */
  source?: BidSource;
  status: BidStatus;
  rate: string;
  vehicleNumber: string | null;
  /** Govt-portal truck check — null until it runs (Phase 3), then pass/fail. */
  truckVerified: boolean | null;
  expiresAt: Date | null;
  createdAt: Date;
  /** A counter-offer waiting for the bidder's answer keeps Accept off. */
  counterStatus?: BidCounterStatus | null;
  counterRate?: string | null;
}

export type CreateLoadBidData = Pick<
  LoadBidEntity,
  | 'tenantId'
  | 'loadId'
  | 'recipientId'
  | 'source'
  | 'lsPartnerBidId'
  | 'transporterId'
  | 'rate'
  | 'vehicleNumber'
  | 'channel'
  | 'expiresAt'
  | 'enteredBy'
  | 'entryReason'
> &
  Partial<Pick<LoadBidEntity, 'rateHistory'>>;

export interface RecordBidInput {
  transporterId: string;
  rate: number;
  vehicleNumber?: string;
  /** Why the shipper is typing in a rate given by phone — logged with their name. */
  reason?: string;
}

/** "Transporter accepted" — the shipper enters an indent transporter's acceptance given by phone.
 *  Without a truck number it is only noted; with one it is the award. */
export interface IndentAcceptanceInput {
  transporterId: string;
  vehicleNumber?: string;
  reason?: string;
}

/** What recording an indent acceptance produced: the accepted bid once the truck is in, else
 *  `waitingFor: 'truck'`. */
export interface IndentAcceptanceResult {
  loadId: string;
  transporterId: string;
  loadStatus: string;
  waitingFor: 'truck' | null;
  bid: BidView | null;
}

/** A transporter's own reply on WhatsApp: a rate (Accept at the target rate, or typed), the truck
 *  number, or both ("Type your rate in ₹ and the truck number"). */
export interface WhatsappBidInput {
  transporterId: string;
  /** Omitted when only the truck number arrives for a rate already quoted. */
  rate?: number;
  vehicleNumber?: string;
}

export interface BidView {
  id: string;
  /** `loadsmart` bids are shown first and highlighted, without the partner's name. */
  source: LoadBidEntity['source'];
  highlighted: boolean;
  transporter: { id: string | null; name: string };
  rate: string;
  vehicleNumber: string | null;
  truckVerified: boolean | null;
  channel: LoadBidEntity['channel'];
  status: BidStatus;
  /** 1 = best live bid; null for bids that are no longer live. */
  rank: number | null;
  canAccept: boolean;
  /** Why Accept is off, e.g. no truck number yet. */
  acceptBlocker: string | null;
  enteredBy: string | null;
  /** Full name of whoever entered the bid (shipper user or Loadsmart staff); null when unknown. */
  enteredByName: string | null;
  entryReason: string | null;
  expiresAt: string | null;
  createdAt: string;
  /** The shipper's counter-offer and where it stands; null when there's none. */
  counter: {
    rate: string;
    note: string | null;
    status: BidCounterStatus;
    at: string;
    answeredAt: string | null;
  } | null;
  rejectionReason: string | null;
  /** Every rate the bid has carried, oldest first — the table shows only the latest. */
  history: BidRateStep[];
}

export interface CounterBidInput {
  rate: number;
  note?: string;
}

export interface CounterAnswerInput {
  accepted: boolean;
}

export interface LoadBidsView {
  loadId: string;
  loadStatus: LoadStatus;
  /** When bidding closes — 4 hours after the load was sent; null for indent. */
  biddingClosesAt: string | null;
  bids: BidView[];
}

export type LoadBidParams = LoadParams & { bidId: string };
