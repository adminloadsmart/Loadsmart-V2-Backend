import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { LOADS_DOCUMENTS_MANAGE } from '../../../shared/constants/permissions';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import {
  TAGS,
  authenticated,
  errorContent,
  json,
  permissionGated,
} from '../../../shared/openapi/core';
import { loadDocumentValidators as v } from './load-document.validators';

const BASE = `${API_VERSION_PREFIX}/loads`;

export function registerLoadDocumentOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads/{loadId}/documents`,
    tags: [TAGS.LOADS],
    operationId: 'loads.listDocuments',
    ...authenticated(
      "The load's documents register — each type's current file (`history=true`: every version, " +
        'latest first) with docType, version, download URL, source (web, driver_app, console, ' +
        'whatsapp, system), who uploaded it, reviewStatus (not_required, pending, approved, ' +
        'rejected + reason) and what was typed with it (`extracted.number`). A re-upload is the ' +
        'next version; the earlier one stays, superseded.',
    ),
    request: { params: v.list.shape.params, query: v.list.shape.query },
    responses: { 200: { description: 'LoadDocumentView[]' } },
  });
  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/documents/{documentId}/review`,
    tags: [TAGS.LOADS],
    operationId: 'loads.reviewDocument',
    ...permissionGated(
      [LOADS_DOCUMENTS_MANAGE],
      'Approve or reject (with a reason) one current document on your own load. POD documents ' +
        'are decided with the POD (PATCH /loads/{loadId}/pod/review); a Loadsmart load’s ' +
        'documents are reviewed by Loadsmart. A rejected document waits for a re-upload.',
    ),
    request: { params: v.review.shape.params, body: json(v.review.shape.body) },
    responses: {
      200: { description: 'The reviewed document' },
      409: {
        description: 'Superseded, a POD document, a Loadsmart load, or already rejected',
        ...errorContent,
      },
    },
  });
}
