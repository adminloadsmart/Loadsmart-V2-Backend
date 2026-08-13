import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { FILES_DELETE, FILES_READ, FILES_UPLOAD } from '../../shared/constants/permissions';
import {
  SuccessResponseSchema,
  TAGS,
  errorContent,
  json,
  permissionGated,
} from '../../shared/openapi/core';
import { storageValidators } from './storage.validators';

const BASE = `${API_VERSION_PREFIX}/files`;

export function registerStorageOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: BASE,
    tags: [TAGS.STORAGE],
    operationId: 'storage.generateUploadUrl',
    ...permissionGated(
      [FILES_UPLOAD],
      'Create a pending file record and return a presigned S3 POST for the browser to upload directly to. Platform-scope callers (sales, online/offline_kyc_desk, load_console) may call this with no tenant of their own.',
    ),
    request: { body: json(storageValidators.generateUploadUrl.shape.body) },
    responses: {
      201: { description: 'Pending file record plus presigned upload URL/fields' },
      400: { description: 'Validation failed', ...errorContent },
      403: { description: 'Forbidden', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'post',
    path: `${BASE}/{fileId}/confirm`,
    tags: [TAGS.STORAGE],
    operationId: 'storage.confirmUpload',
    ...permissionGated(
      [FILES_UPLOAD],
      "Confirm a presigned upload actually landed in S3 and flip the file's status to confirmed. Platform-scope callers (sales, online/offline_kyc_desk, load_console) may call this with no tenant of their own.",
    ),
    request: { params: storageValidators.confirmUpload.shape.params },
    responses: {
      200: { description: 'Confirmed file record' },
      404: { description: 'File not found', ...errorContent },
      409: { description: 'Upload was never completed in S3', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/{fileId}`,
    tags: [TAGS.STORAGE],
    operationId: 'storage.get',
    ...permissionGated(
      [FILES_READ],
      'Get file metadata plus a ready-to-use download URL (present once confirmed). Platform-scope callers (platform_admin, sales, online/offline_kyc_desk, load_console) may fetch any tenant’s file; other callers are limited to their own tenant.',
    ),
    request: { params: storageValidators.get.shape.params },
    responses: {
      200: { description: 'File metadata and downloadUrl' },
      404: { description: 'File not found', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/by-key`,
    tags: [TAGS.STORAGE],
    operationId: 'storage.getByKey',
    ...permissionGated(
      [FILES_READ],
      'Same as GET /files/{fileId}, but resolved by the S3 object key instead of the file id — for a caller that only has a stored key reference (e.g. organization_documents.file_key), not the file’s id.',
    ),
    request: { query: storageValidators.getByKey.shape.query },
    responses: {
      200: { description: 'File metadata and downloadUrl' },
      404: { description: 'File not found', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'delete',
    path: `${BASE}/{fileId}`,
    tags: [TAGS.STORAGE],
    operationId: 'storage.remove',
    ...permissionGated(
      [FILES_DELETE],
      'Delete a tenant-scoped file from S3 and soft-delete its record.',
    ),
    request: { params: storageValidators.remove.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'File not found', ...errorContent },
    },
  });
}
