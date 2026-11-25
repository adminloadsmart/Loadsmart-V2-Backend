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

/**
 * The map pin for a place typed in by hand (no Google Places pick), so a master loading /
 * delivery point still gets its geofence. Its location source stays `manual` (unverified).
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
  const parts = [
    address.addressLine1 || address.title,
    address.areaLocality,
    address.city,
    address.state,
    address.pinCode,
  ]
    .map((part) => part?.trim())
    .filter(Boolean);
  if (!parts.length) return null;
  try {
    const place = await google.geocode({ address: [...new Set(parts)].join(', ') });
    const location = place?.geometry?.location;
    return location ? { latitude: location.lat, longitude: location.lng } : null;
  } catch (error) {
    if (!(error instanceof GooglePlacesError && error.status === 'NOT_CONFIGURED'))
      console.warn('[places] could not pin a typed address', error);
    return null;
  }
}
