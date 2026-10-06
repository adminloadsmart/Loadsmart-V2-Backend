import {
  GoogleAddressComponent,
  GooglePlaceDetailsResult,
  GooglePlacesClient,
  GooglePlacesError,
} from '../../adapters/google-places.client';
import { InternalError, NotFoundError, ValidationError } from '../../shared/errors';
import { PlaceDetails, PlaceSuggestion, SearchPlacesQuery } from './places.types';

/** First address component carrying any of `types`, in priority order — Google omits levels
 *  that don't exist for a place, and India's city can sit under locality or admin_area_2. */
function pick(components: GoogleAddressComponent[], types: string[]): string | null {
  for (const type of types) {
    const found = components.find((c) => c.types.includes(type));
    if (found) return found.long_name;
  }
  return null;
}

export function toPlaceDetails(result: GooglePlaceDetailsResult): PlaceDetails {
  const components = result.address_components ?? [];
  return {
    placeId: result.place_id,
    name: result.name ?? null,
    formattedAddress: result.formatted_address ?? null,
    lat: result.geometry?.location.lat ?? null,
    lng: result.geometry?.location.lng ?? null,
    city: pick(components, [
      'locality',
      'administrative_area_level_3',
      'administrative_area_level_2',
    ]),
    state: pick(components, ['administrative_area_level_1']),
    pinCode: pick(components, ['postal_code']),
    country: pick(components, ['country']),
  };
}

export class PlacesService {
  constructor(private readonly client: GooglePlacesClient) {}

  async search(query: SearchPlacesQuery): Promise<PlaceSuggestion[]> {
    try {
      const predictions = await this.client.autocomplete({
        query: query.q,
        sessionToken: query.sessionToken,
        country: query.country,
      });
      return predictions.map((p) => ({
        placeId: p.place_id,
        description: p.description,
        mainText: p.structured_formatting?.main_text ?? p.description,
        secondaryText: p.structured_formatting?.secondary_text ?? '',
      }));
    } catch (err) {
      throw this.mapError(err);
    }
  }

  async getDetails(placeId: string, sessionToken?: string): Promise<PlaceDetails> {
    try {
      return toPlaceDetails(await this.client.details({ placeId, sessionToken }));
    } catch (err) {
      throw this.mapError(err);
    }
  }

  // Google's own error_message (key restrictions, quota wording) is for our logs, not the client.
  private mapError(err: unknown): Error {
    if (!(err instanceof GooglePlacesError)) return err as Error;
    switch (err.status) {
      case 'ZERO_RESULTS':
      case 'NOT_FOUND':
        return new NotFoundError('Place not found');
      case 'INVALID_REQUEST':
        return new ValidationError('Invalid place lookup request');
      default:
        console.error(err.message);
        return new InternalError('Place lookup is currently unavailable');
    }
  }
}
