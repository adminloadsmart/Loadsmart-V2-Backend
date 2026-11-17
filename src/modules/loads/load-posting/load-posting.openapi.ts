import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { LOADS_POST } from '../../../shared/constants/permissions';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import { TAGS, permissionGated, errorContent, json } from '../../../shared/openapi/core';
import { loadPostingValidators as v } from './load-posting.validators';

/** OpenAPI docs for editing a posted load (load-posting.routes.ts). The rest of the posting
 *  routes are not documented yet. */

const BASE = `${API_VERSION_PREFIX}/loads/post`;

export function registerLoadPostingOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'put',
    path: `${BASE}/{postingId}`,
    tags: [TAGS.LOADS],
    operationId: 'loads.editPosting',
    ...permissionGated(
      [LOADS_POST],
      'Edit everything on a posted load — the same body as posting it — until it receives bids ' +
        '(bids were given against the original source, destination and price). The load type ' +
        'and the number of trucks stay; an indent keeps its contract; an own-fleet load keeps ' +
        'its truck and driver and can be edited until the trip starts. Every truck of the ' +
        'posting changes together.',
    ),
    request: { params: v.editPosting.shape.params, body: json(v.editPosting.shape.body) },
    responses: {
      200: { description: 'The posting, its loads and recipients' },
      400: {
        description: 'A changed load type, truck count, contract, truck or driver',
        ...errorContent,
      },
      409: {
        description: 'Bids are in, a truck is awarded, or the trip has started',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/{postingId}/details`,
    tags: [TAGS.LOADS],
    operationId: 'loads.editPostingDetails',
    ...permissionGated(
      [LOADS_POST],
      'After bids, change only the truck reporting time (until a truck reaches the loading ' +
        'point) and the pickup / drop area — address line, locality, PIN, map pin — never the ' +
        'city or state (pickup until Loaded, drop until delivered). Applies to every live truck ' +
        'of the posting. Contacts have their own endpoints (loading contact, unloading details).',
    ),
    request: { params: v.editDetails.shape.params, body: json(v.editDetails.shape.body) },
    responses: {
      200: { description: 'The posting, its loads and recipients' },
      409: { description: 'A truck is already past that point', ...errorContent },
    },
  });
}
