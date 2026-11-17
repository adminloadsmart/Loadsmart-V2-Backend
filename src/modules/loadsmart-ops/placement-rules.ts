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

export interface BrokerCandidate {
  partnerId: string;
  name: string;
  phone: string;
  lanes: { fromCity: string; toCity: string }[];
  truckTypes: { bodyType: string; capacityTons: string | null }[];
}

export interface LoadLane {
  fromCity: string | null;
  toCity: string | null;
  bodyType: string | null;
  capacityTons: string | null;
}

export type MatchReason = 'lane' | 'truck_type';

export interface RankedBroker {
  partnerId: string;
  name: string;
  phone: string;
  /** Ticked in Placement's list: claims the lane or the truck type. */
  matched: boolean;
  reasons: MatchReason[];
  loadsOnLane: number;
  rating: number | null;
}

const same = (a: string | null, b: string | null) =>
  !!a && !!b && a.trim().toLowerCase() === b.trim().toLowerCase();

/** "Matched brokers come ticked, with why they matched (lane claimed, truck type claimed), loads
 *  placed on this lane, rating." Both reasons first, then one, then the rest; within each, more
 *  loads on the lane, then the better rating. */
export function rankBrokers(
  load: LoadLane,
  brokers: BrokerCandidate[],
  loadsOnLane: ReadonlyMap<string, number>,
  ratings: ReadonlyMap<string, number>,
): RankedBroker[] {
  return brokers
    .map((broker): RankedBroker => {
      const reasons: MatchReason[] = [];
      if (
        broker.lanes.some(
          (lane) => same(lane.fromCity, load.fromCity) && same(lane.toCity, load.toCity),
        )
      ) {
        reasons.push('lane');
      }
      if (
        broker.truckTypes.some(
          (truck) =>
            same(truck.bodyType, load.bodyType) &&
            (truck.capacityTons === null ||
              load.capacityTons === null ||
              Number(truck.capacityTons) === Number(load.capacityTons)),
        )
      ) {
        reasons.push('truck_type');
      }
      return {
        partnerId: broker.partnerId,
        name: broker.name,
        phone: broker.phone,
        matched: reasons.length > 0,
        reasons,
        loadsOnLane: loadsOnLane.get(broker.partnerId) ?? 0,
        rating: ratings.get(broker.partnerId) ?? null,
      };
    })
    .sort(
      (a, b) =>
        b.reasons.length - a.reasons.length ||
        b.loadsOnLane - a.loadsOnLane ||
        (b.rating ?? 0) - (a.rating ?? 0) ||
        a.name.localeCompare(b.name),
    );
}
