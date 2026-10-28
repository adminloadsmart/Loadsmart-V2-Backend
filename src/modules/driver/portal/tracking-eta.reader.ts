import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { DrivingRoute, GoogleRoutesClient, LatLng } from '../../../adapters/google-routes.client';
import { env } from '../../../config/env';
import { CustomerDeliveryPointEntity } from '../../customers/entities/customer-delivery-point.entity';
import { LoadEntity } from '../../loads/entities/load.entity';
import { LoadingPointEntity } from '../../masters/loading-point/entities/loading-point.entity';
import { LoadStatus } from '../../loads/utils/loads.types';
import { distanceMetresBetween } from '../../notifications/utils/trip-time';

export interface TripEta {
  /** Total route length, loading → unloading point; null when it can't be worked out. */
  distanceKm: number | null;
  remainingKm: number;
  etaAt: string | null;
  /** 'live' = from the truck's latest position to the unloading point; 'planned' = the whole
   *  loading → unloading route from now, used before the truck sets off for the drop. */
  source: 'live' | 'planned';
  /** No recent location fix — the numbers are the last known ones. */
  stale: boolean;
}

export interface TrackingEtaReader {
  /** The ETA for a trip (a load is a trip); null when there is nothing to show. */
  getTripEta(tripId: string): Promise<TripEta | null>;
}

/** Truck has left the loading point and is driving to the drop: measure from its position. */
const LIVE_STATUSES: readonly LoadStatus[] = ['in_transit_unloading'];
/** Marked at the drop — trusted only while the truck's position agrees (see AT_DROP_MIN_M). */
const REACHED_DROP_STATUS: LoadStatus = 'reached_unloading';
/** Past the drop: nothing left to drive. Every other status shows the planned route. */
const PAST_DROP_STATUSES: readonly LoadStatus[] = [
  'delivered_ok',
  'delivered_with_issues',
  'original_pod_received',
  'invoice_generated',
  'payment',
  'closed',
];
/** A fix older than this is not "live" any more. */
const STALE_AFTER_MS = 60 * 60_000;
/** Ask Google again only this often per trip, and only once the truck has moved this far. */
const LIVE_REFRESH_MS = 10 * 60_000;
const LIVE_REFRESH_MOVED_M = 1000;
/** The loading → unloading route doesn't change; keep it for a day. */
const PLANNED_TTL_MS = 24 * 60 * 60_000;
const MAX_CACHED_TRIPS = 2000;
/** "Reached unloading" with a fresh fix further than max(drop geofence, this) from the drop is
 *  not believed: the left distance is measured from the truck instead. */
const AT_DROP_MIN_M = 2000;
const DEFAULT_GEOFENCE_M = 300;

interface TripPoints {
  status: LoadStatus;
  vehicleId: string | null;
  origin: LatLng | null;
  destination: LatLng | null;
  /** The drop's geofence radius, metres. */
  destinationRadiusM: number;
}

interface PlaceCoordinates {
  latitude?: string | number | null;
  longitude?: string | number | null;
}

interface CachedRoute extends DrivingRoute {
  atMs: number;
  from: LatLng;
}

/**
 * Works out the driver home screen's left distance and ETA:
 *  - before the truck sets off for the drop: loading point → unloading point (the planned route in
 *    tracking.trip_routes, else Google), ETA = now + its driving time;
 *  - on the way to the drop: the truck's latest position (the tracking service's Redis,
 *    `trk:veh:{vehicleId}:latest` — TRACKING_REDIS_URL, else the shared REDIS_URL) → unloading
 *    point by Google, ETA = then + its driving time;
 *  - marked at the drop: nothing left — unless the truck's fresh position is well outside the
 *    drop (status set early), then measured from the truck as above;
 *  - past the drop: nothing left.
 * With no usable position on the way to the drop, the planned numbers are returned marked stale.
 * Google is asked at most every 10 min per trip (cached in memory). Fail-soft: the home screen
 * must load without an ETA; failures are logged.
 */
export class RedisTrackingEtaReader implements TrackingEtaReader {
  private client: Redis | null = null;
  private readonly plannedCache = new Map<string, { atMs: number; route: DrivingRoute | null }>();
  private readonly liveCache = new Map<string, CachedRoute>();

  constructor(
    private readonly dataSource: DataSource,
    private readonly url: string | undefined = env.trackingRedisUrl ?? env.redisUrl,
    private readonly routes: Pick<GoogleRoutesClient, 'drivingRoute'> = new GoogleRoutesClient(),
    private readonly now: () => number = Date.now,
  ) {}

