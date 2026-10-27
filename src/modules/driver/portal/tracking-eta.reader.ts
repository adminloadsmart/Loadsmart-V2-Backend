import Redis from 'ioredis';
import { DataSource } from 'typeorm';
import { env } from '../../../config/env';

export interface TripEta {
  /** Total planned route length from tracking.trip_routes; null when no route is planned yet. */
  distanceKm: number | null;
  remainingKm: number;
  etaAt: string | null;
  /** 'live' = the tracking service's running ETA; 'planned' = the whole planned route's
   *  distance and driving time from now, used until a live ETA exists. */
  source: 'live' | 'planned';
  /** No recent location fix — the numbers are the last known ones. */
  stale: boolean;
}

export interface TrackingEtaReader {
  /** The tracking service's latest ETA for a trip (a load is a trip); null when it has none. */
  getTripEta(tripId: string): Promise<TripEta | null>;
}

/**
 * Reads the ETA the tracking service's DELAY rule keeps in its own Redis (`trk:trip:{id}:eta`, a
 * hash of strings). It only exists for trips being evaluated in transit; without it (or without
 * TRACKING_REDIS_URL) the planned route in tracking.trip_routes — same database — gives the full
 * route distance and driving time instead. Fail-soft: the home screen must load without an ETA.
 */
export class RedisTrackingEtaReader implements TrackingEtaReader {
  private client: Redis | null = null;

  constructor(
    private readonly dataSource: DataSource,
    private readonly url: string | undefined = env.trackingRedisUrl,
  ) {}

  async getTripEta(tripId: string): Promise<TripEta | null> {
    return (await this.liveEta(tripId)) ?? (await this.plannedEta(tripId));
  }

  private async liveEta(tripId: string): Promise<TripEta | null> {
    if (!this.url) return null;
    try {
      this.client ??= new Redis(this.url, { maxRetriesPerRequest: 1 });
      const eta = await this.client.hgetall(`trk:trip:${tripId}:eta`);
      const etaMs = Number(eta.etaAt);
      const remainingKm = Number(eta.remainingKm);
      if (!eta.etaAt || !Number.isFinite(etaMs) || !Number.isFinite(remainingKm)) return null;
      return {
        distanceKm: (await this.plannedRoute(tripId))?.distanceKm ?? null,
        remainingKm,
        etaAt: new Date(etaMs).toISOString(),
        source: 'live',
        stale: eta.stale === '1',
      };
    } catch {
      return null;
    }
  }

  /** The newest route version (an approved alternate supersedes the planned one). */
  private async plannedRoute(
    tripId: string,
  ): Promise<{ distanceKm: number; durationS: number | null } | null> {
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
      if (!route || !Number.isFinite(Number(route.distanceM))) return null;
      return {
        distanceKm: Math.round(Number(route.distanceM) / 100) / 10,
        durationS: route.durationS === null ? null : Number(route.durationS),
      };
    } catch {
      return null;
    }
  }

  private async plannedEta(tripId: string): Promise<TripEta | null> {
    const route = await this.plannedRoute(tripId);
    if (!route) return null;
    if (route.durationS === null || !Number.isFinite(route.durationS)) {
      return {
        distanceKm: route.distanceKm,
        remainingKm: route.distanceKm,
        etaAt: null,
        source: 'planned',
        stale: false,
      };
    }
    return {
      distanceKm: route.distanceKm,
      remainingKm: route.distanceKm,
      etaAt: new Date(Date.now() + route.durationS * 1000).toISOString(),
      source: 'planned',
      stale: false,
    };
  }
}
