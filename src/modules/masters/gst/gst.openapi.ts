import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import { TAGS, authenticated, errorContent, json } from '../../../shared/openapi/core';
import { gstValidators } from './gst.validators';

const BASE = `${API_VERSION_PREFIX}/masters`;

export function registerGstOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: `${BASE}/gst/verify`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.verifyGst',
    ...authenticated(
      'Look a GSTIN up on the GST register (IDfy `ind_gst_certificate`). Returns the legal/trade ' +
        'name, constitution, PAN, place of supply and registered address, plus `nameMatched` when ' +
        '`legalName` is sent. `status` is verified | not_found | inactive | unavailable — ' +
        '`unavailable` (vendor down/unconfigured/timed out) is still a 200 so the form can fall ' +
        'back to manual entry. Pass the returned `verificationId` as `gstVerificationId` when ' +
        'saving a customer or transporter (valid 24 h) to store it as GST-verified.',
    ),
    request: { body: json(gstValidators.verify.shape.body) },
    responses: {
      200: { description: 'Lookup result' },
      400: { description: 'Invalid GSTIN', ...errorContent },
      429: { description: 'Too many lookups', ...errorContent },
    },
  });
}