  async getTripEta(tripId: string): Promise<TripEta | null> {
    const trip = await this.tripPoints(tripId);
    if (!trip) return null;
    const planned = await this.plannedRoute(tripId, trip);
    const distanceKm = planned ? km(planned.distanceM) : null;

    const atDrop = {
      distanceKm,
      remainingKm: 0,
      etaAt: null,
      source: 'planned',
      stale: false,
    } as const;
    if (PAST_DROP_STATUSES.includes(trip.status)) return atDrop;
    if (trip.status === REACHED_DROP_STATUS) {
      const position = await this.freshPosition(tripId, trip);
      const awayM =
        position && trip.destination ? distanceMetresBetween(position, trip.destination) : 0;
      if (awayM <= Math.max(trip.destinationRadiusM, AT_DROP_MIN_M)) return atDrop;
      return (await this.liveEta(tripId, trip, distanceKm)) ?? atDrop;
    }

    // On the way to the drop without a usable position, the planned numbers are only approximate.
    let stale = false;
    if (LIVE_STATUSES.includes(trip.status)) {
      const live = await this.liveEta(tripId, trip, distanceKm);
      if (live) return live;
      stale = true;
    }

    if (!planned) return null;
    return {
      distanceKm,
      remainingKm: km(planned.distanceM),
      etaAt:
        planned.durationS === null
          ? null
          : new Date(this.now() + planned.durationS * 1000).toISOString(),
      source: 'planned',
      stale,
    };
  }

  private async freshPosition(tripId: string, trip: TripPoints): Promise<LatLng | null> {
    if (!trip.vehicleId) return null;
    const position = await this.latestPosition(trip.vehicleId, tripId);
    return position && this.now() - position.atMs <= STALE_AFTER_MS ? position.at : null;
  }

  /** Latest position → unloading point; the last answer (marked stale) when the fix is old. */
  private async liveEta(
    tripId: string,
    trip: TripPoints,
    distanceKm: number | null,
  ): Promise<TripEta | null> {
    if (!trip.destination || !trip.vehicleId) return null;
    const position = await this.latestPosition(trip.vehicleId, tripId);
    const nowMs = this.now();
    const fresh = position !== null && nowMs - position.atMs <= STALE_AFTER_MS;
    let cached = this.liveCache.get(tripId) ?? null;

    if (fresh) {
      const due =
        !cached ||
        (nowMs - cached.atMs >= LIVE_REFRESH_MS &&
          distanceMetresBetween(cached.from, position.at) > LIVE_REFRESH_MOVED_M);
      if (due) {
        const route = await this.routes.drivingRoute(position.at, trip.destination);
        if (route) {
          cached = { ...route, atMs: nowMs, from: position.at };
          remember(this.liveCache, tripId, cached);
        }
      }
    }
    if (!cached) return null;
    return {
      distanceKm,
      remainingKm: km(cached.distanceM),
      etaAt:
        cached.durationS === null
          ? null
          : new Date(cached.atMs + cached.durationS * 1000).toISOString(),
      source: 'live',
      stale: !fresh,
    };
  }

  /** Loading → unloading point: the tracking service's planned route, else Google (cached). */
  private async plannedRoute(tripId: string, trip: TripPoints): Promise<DrivingRoute | null> {
    const stored = await this.storedRoute(tripId);
    if (stored) return stored;
    if (!trip.origin || !trip.destination) {
      console.warn(
        `[tracking-eta] trip ${tripId}: no ${trip.origin ? 'unloading' : 'loading'} point coordinates`,
      );
      return null;
    }

    const cached = this.plannedCache.get(tripId);
    if (cached && this.now() - cached.atMs < PLANNED_TTL_MS) return cached.route;
    const route = await this.routes.drivingRoute(trip.origin, trip.destination);
    remember(this.plannedCache, tripId, { atMs: this.now(), route });
    return route;
  }

