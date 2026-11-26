import { GooglePlacesClient, GooglePlacesError } from '../../adapters/google-places.client';

export type AddressPinLookup = Pick<GooglePlacesClient, 'geocode'>;

export interface TypedAddress {
  title?: string | null;
  addressLine1?: string | null;
  areaLocality?: string | null;
  city?: string | null;
  state?: string | null;
  pinCode?: string | null;
}

/** The geocode query for these address parts, repeats dropped; null with nothing to look up. */
function query(parts: Array<string | null | undefined>): string | null {
  const kept = parts.map((part) => part?.trim()).filter(Boolean);
  return kept.length ? [...new Set(kept)].join(', ') : null;
}

/**
 * The map pin for a place typed in by hand (no Google Places pick), so a master loading /
 * delivery point still gets its geofence. Its location source stays `manual` (unverified).
 *
 * The full address is tried first. When Google can't match it (a typed street often isn't on the
 * map), the PIN code area (with city and state) is tried, so the point is still fenced near it.
 *
 * Returns null when Google has no match or isn't configured. Any other Google failure is logged
 * and also returns null: a lookup outage must not block saving the master record — the point is
 * saved without a pin, as before, and gets one on its next save.
 */
export async function pinForAddress(
  google: AddressPinLookup | undefined,
  address: TypedAddress,
): Promise<{ latitude: number; longitude: number } | null> {
  if (!google) return null;
  const full = query([
    address.addressLine1 || address.title,
    address.areaLocality,
    address.city,
    address.state,
    address.pinCode,
  ]);
  if (!full) return null;
  const pinArea = address.pinCode?.trim()
    ? query([address.city, address.state, address.pinCode])
    : null;
  try {
    for (const lookup of pinArea && pinArea !== full ? [full, pinArea] : [full]) {
      const place = await google.geocode({ address: lookup });
      const location = place?.geometry?.location;
      if (location) return { latitude: location.lat, longitude: location.lng };
    }
    return null;
  } catch (error) {
    if (!(error instanceof GooglePlacesError && error.status === 'NOT_CONFIGURED'))
      console.warn('[places] could not pin a typed address', error);
    return null;
  }
}
