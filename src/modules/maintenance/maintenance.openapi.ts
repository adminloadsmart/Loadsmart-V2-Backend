import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { MAINTENANCE_COSTS_VIEW, MAINTENANCE_MANAGE } from '../../shared/constants/permissions';
import {
  TAGS,
  authenticated,
  errorContent,
  json,
  permissionGated,
} from '../../shared/openapi/core';
import { maintenanceValidators as v } from './maintenance.validators';

/**
 * OpenAPI docs for the maintenance module (FMS-MNT-000): registers every route in
 * maintenance.routes.ts, in the same order, under the `maintenance` tag. See masters.openapi.ts
 * for the pattern this follows.
 */

const BASE = `${API_VERSION_PREFIX}/maintenance`; // absolute path — must match its mount in app.ts

const COSTS_NOTE = `Money fields are included only for a seat holding ${MAINTENANCE_COSTS_VIEW} (absent, not null, otherwise).`;
const OWN_FLEET_NOTE =
  'Own fleet only — attached vehicles (and market trucks, which are never in the vehicle master) never appear.';

const validationFailed = { description: 'Validation failed', ...errorContent };
const notFound = { description: 'Not found', ...errorContent };
const conflict = { description: 'Conflict', ...errorContent };

export function registerMaintenanceOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/overview`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.getOverview',
    ...authenticated(
      'The four headline numbers and the dispatch consequence line. maintenanceSpend and ' +
        'daysOffRoad follow the period (filter defaults to last30days) and are money — present ' +
        `only for ${MAINTENANCE_COSTS_VIEW}. trucksOverServicePolicy and positionsAtLegalLimit ` +
        'are the fleet right now, ignore the period, and go to every seat; they are counted from ' +
        'the same builders as GET /service-due and GET /tyres. fleetAvailability splits the ' +
        'running fleet into ready / inWorkshop / blockedOnPapers (exclusive, in that priority). ' +
        'consequence = trucks in the ' +
        'workshop now (split brokenDown / inForService) and open market loads bought to cover ' +
        'them (loads.covers_vehicle_id). ' +
        OWN_FLEET_NOTE,
    ),
    request: { query: v.getOverview.shape.query },
    responses: { 200: { description: 'Overview' }, 400: validationFailed },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/service-due`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.listServiceDue',
    ...authenticated(
      'Trucks past their service interval by distance or months, whichever came first. `trigger` ' +
        'says which clock ran out (distance | time | both | no_record); only the triggered ' +
        'overdueKm/overdueDays is set. Current state — not filtered by period. ' +
        OWN_FLEET_NOTE,
    ),
    responses: { 200: { description: 'Service-due queue — { items, total }' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/breakdowns`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.listBreakdowns',
    ...authenticated(
      'Trucks currently off the road (open breakdowns), oldest first, with where/when/towed, ' +
        'days down and market loads covering each. ' +
        COSTS_NOTE +
        ' ' +
        OWN_FLEET_NOTE,
    ),
    responses: { 200: { description: 'Breakdowns queue — { items, total, marketLoadsCovering }' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/tyres`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.listTyres',
    ...authenticated(
      'Tyre positions at or near the end of their tread, sorted by days until the legal floor ' +
        '(1.6mm, CMVR rule 94) — what runs out first, not what is most worn. Rows with no gauge ' +
        'reading are estimated from km run and flagged `estimated: true`. ' +
        OWN_FLEET_NOTE,
    ),
    responses: {
      200: { description: 'Tyres queue — { atLegalLimit, underThirtyPct, items, total }' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/batteries`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.listBatteries',
    ...authenticated(
      'Battery packs on electric trucks: monthly SoH series, degradation trend, when each pack ' +
        'reaches its warranty floor and whether that falls inside (manufacturer) or outside ' +
        '(capital_call) the warranty. ' +
        OWN_FLEET_NOTE,
    ),
    responses: { 200: { description: 'Batteries queue — { items, total, capitalCalls }' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/in-workshop`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.listInWorkshop',
    ...authenticated(
      'Every truck in the workshop right now — service check-ins and breakdowns together, ' +
        'oldest first, with days in and market loads covering each. ' +
        COSTS_NOTE +
        ' ' +
        OWN_FLEET_NOTE,
    ),
    responses: {
      200: { description: 'In the workshop — { items, total, brokenDown, inForService }' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/blocked-on-papers`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.listBlockedOnPapers',
    ...authenticated(
      'Trucks with an expired RC/insurance/permit/PUC/fitness that are not in the workshop — ' +
        'the availability bar’s "Blocked on papers" bucket. Dispatch only warns on these ' +
        '(dispatchEffect: warns_on_assign). ' +
        OWN_FLEET_NOTE,
    ),
    responses: { 200: { description: 'Blocked on papers — { items, total }' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/vehicles/{vehicleId}/tyres`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.getVehicleTyres',
    ...authenticated(
      'One truck’s axle diagram for Record Tyre Maintenance: every position its wheel count ' +
        'gives (FL, FR, R1L, R1R, …) with the tyre fitted there and its wear, plus the odometer.',
    ),
    request: { params: v.vehicleTyres.shape.params },
    responses: { 200: { description: 'Vehicle tyre layout' }, 404: notFound, 409: conflict },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/jobs`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.listJobs',
    ...authenticated(
      'Job history — every service and breakdown opened in the period, newest first. ' + COSTS_NOTE,
    ),
    request: { query: v.listJobs.shape.query },
    responses: { 200: { description: 'Paginated job history' }, 400: validationFailed },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/services`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.logService',
    ...permissionGated(
      [MAINTENANCE_MANAGE],
      'Log a service — a finished service, dated today unless serviceDate is given. If the ' +
        'truck is in the workshop (checked in for service, or broken down), this finishes that ' +
        'visit: the job closes with these details and the truck returns to dispatch in the same ' +
        'transaction (a breakdown closed this way is marked includesService). Otherwise a closed ' +
        'service job is recorded and dispatch is untouched. Only preventive_service and ' +
        'oil_change move the service clock. `cost` is the single invoiced total; invoiceFileKey ' +
        'is a confirmed upload with purpose maintenance/invoice.',
    ),
    request: { body: json(v.logService.shape.body) },
    responses: {
      201: { description: 'Service job' },
      400: validationFailed,
      404: notFound,
      409: conflict,
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/services/check-in`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.checkInService',
    ...permissionGated(
      [MAINTENANCE_MANAGE],
      'Send a truck to the workshop for a service — an open service job, and the vehicle ' +
        'becomes under_maintenance (out of dispatch) in the same transaction. Finish it with ' +
        'Log a service, POST /services/{jobId}/complete, or POST /workshop/{jobId}/release. 409 ' +
        'if the truck is already in the workshop.',
    ),
    request: { body: json(v.checkInService.shape.body) },
    responses: {
      201: { description: 'Open service job' },
      400: validationFailed,
      404: notFound,
      409: conflict,
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/workshop/{jobId}/release`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.releaseFromWorkshop',
    ...permissionGated(
      [MAINTENANCE_MANAGE],
      'Release from the workshop — closes an open visit (service or breakdown) without a ' +
        'service: the service clock is untouched and the truck returns to dispatch.',
    ),
    request: {
      params: v.releaseFromWorkshop.shape.params,
      body: json(v.releaseFromWorkshop.shape.body),
    },
    responses: { 200: { description: 'Closed job' }, 404: notFound, 409: conflict },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/services/{jobId}`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.updateService',
    ...permissionGated([MAINTENANCE_MANAGE], 'Update a service job’s workshop, notes and costs.'),
    request: { params: v.updateService.shape.params, body: json(v.updateService.shape.body) },
    responses: { 200: { description: 'Service job' }, 400: validationFailed, 404: notFound },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/services/{jobId}/complete`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.completeService',
    ...permissionGated(
      [MAINTENANCE_MANAGE],
      'Check a serviced truck out of the workshop. In one transaction the job closes, the ' +
        'service clock moves (the truck leaves the service-due queue) and the vehicle becomes ' +
        'active again in dispatch.',
    ),
    request: { params: v.completeService.shape.params, body: json(v.completeService.shape.body) },
    responses: {
      200: { description: 'Completed service job' },
      400: validationFailed,
      404: notFound,
      409: conflict,
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/vehicles/{vehicleId}/workshop-status`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.setWorkshopStatus',
    ...permissionGated(
      [MAINTENANCE_MANAGE],
      'Mark a truck in the workshop or release it — body is just { status }. in_workshop opens ' +
        'a bare workshop visit and takes the truck out of dispatch (if it is already in, the ' +
        'current visit is returned). available closes whatever visit is open — service or ' +
        'breakdown — without a service (clock untouched) and returns the truck to dispatch (if ' +
        'it is not in, nothing changes). Both are idempotent. Log a service on the truck later ' +
        'finishes the visit with its details.',
    ),
    request: {
      params: v.setWorkshopStatus.shape.params,
      body: json(v.setWorkshopStatus.shape.body),
    },
    responses: {
      200: { description: '{ vehicleId, status, visit }' },
      400: validationFailed,
      404: notFound,
      409: conflict,
    },
  });

  registry.registerPath({
    method: 'put',
    path: `${BASE}/vehicles/{vehicleId}/service-policy`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.setServicePolicy',
    ...permissionGated([MAINTENANCE_MANAGE], 'Set a vehicle’s service interval (km and months).'),
    request: { params: v.setServicePolicy.shape.params, body: json(v.setServicePolicy.shape.body) },
    responses: { 200: { description: 'Policy' }, 404: notFound, 409: conflict },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/breakdowns`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.openBreakdown',
    ...permissionGated(
      [MAINTENANCE_MANAGE],
      'Send a truck to the workshop. In the same transaction the vehicle becomes ' +
        'under_maintenance and disappears from dispatch. 409 if it already has an open breakdown, ' +
        'is attached, or is not active.',
    ),
    request: { body: json(v.openBreakdown.shape.body) },
    responses: {
      201: { description: 'Breakdown job' },
      400: validationFailed,
      404: notFound,
      409: conflict,
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/breakdowns/{jobId}`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.updateBreakdown',
    ...permissionGated([MAINTENANCE_MANAGE], 'Update location, towing, workshop and costs.'),
    request: { params: v.updateBreakdown.shape.params, body: json(v.updateBreakdown.shape.body) },
    responses: { 200: { description: 'Breakdown job' }, 400: validationFailed, 404: notFound },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/breakdowns/{jobId}/close`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.closeBreakdown',
    ...permissionGated(
      [MAINTENANCE_MANAGE],
      'Put the truck back in service. In the same transaction the vehicle becomes active and ' +
        'returns to dispatch. serviceCompleted: true (with odometerKm) records that the due ' +
        'service was also done on this visit — the service clock moves and the job is marked ' +
        'includesService, so no separate service entry is needed.',
    ),
    request: { params: v.closeBreakdown.shape.params, body: json(v.closeBreakdown.shape.body) },
    responses: {
      200: { description: 'Closed breakdown job' },
      400: validationFailed,
      404: notFound,
      409: conflict,
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/tyres/maintenance`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.recordTyreWork',
    ...permissionGated(
      [MAINTENANCE_MANAGE],
      'Record Tyre Maintenance — one invoice across one or more positions, as a closed `tyre` ' +
        'job (its totalCost counts in maintenance spend). new_fitment: the tyre on each position ' +
        'comes off as replaced and a new one goes on. cold_retread: the fitted casing is ' +
        'remoulded (same serial, retreadCount + 1) — 409 if damaged or out of retreads. All ' +
        'positions or none; dispatch is untouched.',
    ),
    request: { body: json(v.recordTyreWork.shape.body) },
    responses: {
      201: { description: '{ job, action, positions, tyres }' },
      400: validationFailed,
      404: notFound,
      409: conflict,
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/tyres`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.fitTyre',
    ...permissionGated([MAINTENANCE_MANAGE], 'Fit a tyre at a wheel position.'),
    request: { body: json(v.fitTyre.shape.body) },
    responses: { 201: { description: 'Tyre' }, 400: validationFailed, 409: conflict },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/tyres/{tyreId}/readings`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.recordTyreReading',
    ...permissionGated([MAINTENANCE_MANAGE], 'Record a tread-depth gauge reading.'),
    request: {
      params: v.recordTyreReading.shape.params,
      body: json(v.recordTyreReading.shape.body),
    },
    responses: { 201: { description: 'Reading' }, 400: validationFailed, 404: notFound },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/tyres/{tyreId}/remove`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.removeTyre',
    ...permissionGated(
      [MAINTENANCE_MANAGE],
      'Take a tyre off its position — reason scrap marks it scrapped, anything else removed.',
    ),
    request: { params: v.removeTyre.shape.params, body: json(v.removeTyre.shape.body) },
    responses: { 200: { description: 'Tyre' }, 404: notFound, 409: conflict },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/batteries`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.registerBatteryPack',
    ...permissionGated([MAINTENANCE_MANAGE], 'Register an electric truck’s battery pack.'),
    request: { body: json(v.registerBatteryPack.shape.body) },
    responses: { 201: { description: 'Battery pack' }, 400: validationFailed, 409: conflict },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/batteries/{packId}/readings`,
    tags: [TAGS.MAINTENANCE],
    operationId: 'maintenance.recordBatteryReading',
    ...permissionGated(
      [MAINTENANCE_MANAGE],
      'Record a monthly State-of-Health reading (normalised to the first of the month).',
    ),
    request: {
      params: v.recordBatteryReading.shape.params,
      body: json(v.recordBatteryReading.shape.body),
    },
    responses: { 201: { description: 'Reading' }, 404: notFound, 409: conflict },
  });
}
