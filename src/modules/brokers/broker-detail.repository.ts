import { DataSource, EntityManager, In } from 'typeorm';
import { UserEntity } from '../auth/entities/user.entity';
import { partnersForBrokers } from '../lane-matching/broker-partners';
import { LsOriginalPodEntity } from '../loadsmart-ops/entities/ls-original-pod.entity';
import { LsPartnerBidEntity } from '../loadsmart-ops/entities/ls-partner-bid.entity';
import { LsPartnerEntity } from '../loadsmart-ops/entities/ls-partner.entity';
import { LsPartnerLaneEntity } from '../loadsmart-ops/entities/ls-partner-lane.entity';
import { LsPartnerPaymentEntity } from '../loadsmart-ops/entities/ls-partner-payment.entity';
import { LsSourcingEntity } from '../loadsmart-ops/entities/ls-sourcing.entity';
import { LoadCancellationEntity } from '../loads/entities/load-cancellation.entity';
import { LoadEntity } from '../loads/entities/load.entity';
import { BrokerDocumentEntity } from './broker-document.entity';
import { BrokerNoteEntity } from './broker-note.entity';
import { BrokerEntity } from './broker.entity';

/** The carrier's trip total: per-ton rates times the planned tonnes. */
const trip = (rate: string) =>
  `(CASE WHEN l.freightType = 'per_ton' THEN ${rate} * l.plannedCapacityTonnes ELSE ${rate} END)`;

/** One load the broker's partner carries — feeds "Loads placed" and "Balance due". */
export interface PlacedLoadRow {
  placedAt: Date;
  carrierTrip: string | null;
  advancePaid: string;
  balancePaid: boolean;
}

export interface BidTotals {
  sent: number;
  won: number;
}

/** A row of "Recent loads placed". */
export interface RecentLoadRow {
  loadId: string;
  code: string;
  fromCity: string | null;
  toCity: string | null;
  vehicleNumber: string | null;
  truckTypeName: string | null;
  carrierTrip: string | null;
  podStatus: string | null;
  podCourier: string | null;
  podDeliveredOn: string | null;
  podReceivedAt: Date | null;
  advanceStatus: string | null;
  balanceStatus: string | null;
}

/** One event on the broker's Activity feed, from the loads' timelines and truck cancellations. */
export interface ActivityRow {
  id: string;
  kind:
    | 'bid_placed'
    | 'bid_countered'
    | 'bid_sent_to_shipper'
    | 'bid_won'
    | 'bid_lost'
    | 'truck_placed'
    | 'advance_paid'
    | 'balance_paid'
    | 'truck_cancelled';
  at: Date;
  loadId: string;
  loadCode: string;
  amount: string | null;
  vehicleNumber: string | null;
  detail: string | null;
  actorId: string | null;
}

/** The reads and writes behind the broker page (Masters → Brokers → one broker). */
export class BrokerDetailRepository {
  constructor(private readonly dataSource: DataSource) {}

  transaction<T>(work: (manager: EntityManager) => Promise<T>): Promise<T> {
    return this.dataSource.transaction(work);
  }

  findBroker(id: string, manager: EntityManager = this.dataSource.manager) {
    return manager.getRepository(BrokerEntity).findOneBy({ id });
  }

