import { env } from '../config/env';

/** Only the fields this integration reads — Google returns others we don't use. */
export interface GoogleAutocompletePrediction {
  place_id: string;
  description: string;
  structured_formatting?: { main_text?: string; secondary_text?: string };
}

export interface GoogleAddressComponent {
  long_name: string;
  short_name: string;
  types: string[];
}

export interface GooglePlaceDetailsResult {
  place_id: string;
  name?: string;
  formatted_address?: string;
  geometry?: { location: { lat: number; lng: number } };
  address_components?: GoogleAddressComponent[];
}

/** Google's legacy Places API always answers HTTP 200 with a `status` field carrying the outcome. */
export type GooglePlacesStatus =
  | 'OK'
  | 'ZERO_RESULTS'
  | 'NOT_FOUND'
  | 'INVALID_REQUEST'
  | 'OVER_QUERY_LIMIT'
  | 'REQUEST_DENIED'
  | 'UNKNOWN_ERROR';

interface GooglePlacesResponse {
  status: GooglePlacesStatus;
  error_message?: string;
}

interface AutocompleteResponse extends GooglePlacesResponse {
  predictions?: GoogleAutocompletePrediction[];
}

interface DetailsResponse extends GooglePlacesResponse {
  result?: GooglePlaceDetailsResult;
}

const DETAILS_FIELDS = 'place_id,name,formatted_address,geometry/location,address_components';

/** Thrown for any non-OK/non-empty Google outcome — the service maps `status` to an AppError. */
export class GooglePlacesError extends Error {
  constructor(
    public readonly status: GooglePlacesStatus | 'NETWORK_ERROR' | 'NOT_CONFIGURED',
    message: string,
  ) {
    super(message);
    this.name = 'GooglePlacesError';
  }
}

/**
 * Wraps Google's Places Autocomplete and Place Details (legacy `maps.googleapis.com`) endpoints.
 * The API key stays server-side — the browser/app only ever talks to our own /places routes.
 * `sessionToken` ties an autocomplete session to its closing details call so Google bills them
 * as one session instead of per keystroke.
 */
export class GooglePlacesClient {
  async autocomplete(params: {
    query: string;
    sessionToken?: string;
    country?: string;
  }): Promise<GoogleAutocompletePrediction[]> {
    const search = new URLSearchParams({ input: params.query });
    if (params.sessionToken) search.set('sessiontoken', params.sessionToken);
    if (params.country) search.set('components', `country:${params.country}`);

    const body = await this.get<AutocompleteResponse>('/maps/api/place/autocomplete/json', search);
    return body.predictions ?? [];
  }

  async details(params: {
    placeId: string;
    sessionToken?: string;
  }): Promise<GooglePlaceDetailsResult> {
    const search = new URLSearchParams({ place_id: params.placeId, fields: DETAILS_FIELDS });
    if (params.sessionToken) search.set('sessiontoken', params.sessionToken);

    const body = await this.get<DetailsResponse>('/maps/api/place/details/json', search);
    if (!body.result) throw new GooglePlacesError('NOT_FOUND', 'Place not found');
    return body.result;
  }

  private async get<T extends GooglePlacesResponse>(
    path: string,
    search: URLSearchParams,
  ): Promise<T> {
    if (!env.googleMapsApiKey) {
      throw new GooglePlacesError('NOT_CONFIGURED', 'GOOGLE_MAPS_API_KEY not configured');
    }
    search.set('key', env.googleMapsApiKey);

    let body: T | null;
    try {
      const response = await fetch(`${env.googleMapsBaseUrl}${path}?${search.toString()}`);
      body = (await response.json().catch(() => null)) as T | null;
    } catch (err) {
      throw new GooglePlacesError('NETWORK_ERROR', `Google Places request failed: ${String(err)}`);
    }

    // ZERO_RESULTS is a valid empty answer for autocomplete; details treats it as NOT_FOUND below.
    if (body?.status === 'OK' || body?.status === 'ZERO_RESULTS') return body;
    throw new GooglePlacesError(
      body?.status ?? 'UNKNOWN_ERROR',
      `Google Places ${path} failed: ${body?.error_message ?? body?.status ?? 'no response'}`,
    );
  }
}
