import { In, Repository } from 'typeorm';
import { GooglePlacesClient } from '../../adapters/google-places.client';
import { pick } from '../places/places.service';
import { GeoPlaceEntity } from './geo-place.entity';
import { GeoPoint, canonicalCity, canonicalState } from './india-regions';

/** Most new cities looked up on Google in one match — the rest are found on a later load. */
export const MAX_LOOKUPS_PER_CALL = 20;

export interface CityQuery {
  city: string;
  state?: string | null;
}

export function cityKey({ city, state }: CityQuery): string {
  return `${canonicalCity(city)}|${(canonicalState(state) ?? '').toLowerCase()}`;
}

/**
 * Where a lane city is, for the "on the way" corridor. Kept in loads.geo_places once looked up;
 * Google's Geocoding API is asked only for cities not seen before. When Google isn't configured
 * or fails, the city simply has no point (its lane then matches by name only) — never throws.
 */
export class GeoPlaceResolver {
  constructor(
    private readonly places: Repository<GeoPlaceEntity>,
    private readonly google: Pick<GooglePlacesClient, 'geocode'> | null,
  ) {}

  async pointsOf(queries: readonly CityQuery[]): Promise<Map<string, GeoPoint | null>> {
    const wanted = new Map<string, CityQuery>();
    for (const query of queries) {
      if (query.city.trim()) wanted.set(cityKey(query), query);
    }
    const points = new Map<string, GeoPoint | null>();
    if (!wanted.size) return points;
    try {
      const rows = await this.places.find({ where: { queryKey: In([...wanted.keys()]) } });
      for (const row of rows) points.set(row.queryKey, pointOf(row));
      const missing = [...wanted].filter(([key]) => !points.has(key));
      for (const [key, query] of missing.slice(0, MAX_LOOKUPS_PER_CALL)) {
        points.set(key, await this.lookUp(key, query));
      }
    } catch (error) {
      console.warn('[lane-matching] city points unavailable', error);
    }
    return points;
  }

  private async lookUp(key: string, query: CityQuery): Promise<GeoPoint | null> {
    if (!this.google) return null;
    let result: Awaited<ReturnType<GooglePlacesClient['geocode']>>;
    try {
      result = await this.google.geocode({
        address: [query.city, query.state].filter(Boolean).join(', '),
      });
    } catch {
      // Not configured, quota, network: try again on a later load, keep nothing.
      return null;
    }
    const location = result?.geometry?.location ?? null;
    const components = result?.address_components ?? [];
    await this.places
      .createQueryBuilder()
      .insert()
      .values({
        queryKey: key,
        city: pick(components, ['locality', 'administrative_area_level_3']) ?? query.city,
        state: pick(components, ['administrative_area_level_1']) ?? query.state ?? null,
        latitude: location ? String(location.lat) : null,
        longitude: location ? String(location.lng) : null,
      })
      .orIgnore()
      .execute();
    return location ? { lat: location.lat, lng: location.lng } : null;
  }
}

function pointOf(row: GeoPlaceEntity): GeoPoint | null {
  return row.latitude === null || row.longitude === null
    ? null
    : { lat: Number(row.latitude), lng: Number(row.longitude) };
}