  /** The broker's ls_partners row (linked or created — see broker-partners.ts), with its lanes. */
  async partnerFor(
    broker: BrokerEntity,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<LsPartnerEntity> {
    const partnerId = (await partnersForBrokers(manager, [broker])).get(broker.id)!;
    return manager.getRepository(LsPartnerEntity).findOneOrFail({
      where: { id: partnerId },
      relations: { lanes: true },
    });
  }

  /** Every non-cancelled load the partner was placed on, with what's been paid against it. */
  placedLoads(partnerId: string): Promise<PlacedLoadRow[]> {
    return this.sourcedBy(partnerId)
      .leftJoin(LsPartnerPaymentEntity, 'pay', 'pay.sourcingId = s.id')
      .select('COALESCE(l.truckAssignedAt, s.createdAt)', 'placedAt')
      .addSelect(`ROUND(${trip('s.partnerRate')}, 2)`, 'carrierTrip')
      .addSelect(
        `COALESCE(SUM(pay.grossAmount) FILTER (WHERE pay.paymentType = 'advance' AND pay.status = 'paid'), 0)`,
        'advancePaid',
      )
      .addSelect(
        `COALESCE(BOOL_OR(pay.paymentType = 'balance' AND pay.status = 'paid'), false)`,
        'balancePaid',
      )
      .groupBy('s.id')
      .addGroupBy('l.id')
      .getRawMany<PlacedLoadRow>();
  }

  /** The partner's bids: how many went to shippers (sent, won or lost) and how many won. */
  async bidTotals(partnerId: string): Promise<BidTotals> {
    const row = await this.dataSource
      .getRepository(LsPartnerBidEntity)
      .createQueryBuilder('b')
      .select(`COUNT(*) FILTER (WHERE b.status IN ('sent', 'won', 'lost'))::int`, 'sent')
      .addSelect(`COUNT(*) FILTER (WHERE b.status = 'won')::int`, 'won')
      .where('b.partnerId = :partnerId', { partnerId })
      .getRawOne<BidTotals>();
    return { sent: row?.sent ?? 0, won: row?.won ?? 0 };
  }

  /** Trucks of this partner cancelled after placement in the last `days` days — a truck
   *  cancellation on a load where the partner's bid carried that vehicle. */
  async trucksCancelled(partnerId: string, days: number): Promise<number> {
    const row = await this.dataSource
      .getRepository(LoadCancellationEntity)
      .createQueryBuilder('c')
      .innerJoin(LsSourcingEntity, 's', 's.loadId = c.loadId')
      .innerJoin(
        LsPartnerBidEntity,
        'b',
        `b.sourcingId = s.id AND b.partnerId = :partnerId
         AND upper(replace(b.vehicleNumber, ' ', '')) = upper(replace(c.vehicleNumber, ' ', ''))`,
        { partnerId },
      )
      .select('COUNT(DISTINCT c.id)::int', 'count')
      .where(`c.kind = 'truck'`)
      .andWhere(`c.status <> 'rejected'`)
      .andWhere(`c.createdAt >= now() - make_interval(days => :days)`, { days })
      .getRawOne<{ count: number }>();
    return row?.count ?? 0;
  }

  /** The partner's most recent loads, newest first. */
  recentLoads(partnerId: string, limit: number): Promise<RecentLoadRow[]> {
    return this.sourcedBy(partnerId)
      .leftJoin('l.posting', 'p')
      .leftJoin('l.truckType', 'tt')
      .leftJoin(LsOriginalPodEntity, 'pod', 'pod.loadId = l.id')
      .leftJoin(LsPartnerBidEntity, 'bid', 'bid.id = s.partnerBidId')
      .leftJoin(
        LsPartnerPaymentEntity,
        'adv',
        "adv.sourcingId = s.id AND adv.paymentType = 'advance' AND adv.status <> 'rejected'",
      )
      .leftJoin(
        LsPartnerPaymentEntity,
        'bal',
        "bal.sourcingId = s.id AND bal.paymentType = 'balance' AND bal.status <> 'rejected'",
      )
      .select([
        'l.id AS "loadId"',
        'l.code AS "code"',
        `p.pickupAddress ->> 'city' AS "fromCity"`,
        `p.dropAddress ->> 'city' AS "toCity"`,
        'COALESCE(l.vehicleNumber, bid.vehicleNumber) AS "vehicleNumber"',
        'tt.name AS "truckTypeName"',
        `ROUND(${trip('s.partnerRate')}, 2) AS "carrierTrip"`,
        'pod.status AS "podStatus"',
        'pod.courierName AS "podCourier"',
        'pod.deliveredOn AS "podDeliveredOn"',
        'pod.receivedAt AS "podReceivedAt"',
        'adv.status AS "advanceStatus"',
        'bal.status AS "balanceStatus"',
      ])
      .orderBy('COALESCE(l.truckAssignedAt, s.createdAt)', 'DESC')
      .limit(limit)
      .getRawMany<RecentLoadRow>();
  }

  notes(brokerId: string) {
    return this.dataSource
      .getRepository(BrokerNoteEntity)
      .find({ where: { brokerId }, order: { createdAt: 'DESC' }, take: 50 });
  }

  addNote(brokerId: string, body: string, createdBy: string) {
    const repo = this.dataSource.getRepository(BrokerNoteEntity);
    return repo.save(repo.create({ brokerId, body, createdBy }));
  }

  /** The partner's latest events across loads, newest first: bids placed, countered, sent to
   *  the shipper, won or lost; the truck placed; advance and balance paid; trucks cancelled.
   *  Built from the LOADSMART_STEP rows on the loads' timelines (load_activities). */
  activity(partnerId: string, limit: number): Promise<ActivityRow[]> {
    return this.dataSource.query(
      `WITH my_bids AS (
         SELECT id, sourcing_id, vehicle_number FROM loads.ls_partner_bids WHERE partner_id = $1
       ),
       steps AS (
         SELECT la.id::text AS id,
                CASE
                  WHEN la.to_value = 'partner_bid' THEN 'bid_placed'
                  WHEN la.to_value = 'broker_countered' THEN 'bid_countered'
                  WHEN la.to_value = 'bid_sent_to_shipper' THEN 'bid_sent_to_shipper'
                  WHEN la.to_value = 'bid_won' AND la.metadata ->> 'partnerId' = $1::text
                    THEN 'bid_won'
                  WHEN la.to_value = 'bid_won' THEN 'bid_lost'
                  WHEN la.to_value = 'driver_named' THEN 'truck_placed'
                  WHEN la.to_value = 'partner_advance_paid' THEN 'advance_paid'
                  ELSE 'balance_paid'
                END AS kind,
                la.created_at AS at,
                l.id AS "loadId",
                l.code AS "loadCode",
                CASE
                  WHEN la.to_value = 'partner_bid'
                    THEN COALESCE(la.metadata ->> 'tripRate', la.metadata ->> 'rate')
                  WHEN la.to_value = 'broker_countered' THEN la.metadata ->> 'brokerRate'
                  -- Won: what this broker gets. Lost: left out — it's the winner's rate.
                  WHEN la.to_value = 'bid_won' AND la.metadata ->> 'partnerId' = $1::text THEN (
                    (la.metadata ->> 'partnerRate')::numeric
                    * CASE WHEN l.freight_type = 'per_ton' THEN l.planned_capacity_tonnes ELSE 1 END
                  )::text
                  WHEN la.to_value IN ('partner_advance_paid', 'partner_balance_paid')
                    THEN la.metadata ->> 'net'
                END AS amount,
                CASE la.to_value
                  WHEN 'partner_bid' THEN la.metadata ->> 'vehicleNumber'
                  WHEN 'driver_named' THEN l.vehicle_number
                END AS "vehicleNumber",
                CASE la.to_value
                  WHEN 'driver_named' THEN la.metadata ->> 'driverName'
                  WHEN 'partner_advance_paid' THEN la.metadata ->> 'utrReference'
                  WHEN 'partner_balance_paid' THEN la.metadata ->> 'utrReference'
                END AS detail,
                -- A bid is won or lost by the shipper's action, not the team's.
                CASE WHEN la.to_value = 'bid_won' THEN NULL ELSE la.actor_id END AS "actorId"
           FROM loads.load_activities la
           JOIN loads.ls_sourcings s ON s.load_id = la.load_id
           JOIN loads.loads l ON l.id = la.load_id
          WHERE la.action = 'LOADSMART_STEP'
            AND (
              (la.to_value IN ('partner_bid', 'broker_countered')
                 AND la.metadata ->> 'partnerId' = $1::text)
              OR (la.to_value = 'bid_sent_to_shipper'
                 AND la.metadata ->> 'partnerBidId' IN (SELECT id::text FROM my_bids))
              OR (la.to_value = 'bid_won'
                 AND EXISTS (SELECT 1 FROM my_bids b WHERE b.sourcing_id = s.id))
              OR (la.to_value IN ('driver_named', 'partner_advance_paid', 'partner_balance_paid')
                 AND s.partner_id = $1)
            )
       ),
       cancels AS (
         SELECT DISTINCT ON (c.id)
                c.id::text AS id, 'truck_cancelled' AS kind, c.created_at AS at,
                l.id AS "loadId", l.code AS "loadCode", NULL::text AS amount,
                c.vehicle_number AS "vehicleNumber", c.reason_code AS detail,
                c.cancelled_by AS "actorId"
           FROM loads.load_cancellations c
           JOIN loads.ls_sourcings s ON s.load_id = c.load_id
           JOIN my_bids b ON b.sourcing_id = s.id
             AND upper(replace(b.vehicle_number, ' ', '')) = upper(replace(c.vehicle_number, ' ', ''))
           JOIN loads.loads l ON l.id = c.load_id
          WHERE c.kind = 'truck' AND c.status <> 'rejected'
       )
       SELECT * FROM (SELECT * FROM steps UNION ALL SELECT * FROM cancels) events
        ORDER BY at DESC
        LIMIT $2`,
      [partnerId, limit],
    );
  }

  documents(brokerId: string) {
    return this.dataSource
      .getRepository(BrokerDocumentEntity)
      .find({ where: { brokerId }, order: { createdAt: 'ASC' } });
  }

  findDocument(brokerId: string, id: string) {
    return this.dataSource.getRepository(BrokerDocumentEntity).findOneBy({ id, brokerId });
  }

  saveDocument(document: Partial<BrokerDocumentEntity>) {
    const repo = this.dataSource.getRepository(BrokerDocumentEntity);
    return repo.save(repo.create(document));
  }

  async deleteDocument(id: string): Promise<void> {
    await this.dataSource.getRepository(BrokerDocumentEntity).delete({ id });
  }

  /** Display names for user ids (approver, note authors); unknown ids are left out. */
  async userNames(ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id))];
    if (!wanted.length) return new Map();
    const users = await this.dataSource
      .getRepository(UserEntity)
      .find({ where: { id: In(wanted) }, select: { id: true, fullName: true, phoneNumber: true } });
    return new Map(users.map((u) => [u.id, u.fullName ?? u.phoneNumber]));
  }

  /** Replaces the partner's preferred lanes. */
  async replaceLanes(
    manager: EntityManager,
    partnerId: string,
    lanes: readonly { fromCity: string; toCity: string }[],
  ): Promise<void> {
    const repo = manager.getRepository(LsPartnerLaneEntity);
    await repo.delete({ partnerId });
    if (lanes.length) await repo.insert(lanes.map((lane) => ({ partnerId, ...lane })));
  }

  /** Loads the partner carries, excluding cancelled sourcings and cancelled loads. */
  private sourcedBy(partnerId: string) {
    return this.dataSource
      .getRepository(LsSourcingEntity)
      .createQueryBuilder('s')
      .innerJoin(LoadEntity, 'l', 'l.id = s.loadId')
      .where('s.partnerId = :partnerId', { partnerId })
      .andWhere(`s.status <> 'cancelled'`)
      .andWhere(`l.status <> 'cancelled'`);
  }
}
