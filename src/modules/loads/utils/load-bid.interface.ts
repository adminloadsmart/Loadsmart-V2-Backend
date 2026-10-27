import type { BidSource, BidStatus, LoadStatus } from './loads.types';
import type { LoadBidEntity } from '../bids/load-bid.entity';
import type { LoadEntity } from '../entities/load.entity';
import type { LoadParams } from './load.interface';

/** Bids on a market/indent load (bids/) — Sourcing stage 2. */

/** Loadsmart's one best bid: a partner's truck at Loadsmart's price. */
export interface LoadsmartBidInput {
  rate: string;
  vehicleNumber: string;
  truckVerified: boolean | null;
  lsPartnerBidId: string;
}

/** Set by the Loadsmart ops module — marks the sourcing won and the partner on the truck. */
export type LoadsmartBidAcceptedHook = (
  bid: LoadBidEntity,
  load: LoadEntity,
  actorId: string,
) => Promise<void>;

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
>;

export interface RecordBidInput {
  transporterId: string;
  rate: number;
  vehicleNumber?: string;
  /** Why the shipper is typing in a rate given by phone — logged with their name. */
  reason: string;
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
  entryReason: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface LoadBidsView {
  loadId: string;
  loadStatus: LoadStatus;
  /** When bidding closes — 4 hours after the load was sent; null for indent. */
  biddingClosesAt: string | null;
  bids: BidView[];
}

export type LoadBidParams = LoadParams & { bidId: string };
