/**
 * Pure rules for a broker's bid history on the Placement page — no DB/IO. Besides what the broker
 * said (ls_partner_bid_responses), the history shows what happened to Loadsmart's bids built on
 * this broker's bid: sent to the shipper, countered, the counter taken to the broker, the answer,
 * and how each bid ended (won, rejected, lost to another bid, replaced by a new price).
 */
import type { BidRateStep } from '../loads/utils/loads.types';

export const LOADSMART_BID_EVENTS = [
  'sent_to_shipper',
  'shipper_countered',
  'broker_countered',
  'counter_accepted',
  'counter_declined',
  'shipper_rejected',
  'replaced',
  'won',
  'lost',
] as const;
export type LoadsmartBidEvent = (typeof LOADSMART_BID_EVENTS)[number];

/** What a Loadsmart bid needs for its events. Rates are in the load's own basis. */
export interface LoadsmartBidFacts {
  id: string;
  lsPartnerBidId: string | null;
  status: string;
  rateHistory: BidRateStep[] | null;
  createdAt: Date;
  decidedAt: Date | null;
  rejectionReason: string | null;
}

export interface LoadsmartBidHistoryEvent {
  id: string;
  at: Date;
  event: LoadsmartBidEvent;
  /** In the load's own basis — the caller turns it into a trip total. Null when none applies. */
  rate: string | null;
  note: string | null;
}

const STEP_EVENTS: Record<BidRateStep['kind'], LoadsmartBidEvent> = {
  bid: 'sent_to_shipper',
  revised: 'sent_to_shipper',
  counter: 'shipper_countered',
  counter_accepted: 'counter_accepted',
  counter_declined: 'counter_declined',
};

/** Every step of Loadsmart's bids on one broker's bid, in no particular order. A rejected bid
 *  reads as replaced when a newer Loadsmart bid on the same broker bid followed it (Placement sent
 *  a new price), lost when the shipper awarded another bid, else rejected by the shipper. */
export function loadsmartBidEvents(
  bids: LoadsmartBidFacts[],
  awardedBidId: string | null,
): LoadsmartBidHistoryEvent[] {
  const events: LoadsmartBidHistoryEvent[] = [];
  for (const bid of bids) {
    (bid.rateHistory ?? []).forEach((step, index) => {
      events.push({
        id: `${bid.id}:${index}`,
        at: new Date(step.at),
        event: STEP_EVENTS[step.kind],
        rate: step.rate,
        note: step.kind === 'revised' ? 'New price' : null,
      });
    });
    if (!bid.decidedAt) continue;
    const end = { id: `${bid.id}:end`, at: bid.decidedAt, rate: null };
    if (bid.status === 'accepted') {
      events.push({ ...end, event: 'won', note: 'The shipper accepted this bid' });
    } else if (bid.status === 'rejected') {
      const replaced = bids.some(
        (other) =>
          other.id !== bid.id &&
          other.lsPartnerBidId === bid.lsPartnerBidId &&
          other.createdAt >= bid.createdAt,
      );
      if (replaced) {
        events.push({ ...end, event: 'replaced', note: 'A new price went to the shipper' });
      } else if (awardedBidId && awardedBidId !== bid.id) {
        events.push({ ...end, event: 'lost', note: 'The shipper chose another bid' });
      } else {
        events.push({ ...end, event: 'shipper_rejected', note: bid.rejectionReason });
      }
    }
  }
  return events;
}
