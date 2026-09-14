import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { driverPortalValidators } from './driver-portal.validators';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { TAGS, authenticated, errorContent, json } from '../../shared/openapi/core';

const BASE = `${API_VERSION_PREFIX}/driver-portal`; // absolute path — must match its mount in app.ts

// Driver-app self-service only — every path is implicitly scoped to the caller's own driver
// record (no :driverId anywhere), authenticated with a driver-access token, never the staff/org
// bearer token TAGS.AUTH documents. See docs/driver-auth.md.
export function registerDriverPortalOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/me`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.getMe',
    ...authenticated('Get the caller’s own driver profile.'),
    responses: { 200: { description: 'Driver profile' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/me/status`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.getMyStatus',
    ...authenticated('Get the caller’s own live operational status.'),
    responses: {
      200: { description: 'Operational status' },
      404: { description: 'No operational status yet', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/me/status`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.updateMyStatus',
    ...authenticated(
      'Set the caller’s own operational status — the same DriverService code path staff use, invoked by the driver on themselves.',
    ),
    request: { body: json(driverPortalValidators.updateMyStatus.shape.body) },
    responses: { 200: { description: 'Updated operational status' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/me/trip-metrics`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.getMyTripMetrics',
    ...authenticated(
      'List the caller’s own trip metrics by reporting period. Read-only — these are ops-computed KPIs, not driver-editable.',
    ),
    responses: { 200: { description: 'Trip metrics by period' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/me/loads`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.getMyLoads',
    ...authenticated('List loads assigned to the caller, paginated.'),
    request: { query: driverPortalValidators.listMyLoads.shape.query },
    responses: {
      200: {
        description:
          'Paginated loads — { data: { items, page, limit, total, totalPages, counts } }',
      },
    },
  });

  // --- Self-service load actions — :loadId is client-supplied here, unlike every path above;
  // ownership (the load must actually be assigned to the caller) is enforced in LoadService, not
  // documented as a distinct auth tier since it's a 404, not a 401/403. Same
  // LoadService.updateStatus/uploadPod the staff-facing loads.openapi.ts documents under
  // PATCH /loads/{loadId}/status and /pod. ---

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/status`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.updateMyLoadStatus',
    ...authenticated(
      'Manual tracking advance — At plant / In-transit / Reached delivery point — for a load ' +
        'assigned to the caller. Same rules as the staff PATCH /loads/{loadId}/status: one hop ' +
        'at a time, rejects skipping ahead or moving backward.',
    ),
    request: {
      params: driverPortalValidators.updateMyLoadStatus.shape.params,
      body: json(driverPortalValidators.updateMyLoadStatus.shape.body),
    },
    responses: {
      200: { description: 'Updated load' },
      404: { description: 'Load not found, or not assigned to the caller', ...errorContent },
      409: { description: "toStatus is not the load's next valid status", ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/pod`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.uploadMyPod',
    ...authenticated(
      'Record proof of delivery for a load assigned to the caller — same fields and rules as ' +
        'the staff PATCH /loads/{loadId}/pod: delivery receipt photo, receiver name/mobile/' +
        'designation, quantity received and seal-on-arrival check are all required together ' +
        '(only podRemarks is optional). podFileKey must be a confirmed upload from ' +
        'POST /driver-portal/files with purpose trips/pod. Marks the load Delivered; own-fleet ' +
        'loads (the only kind reachable here) close immediately.',
    ),
    request: {
      params: driverPortalValidators.uploadMyPod.shape.params,
      body: json(driverPortalValidators.uploadMyPod.shape.body),
    },
    responses: {
      200: { description: 'Updated load' },
      400: { description: 'A required delivery-receipt field is missing', ...errorContent },
      404: { description: 'Load not found, or not assigned to the caller', ...errorContent },
      409: { description: 'Loading has not been confirmed yet', ...errorContent },
    },
  });

  // --- POD upload's two-step storage handshake — a driver-portal-scoped mirror of
  // POST /files / POST /files/{fileId}/confirm (storage.openapi.ts), unreachable by a driver
  // token since those sit behind the staff-only authMiddleware/requirePermission. Locked to the
  // trips/pod purpose only. ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/files`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.requestPodUploadUrl',
    ...authenticated(
      'Create a pending file record and return a presigned S3 POST for the driver app to upload ' +
        'a POD photo directly to. purpose must be the literal "trips/pod" — this route accepts ' +
        'no other storage purpose.',
    ),
    request: { body: json(driverPortalValidators.requestPodUploadUrl.shape.body) },
    responses: {
      201: { description: 'Pending file record plus presigned upload URL/fields' },
      400: { description: 'Validation failed', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/files/{fileId}/confirm`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.confirmPodUpload',
    ...authenticated(
      "Confirm a presigned upload actually landed in S3 and flip the file's status to " +
        'confirmed. The resulting key is what gets passed as podFileKey to ' +
        'PATCH /driver-portal/loads/{loadId}/pod.',
    ),
    request: { params: driverPortalValidators.confirmPodUpload.shape.params },
    responses: {
      200: { description: 'Confirmed file record' },
      404: { description: 'File not found', ...errorContent },
      409: { description: 'Upload was never completed in S3', ...errorContent },
    },
  });
}