  /** The newest route version in tracking.trip_routes (an approved alternate supersedes the plan). */
  private async storedRoute(tripId: string): Promise<DrivingRoute | null> {
    try {
      const route = await this.dataSource
        .createQueryBuilder()
        .select('route.distance_m', 'distanceM')
        .addSelect('route.duration_s', 'durationS')
        .from('tracking.trip_routes', 'route')
        .where('route.trip_id = :tripId', { tripId })
        .orderBy('route.version', 'DESC')
        .limit(1)
        .getRawOne<{ distanceM: number | string; durationS: number | string | null }>();
      const distanceM = Number(route?.distanceM);
      if (!route || !Number.isFinite(distanceM) || distanceM <= 0) return null;
      const durationS = route.durationS === null ? NaN : Number(route.durationS);
      return { distanceM, durationS: Number.isFinite(durationS) ? durationS : null };
    } catch (err) {
      console.warn(`[tracking-eta] trip ${tripId}: reading tracking.trip_routes failed`, err);
      return null;
    }
  }

  /** Status, vehicle and both ends' coordinates — the requisition's points, else the posting's
   *  address snapshot, else the master the posting was picked from. */
  private async tripPoints(tripId: string): Promise<TripPoints | null> {
    try {
      const load = await this.dataSource.getRepository(LoadEntity).findOne({
        where: { id: tripId },
        relations: {
          requisition: { loadingPoint: true, customerDeliveryPoint: true },
          posting: true,
        },
      });
      if (!load) return null;
      const posting = load.posting;
      const pickup: PlaceCoordinates | null =
        load.requisition?.loadingPoint ??
        (pointOfPlace(posting?.pickupAddress)
          ? posting!.pickupAddress
          : await this.master(LoadingPointEntity, posting?.pickupLoadingPointId));
      const dropMaster: (PlaceCoordinates & { geofenceRadiusM?: number }) | null =
        load.requisition?.customerDeliveryPoint ??
        (await this.master(CustomerDeliveryPointEntity, posting?.dropCustomerDeliveryPointId)) ??
        (await this.master(LoadingPointEntity, posting?.dropLoadingPointId));
      const drop = load.requisition
        ? dropMaster
        : pointOfPlace(posting?.dropAddress)
          ? posting!.dropAddress
          : dropMaster;
      return {
        status: load.status,
        vehicleId: load.vehicleId ?? null,
        origin: pointOfPlace(pickup),
        destination: pointOfPlace(drop),
        destinationRadiusM: dropMaster?.geofenceRadiusM ?? DEFAULT_GEOFENCE_M,
      };
    } catch (err) {
      console.warn(`[tracking-eta] trip ${tripId}: reading the load failed`, err);
      return null;
    }
  }

  /** A loading point / delivery point master row by id (both carry lat/lng and a geofence). */
  private async master(
    entity: typeof LoadingPointEntity | typeof CustomerDeliveryPointEntity,
    id: string | null | undefined,
  ): Promise<LoadingPointEntity | CustomerDeliveryPointEntity | null> {
    if (!id) return null;
    return entity === LoadingPointEntity
      ? this.dataSource.getRepository(LoadingPointEntity).findOneBy({ id })
      : this.dataSource.getRepository(CustomerDeliveryPointEntity).findOneBy({ id });
  }

  /** The truck's latest fix from the tracking service; ignored if it belongs to another trip. */
  private async latestPosition(
    vehicleId: string,
    tripId: string,
  ): Promise<{ at: LatLng; atMs: number } | null> {
    if (!this.url) return null;
    try {
      this.client ??= new Redis(this.url, { maxRetriesPerRequest: 1 });
      const latest = await this.client.hgetall(`trk:veh:${vehicleId}:latest`);
      if (latest.tripId && latest.tripId !== tripId) return null;
      const at = pointOf(latest.lat, latest.lng);
      const atMs = Date.parse(latest.recordedAt ?? '');
      return at && Number.isFinite(atMs) ? { at, atMs } : null;
    } catch (err) {
      console.warn(`[tracking-eta] vehicle ${vehicleId}: reading the latest position failed`, err);
      return null;
    }
  }
}

const km = (metres: number) => Math.round(metres / 100) / 10;

const pointOfPlace = (place: PlaceCoordinates | null | undefined) =>
  pointOf(place?.latitude, place?.longitude);

function pointOf(
  lat: string | number | null | undefined,
  lng: string | number | null | undefined,
): LatLng | null {
  if (lat == null || lng == null || lat === '' || lng === '') return null;
  const point = { lat: Number(lat), lng: Number(lng) };
  return Number.isFinite(point.lat) && Number.isFinite(point.lng) ? point : null;
}

/** Map with a size cap — the oldest entry goes first (insertion order). */
function remember<V>(cache: Map<string, V>, key: string, value: V): void {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_CACHED_TRIPS) cache.delete(cache.keys().next().value as string);
}
