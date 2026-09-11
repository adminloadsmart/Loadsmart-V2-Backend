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
}
