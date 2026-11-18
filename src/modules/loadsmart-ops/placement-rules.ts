import { LoadStatus } from '../loads/utils/loads.types';
import { SourcingStatus } from './loadsmart.types';

/** Pure Placement rules — no DB/IO; unit-tested in placement-rules.test.ts. */

export interface RosterMember {
  userId: string;
  onDuty: boolean;
  turnOrder: number;
}

/** "New loads are assigned one by one by round robin across members on duty", resetting at
 *  midnight: the member after the one who got today's last load, or the first in turn order. */
export function nextOnDuty(
  roster: RosterMember[],
  lastAssignedToday: string | null,
): string | null {
  const onDuty = roster.filter((member) => member.onDuty).sort((a, b) => a.turnOrder - b.turnOrder);
  if (!onDuty.length) return null;
  const last = onDuty.findIndex((member) => member.userId === lastAssignedToday);
  return onDuty[(last + 1) % onDuty.length].userId;
}

/** Placement's inbox buckets, in work order. */
export const PLACEMENT_BUCKETS = [
  'price_due', // no price to the shipper yet
  'offer_with_shipper', // Loadsmart's price is with the shipper
  'truck_and_driver_due', // the shipper took Loadsmart's price — truck, driver and memo next
  'memo_sent', // waiting for the shipper to accept the memo
] as const;
export type PlacementBucket = (typeof PLACEMENT_BUCKETS)[number];

/** Where a Loadsmart load sits in Placement's work, or null once it has left Placement (memo
 *  accepted, lost, cancelled). */
export function placementBucket(
  sourcingStatus: SourcingStatus,
  loadStatus: LoadStatus,
  memoOpen: boolean,
): PlacementBucket | null {
  if (sourcingStatus === 'pending_approval' || sourcingStatus === 'posted') return 'price_due';
  if (sourcingStatus === 'bid_sent') return 'offer_with_shipper';
  if (sourcingStatus === 'won' && loadStatus === 'bids_received') {
    return memoOpen ? 'memo_sent' : 'truck_and_driver_due';
  }
  return null;
}

export type MatchReason = 'lane' | 'en_route' | 'truck_type';

export interface RankedBroker {
  partnerId: string;
  name: string;
  phone: string;
  /** Ticked in Placement's list: on the load's lane, or added by hand. */
  matched: boolean;
  reasons: MatchReason[];
  loadsOnLane: number;
  rating: number | null;
  /** The broker lane that matched, from lane-matching ("Rajasthan → Punjab"); null for one added
   *  by hand. */
  laneMatch?: { kind: 'lane' | 'en_route'; lane: string; offRouteKm: number } | null;
}

/** Placement's matched list from lane-matching: the brokers on the load's lane in the engine's
 *  order (lane first, then on the way, then the closer one), then any added by hand. */
export function placementBrokerList(
  matches: readonly {
    partnerId: string;
    name: string;
    phone: string;
    match: { kind: 'lane' | 'en_route'; lane: string; offRouteKm: number };
  }[],
  added: readonly { partnerId: string; name: string; phone: string }[],
  loadsOnLane: ReadonlyMap<string, number>,
  ratings: ReadonlyMap<string, number>,
): (RankedBroker & { added: boolean })[] {
  const addedIds = new Set(added.map((partner) => partner.partnerId));
  const onLane = matches.map((broker) => ({
    partnerId: broker.partnerId,
    name: broker.name,
    phone: broker.phone,
    matched: true,
    reasons: [broker.match.kind] as MatchReason[],
    loadsOnLane: loadsOnLane.get(broker.partnerId) ?? 0,
    rating: ratings.get(broker.partnerId) ?? null,
    laneMatch: broker.match,
    added: addedIds.has(broker.partnerId),
  }));
  const listed = new Set(onLane.map((broker) => broker.partnerId));
  const byHand = added
    .filter((partner) => !listed.has(partner.partnerId))
    .map((partner) => ({
      partnerId: partner.partnerId,
      name: partner.name,
      phone: partner.phone,
      matched: true,
      reasons: [] as MatchReason[],
      loadsOnLane: loadsOnLane.get(partner.partnerId) ?? 0,
      rating: ratings.get(partner.partnerId) ?? null,
      laneMatch: null,
      added: true,
    }));
  return [...onLane, ...byHand];
}
