import { DataSource, IsNull } from 'typeorm';
import { BrokerEntity } from '../brokers/broker.entity';
import { partnersForBrokers } from './broker-partners';
import { TransporterEntity } from '../masters/transporter/entities/transporter.entity';
import { CityQuery, GeoPlaceResolver, cityKey } from './geo-place-resolver';
import { GeoPoint, regionNamed } from './india-regions';
import {
  Lane,
  LaneMatch,
  LoadRoute,
  MAX_RECIPIENTS,
  bestMatch,
  compareMatches,
  laneEndOf,
  phoneKey,
} from './lane-match-rules';

/** A Loadsmart broker whose lane covers the load, with the partner row its bids are kept on. */
export interface BrokerLaneMatch {
  brokerId: string;
  partnerId: string;
  /** The broker's company — what Placement and WhatsApp call them. */
  name: string;
  contactName: string;
  phone: string;
  onWhatsapp: boolean;
  match: LaneMatch;
}

/** One of the shipper's own transporters whose lane covers the load. */
export interface TransporterLaneMatch {
  transporterId: string;
  name: string;
  phone: string;
  match: LaneMatch;
}

/**
 * The engine behind "a load goes only to the brokers and transporters on its lane": reads the
 * lanes, locates their cities, and matches them with lane-match-rules. Loadsmart's brokers are
 * brokers.brokers (approved only; lanes "origin → each destination", usually states or regions);
 * a shipper's transporters are its active masters with their operating lanes (cities). Best match
 * first, one per phone, at most MAX_RECIPIENTS.
 */
export class LaneMatchService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly geo: Pick<GeoPlaceResolver, 'pointsOf'>,
  ) {}

  async matchBrokers(route: LoadRoute): Promise<BrokerLaneMatch[]> {
    return (await this.matchBrokersMany([route]))[0];
  }

  /** matchBrokers for several loads at once (Placement's queue) — brokers and points read once. */
  async matchBrokersMany(routes: readonly LoadRoute[]): Promise<BrokerLaneMatch[][]> {
    if (!routes.length) return [];
    const brokers = await this.dataSource
      .getRepository(BrokerEntity)
      .find({ where: { status: 'approved' } });
    const laneNames = brokers.map((broker) =>
      broker.laneDestinations.map((to) => [broker.laneOrigin, to] as const),
    );
    const points = await this.geo.pointsOf(
      laneNames
        .flat(2)
        .filter((name) => !regionNamed(name))
        .map((city) => ({ city })),
    );
    const lanes = laneNames.map((names) =>
      names.map(([from, to]): Lane => ({
        from: laneEndOf(from, pointFor(points, { city: from })),
        to: laneEndOf(to, pointFor(points, { city: to })),
      })),
    );
    const perRoute = routes.map((route) =>
      onePerPhone(
        brokers
          .map((broker, index) => ({ broker, match: bestMatch(route, lanes[index]) }))
          .filter((row): row is { broker: BrokerEntity; match: LaneMatch } => row.match !== null)
          .sort(
            (a, b) =>
              compareMatches(a.match, b.match) ||
              b.broker.loadsLast30Days - a.broker.loadsLast30Days ||
              Number(b.broker.rating ?? 0) - Number(a.broker.rating ?? 0) ||
              a.broker.truckerCompany.localeCompare(b.broker.truckerCompany),
          ),
        (row) => row.broker.phone,
      ),
    );
    const partnerIds = await this.partnersFor([
      ...new Map(perRoute.flat().map((row) => [row.broker.id, row.broker])).values(),
    ]);
    return perRoute.map((rows) =>
      rows.map(({ broker, match }) => ({
        brokerId: broker.id,
        partnerId: partnerIds.get(broker.id)!,
        name: broker.truckerCompany,
        contactName: broker.truckerName,
        phone: broker.phone,
        onWhatsapp: broker.isOnWhatsapp,
        match,
      })),
    );
  }

  /** The partner row a broker's bids are kept on — for Placement adding a broker by hand. Null
   *  when the broker doesn't exist or isn't approved. */
  async partnerForBroker(brokerId: string): Promise<string | null> {
    const broker = await this.dataSource
      .getRepository(BrokerEntity)
      .findOne({ where: { id: brokerId, status: 'approved' } });
    if (!broker) return null;
    return (await this.partnersFor([broker])).get(broker.id) ?? null;
  }

  async matchTransporters(tenantId: string, route: LoadRoute): Promise<TransporterLaneMatch[]> {
    const transporters = await this.dataSource.getRepository(TransporterEntity).find({
      where: { tenantId, status: 'active', deletedAt: IsNull() },
      relations: { lanes: true },
    });
    const lanesOf = (transporter: TransporterEntity) =>
      (transporter.lanes ?? []).filter((lane) => !lane.deletedAt);
    const queries: CityQuery[] = transporters.flatMap((transporter) =>
      lanesOf(transporter).flatMap((lane) => [
        { city: lane.originCity, state: lane.originState },
        { city: lane.destinationCity, state: lane.destinationState },
      ]),
    );
    const points = await this.geo.pointsOf(queries.filter((query) => !regionNamed(query.city)));
    const matched = transporters
      .map((transporter) => ({
        transporter,
        match: bestMatch(
          route,
          lanesOf(transporter).map((lane): Lane => ({
            from: laneEndOf(
              lane.originCity,
              pointFor(points, { city: lane.originCity, state: lane.originState }),
            ),
            to: laneEndOf(
              lane.destinationCity,
              pointFor(points, { city: lane.destinationCity, state: lane.destinationState }),
            ),
          })),
        ),
      }))
      .filter(
        (row): row is { transporter: TransporterEntity; match: LaneMatch } => row.match !== null,
      )
      .sort(
        (a, b) =>
          compareMatches(a.match, b.match) || a.transporter.name.localeCompare(b.transporter.name),
      );
    return onePerPhone(matched, (row) => row.transporter.phone).map(({ transporter, match }) => ({
      transporterId: transporter.id,
      name: transporter.name,
      phone: transporter.phone,
      match,
    }));
  }

  /** The ls_partners row each broker's bids are kept on (broker-partners.ts). */
  private partnersFor(brokers: readonly BrokerEntity[]): Promise<Map<string, string>> {
    return partnersForBrokers(this.dataSource, brokers);
  }
}

function pointFor(points: ReadonlyMap<string, GeoPoint | null>, query: CityQuery) {
  return points.get(cityKey(query)) ?? null;
}

/** Keeps the first row per phone, up to MAX_RECIPIENTS. */
function onePerPhone<T>(rows: readonly T[], phoneOf: (row: T) => string): T[] {
  const seen = new Set<string>();
  const kept: T[] = [];
  for (const row of rows) {
    const key = phoneKey(phoneOf(row));
    if (!key || seen.has(key)) continue;
    seen.add(key);
    kept.push(row);
    if (kept.length >= MAX_RECIPIENTS) break;
  }
  return kept;
}
