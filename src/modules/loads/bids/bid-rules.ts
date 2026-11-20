import { BidStatus } from '../utils/loads.types';
import { BidLike } from '../utils/load-bid.interface';

/**
 * Pure bidding and load-memo rules from the client's flow — no DB/IO, unit-tested in
 * bid-rules.test.ts.
 */

/** "Bids expire 4 hours after posting." */
export const BID_WINDOW_MS = 4 * 60 * 60 * 1000;
/** "Rate given by phone? The shipper can enter it 30 minutes after sending." */
export const MANUAL_RATE_DELAY_MS = 30 * 60 * 1000;
/** "The load memo expires 1 hour after it is sent." */
export const MEMO_TTL_MS = 60 * 60 * 1000;

/** `extraMinutes`: hours Placement added to this posting's window ("Extend bid window"). */
export function bidWindowClosesAt(sentAt: Date, extraMinutes = 0): Date {
  return new Date(sentAt.getTime() + BID_WINDOW_MS + extraMinutes * 60 * 1000);
}

/** Why the shipper can't type in a phone rate right now, or null when they can. */
export function manualRateError(sentAt: Date, now: Date, extraMinutes = 0): string | null {
  const opensAt = new Date(sentAt.getTime() + MANUAL_RATE_DELAY_MS);
  if (now < opensAt) {
    return `A rate given by phone can be entered from ${opensAt.toISOString()}, 30 minutes after the load was sent`;
  }
  if (now >= bidWindowClosesAt(sentAt, extraMinutes)) {
    return 'Bidding on this load has closed — bids expire 4 hours after posting';
  }
  return null;
}

/** Why the shipper can't enter an indent acceptance given by phone right now, or null when they
 *  can — "You can enter it for him 30 minutes after the request is sent". An indent has no bid
 *  window, so there is no closing time. */
export function manualIndentAcceptError(sentAt: Date, now: Date): string | null {
  const opensAt = new Date(sentAt.getTime() + MANUAL_RATE_DELAY_MS);
  if (now < opensAt) {
    return `An acceptance given by phone can be entered from ${opensAt.toISOString()}, 30 minutes after the request was sent`;
  }
  return null;
}

/** A live bid past its window is expired, whatever the row still says. */
export function effectiveBidStatus(bid: BidLike, now: Date): BidStatus {
  if (bid.status === 'received' && bid.expiresAt && bid.expiresAt <= now) return 'expired';
  return bid.status;
}

/** Why this bid can't be accepted, or null when it can. "Accept needs a verified truck": no
 *  truck number or a failed check keeps Accept off. */
export function acceptBlocker(bid: BidLike, now: Date): string | null {
  const status = effectiveBidStatus(bid, now);
  if (status === 'expired') return 'This bid has expired — bids expire 4 hours after posting';
  if (status !== 'received') return `This bid is already ${status}`;
  if (bid.counterStatus === 'pending') {
    return `Waiting for the answer to your counter of ₹${Number(bid.counterRate)} — record it first`;
  }
  // Loadsmart names its truck and driver on the load memo after the award, not on the bid.
  if (!bid.vehicleNumber && bid.source !== 'loadsmart') {
    return 'Ask the transporter for the truck number';
  }
  if (bid.truckVerified === false) {
    return 'The truck failed the govt portal checks — ask the transporter for another truck';
  }
  return null;
}

/** Live bids, best first: "Loadsmart's bid comes first" (always, highlighted), then a bid that
 *  can be accepted ranks above one that can't, then the lowest rate, then the earliest. */
export function rankBids<T extends BidLike>(bids: T[], now: Date): T[] {
  return bids
    .filter((bid) => effectiveBidStatus(bid, now) === 'received')
    .sort((a, b) => {
      const loadsmart = Number(a.source === 'loadsmart') - Number(b.source === 'loadsmart');
      if (loadsmart !== 0) return -loadsmart;
      const acceptable = Number(!acceptBlocker(a, now)) - Number(!acceptBlocker(b, now));
      if (acceptable !== 0) return -acceptable;
      const byRate = Number(a.rate) - Number(b.rate);
      if (byRate !== 0) return byRate;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
}
