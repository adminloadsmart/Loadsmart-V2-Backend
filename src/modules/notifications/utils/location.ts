import type { LatLng } from '../../geofences/utils/geofence.interface';
import {
  GOOGLE_MAPS_PIN_URL,
  LOCATION_CACHE_KEY_DECIMALS,
  LOCATION_CACHE_KEY_PREFIX,
  LOCATION_CACHE_TTL_SECONDS,
} from '../notifications.constants';
import type { DescribeLocation, LocationDescriberDeps } from '../notifications.interface';

// Google's full addresses end in ", Rajasthan 301701, India" — the PIN and country add length,
// not meaning, to a notification line.
const TRAILING_COUNTRY = /,\s*India\s*$/i;
const TRAILING_PIN_CODE = /\s+\d{6}\s*$/;

/** "NH 48, Behror, Rajasthan 301701, India" → "NH 48, Behror, Rajasthan". */
export function shortenAddress(address: string): string {
  return address.trim().replace(TRAILING_COUNTRY, '').replace(TRAILING_PIN_CODE, '').trim();
}

/** A tappable Google Maps pin — the fallback when no address is known for a point. */
export function mapLinkOf(point: LatLng): string {
  return `${GOOGLE_MAPS_PIN_URL}${point.lat.toFixed(5)},${point.lng.toFixed(5)}`;
}

const cacheKeyOf = (point: LatLng) =>
  `${LOCATION_CACHE_KEY_PREFIX}:${point.lat.toFixed(LOCATION_CACHE_KEY_DECIMALS)}:${point.lng.toFixed(LOCATION_CACHE_KEY_DECIMALS)}`;

/** Where a vehicle is, in words: tracking's address when it sent one, else our own lookup
 *  (found addresses cached per ~110 m cell), else a map link. A cache or lookup failure only
 *  drops to the next step — it never fails the notification. */
export function createLocationDescriber({
  addressAt,
  cache,
}: LocationDescriberDeps): DescribeLocation {
  return async (point, knownAddress) => {
    const known = knownAddress?.trim();
    if (known) return shortenAddress(known);

    const key = cacheKeyOf(point);
    try {
      const cached = await cache.get(key);
      if (cached) return cached;
    } catch (error) {
      console.warn(`Location cache read failed for ${key}`, error);
    }

    // addressAt is null both when Google has nothing and when the lookup failed, so a miss isn't
    // cached — the next notification for this spot simply tries again.
    const address = await addressAt(point);
    if (!address) return mapLinkOf(point);
    const shortened = shortenAddress(address);
    try {
      await cache.set(key, shortened, LOCATION_CACHE_TTL_SECONDS);
    } catch (error) {
      console.warn(`Location cache write failed for ${key}`, error);
    }
    return shortened;
  };
}
