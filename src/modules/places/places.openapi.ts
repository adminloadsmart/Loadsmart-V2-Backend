import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { TAGS, errorContent } from '../../shared/openapi/core';
import { placesValidators } from './places.validators';

const BASE = `${API_VERSION_PREFIX}/places`;

export function registerPlacesOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/search`,
    tags: [TAGS.PLACES],
    operationId: 'places.search',
    security: [{ bearerAuth: [] }],
    description:
      'Search any place by text (Google Places Autocomplete). Returns suggestions, each with a placeId to pass to GET /places/{placeId}. Pass the same sessionToken (a UUID) on the search calls and the final details call so Google bills them as one session. Any authenticated user; rate limited.',
    request: { query: placesValidators.search.shape.query },
    responses: {
      200: {
        description:
          'List of { placeId, description, mainText, secondaryText } (empty if no match)',
      },
      400: { description: 'Validation failed', ...errorContent },
      429: { description: 'Rate limit exceeded', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/{placeId}`,
    tags: [TAGS.PLACES],
    operationId: 'places.details',
    security: [{ bearerAuth: [] }],
    description:
      'Get the full details of a place by its Google placeId: name, formattedAddress, lat/lng, city, state, pinCode and country. Any authenticated user; rate limited.',
    request: {
      params: placesValidators.details.shape.params,
      query: placesValidators.details.shape.query,
    },
    responses: {
      200: { description: 'Place details' },
      404: { description: 'Place not found', ...errorContent },
      429: { description: 'Rate limit exceeded', ...errorContent },
    },
  });
}
