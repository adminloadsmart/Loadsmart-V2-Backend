import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { dashboardsValidators } from './dashboards.validators';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { CUSTOMERS_APPROVE, MASTERS_APPROVE } from '../../shared/constants/permissions';
import { TAGS, authenticated, permissionGated, errorContent } from '../../shared/openapi/core';

/**
 * OpenAPI docs for the dashboards module: registers every route in dashboards.routes.ts, in the
 * same order, under the `dashboards` tag. See masters.openapi.ts for the pattern this follows.
 */

const BASE = `${API_VERSION_PREFIX}/dashboards`; // absolute path — must match its mount in app.ts

export function registerDashboardsOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/fleet-activity`,
    tags: [TAGS.DASHBOARDS],
    operationId: 'dashboards.getFleetActivity',
    ...authenticated(
      'Fleet activity summary for the tenant over a date range (defaults to the last 15 days). ' +
        'activeTrips and operationalBreakdown are live counts (not scoped to the date range) — ' +
        'activeTrips is the number of loads currently in a non-completed status with a vehicle ' +
        'assigned. kmCovered, maintenanceCost, and fleetPnl are always null today — tracking, ' +
        'maintenance, and payments have no dated distance/cost/earning records yet to aggregate.',
    ),
    request: { query: dashboardsValidators.getFleetActivity.shape.query },
    responses: {
      200: { description: 'Fleet activity summary' },
      400: { description: 'Validation failed', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads-summary`,
    tags: [TAGS.DASHBOARDS],
    operationId: 'dashboards.getLoadsSummary',
    ...authenticated(
      'Home screen summary for the tenant: trip counts (all/active/completed) plus three ' +
        'zero-filled per-day series (loads, tonnes shipped, freight spend) over a date range, ' +
        'plus a live fleetActivity snapshot (fleetSize, trucksRunningNow, operationalBreakdown, ' +
        'and the always-null kmCovered/maintenanceCost/fleetPnl placeholders — same shape as ' +
        'GET /fleet-activity, minus its own range, since fleet counts are a live snapshot and not ' +
        'actually scoped by date). `filter` defaults to "last15days" when omitted; "custom" ' +
        'requires both from and to. All scoping and day-bucketing use load.created_at and IST ' +
        '(Asia/Kolkata) calendar-day boundaries, and include every load in range regardless of ' +
        'status.',
    ),
    request: { query: dashboardsValidators.getLoadsSummary.shape.query },
    responses: {
      200: { description: 'Loads summary — trip counts + per-day series' },
      400: { description: 'Validation failed', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/pending-approvals`,
    tags: [TAGS.DASHBOARDS],
    operationId: 'dashboards.listPendingApprovals',
    ...permissionGated(
      [CUSTOMERS_APPROVE, MASTERS_APPROVE],
      'Settings → Approvals: every pending customer, vehicle, and driver for the tenant in one ' +
        'list, newest first. Read-only — approve/reject each item on its own endpoint ' +
        '(PATCH /customers/{id}/approve|reject, PATCH /masters/vehicles|drivers/{id}/approve|reject).',
    ),
    responses: {
      200: { description: 'Pending approvals — { data: { items, total } }' },
    },
  });
}
