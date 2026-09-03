import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { vehicleValidators } from './vehicle.validators';
import { DOCUMENT_EXPIRING_SOON_DAYS } from './vehicle.constants';
import { MASTERS_WRITE, MASTERS_APPROVE } from '../../../shared/constants/permissions';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import {
  TAGS,
  authenticated,
  permissionGated,
  SuccessResponseSchema,
  errorContent,
  json,
} from '../../../shared/openapi/core';

const BASE = `${API_VERSION_PREFIX}/masters`; // absolute path — must match its mount in app.ts
const write = (description: string) => permissionGated([MASTERS_WRITE], description);
const approve = (description: string) => permissionGated([MASTERS_APPROVE], description);

export function registerVehicleOpenApi(registry: OpenAPIRegistry): void {
  // --- Vehicles ---

  registry.registerPath({
    method: 'get',
    path: `${BASE}/vehicles`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listVehicles',
    ...authenticated('List vehicles for the tenant, paginated and optionally filtered.'),
    request: { query: vehicleValidators.listVehicles.shape.query },
    responses: {
      200: {
        description: 'Paginated vehicles — { data: { items, page, limit, total, totalPages } }',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/vehicles/{vehicleId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getVehicle',
    ...authenticated(
      'Get a single vehicle, including its documents, linked drivers, and telemetry (EMI + GPS).',
    ),
    request: { params: vehicleValidators.getVehicle.shape.params },
    responses: {
      200: { description: 'Vehicle detail' },
      404: { description: 'Vehicle not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/vehicles/{vehicleId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.updateVehicle',
    ...write(
      'Update one or more fields on a vehicle. Passing driverId re-links that driver as the ' +
        "vehicle's primary driver in the same request, ending whichever link previously held " +
        'that slot.',
    ),
    request: {
      params: vehicleValidators.updateVehicle.shape.params,
      body: json(vehicleValidators.updateVehicle.shape.body),
    },
    responses: {
      200: { description: 'Updated vehicle' },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Vehicle not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/vehicles/{vehicleId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.deleteVehicle',
    ...write('Soft-delete a vehicle.'),
    request: { params: vehicleValidators.deleteVehicle.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Vehicle not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/vehicles/{vehicleId}/approve`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.approveVehicle',
    ...approve(
      'Approve a pending vehicle (added by dispatch — see onboardVehicle). Settings → Approvals. ' +
        'org_admin only.',
    ),
    request: { params: vehicleValidators.approveVehicle.shape.params },
    responses: {
      200: { description: 'Approved vehicle' },
      404: { description: 'Vehicle not found', ...errorContent },
      409: { description: 'Vehicle is not pending', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/vehicles/{vehicleId}/reject`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.rejectVehicle',
    ...approve('Reject a pending vehicle with a mandatory reason. org_admin only.'),
    request: {
      params: vehicleValidators.rejectVehicle.shape.params,
      body: json(vehicleValidators.rejectVehicle.shape.body),
    },
    responses: {
      200: { description: 'Rejected vehicle' },
      400: { description: 'Validation failed (reason required)', ...errorContent },
      404: { description: 'Vehicle not found', ...errorContent },
      409: { description: 'Vehicle is not pending', ...errorContent },
    },
  });

  // --- Vehicle documents ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/vehicles/{vehicleId}/documents`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.addVehicleDocument',
    ...write(
      'Attach a document (RC, insurance, permit, PUC, fitness, or an RC front/back photo) to a ' +
        'vehicle. RC/insurance/permit/PUC/fitness track documentNumber/issueDate/expiryDate only — ' +
        'fileUrl is rejected for those 5; only rc_front/rc_back accept an upload.',
    ),
    request: {
      params: vehicleValidators.addVehicleDocument.shape.params,
      body: json(vehicleValidators.addVehicleDocument.shape.body),
    },
    responses: {
      201: { description: 'Created document' },
      404: { description: 'Vehicle not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/vehicles/{vehicleId}/documents`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listVehicleDocuments',
    ...authenticated("List a vehicle's documents."),
    request: { params: vehicleValidators.listVehicleDocuments.shape.params },
    responses: {
      200: { description: 'Vehicle documents' },
      404: { description: 'Vehicle not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/vehicles/{vehicleId}/documents/{documentId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.updateVehicleDocument',
    ...write('Update one or more fields on a vehicle document.'),
    request: {
      params: vehicleValidators.updateVehicleDocument.shape.params,
      body: json(vehicleValidators.updateVehicleDocument.shape.body),
    },
    responses: {
      200: { description: 'Updated document' },
      404: { description: 'Document not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/vehicles/{vehicleId}/documents/{documentId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.deleteVehicleDocument',
    ...write('Soft-delete a vehicle document.'),
    request: { params: vehicleValidators.deleteVehicleDocument.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Document not found', ...errorContent },
    },
  });

  // --- Vehicle onboarding ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/vehicles/onboard`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.onboardVehicle',
    ...write(
      'Create a vehicle and every section of the "Add a vehicle" form in one transaction: ' +
        'VAHAN verification (which folds registry expiry dates into the document rows), documents, ' +
        'telemetry, service usage, operational status, and an optional driver link. When ' +
        'driverLink is given it is applied in the same transaction, so the vehicle and its driver ' +
        'link succeed or fail together; the link can also be made or changed later via ' +
        'POST /vehicles/{vehicleId}/drivers. Only org_admin and dispatch may call this at all — ' +
        "org_admin's vehicle is created `active` immediately; dispatch's is created `pending` " +
        'until an org_admin approves or rejects it via PATCH .../approve|reject.',
    ),
    request: { body: json(vehicleValidators.onboardVehicle.shape.body) },
    responses: {
      201: { description: 'Created vehicle, with relations loaded' },
      400: { description: 'Validation failed', ...errorContent },
      409: { description: 'Registration number already in use', ...errorContent },
    },
  });

  // --- Vehicle operational status ---

  registry.registerPath({
    method: 'get',
    path: `${BASE}/vehicles/{vehicleId}/operational-status`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getVehicleOperationalStatus',
    ...authenticated("Get the vehicle's current operational status."),
    request: { params: vehicleValidators.getVehicleOperationalStatus.shape.params },
    responses: {
      200: { description: 'Operational status' },
      404: { description: 'Vehicle not found, or no status recorded yet', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'put',
    path: `${BASE}/vehicles/{vehicleId}/operational-status`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.setVehicleOperationalStatus',
    ...write(
      'Set the operational status. One row per vehicle — first call inserts, later calls overwrite.',
    ),
    request: {
      params: vehicleValidators.setVehicleOperationalStatus.shape.params,
      body: json(vehicleValidators.setVehicleOperationalStatus.shape.body),
    },
    responses: {
      200: { description: 'Operational status' },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Vehicle not found', ...errorContent },
    },
  });

  // --- Vehicle telemetry ---

  registry.registerPath({
    method: 'get',
    path: `${BASE}/vehicles/{vehicleId}/telemetry`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getVehicleTelemetryMeta',
    ...authenticated('Get the GPS and EMI metadata for a vehicle.'),
    request: { params: vehicleValidators.getVehicleTelemetryMeta.shape.params },
    responses: {
      200: { description: 'Telemetry metadata' },
      404: { description: 'Vehicle not found, or no telemetry recorded yet', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'put',
    path: `${BASE}/vehicles/{vehicleId}/telemetry`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.setVehicleTelemetryMeta',
    ...write(
      'Set GPS and EMI metadata. One row per vehicle — first call inserts, later calls patch it.',
    ),
    request: {
      params: vehicleValidators.setVehicleTelemetryMeta.shape.params,
      body: json(vehicleValidators.setVehicleTelemetryMeta.shape.body),
    },
    responses: {
      200: { description: 'Telemetry metadata' },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Vehicle not found', ...errorContent },
    },
  });

  // --- Vehicle service & usage ---

  registry.registerPath({
    method: 'get',
    path: `${BASE}/vehicles/{vehicleId}/service-usage`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getVehicleServiceUsage',
    ...authenticated('Get odometer, last service and last tyre change for a vehicle.'),
    request: { params: vehicleValidators.getVehicleServiceUsage.shape.params },
    responses: {
      200: { description: 'Service and usage' },
      404: { description: 'Vehicle not found, or nothing recorded yet', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'put',
    path: `${BASE}/vehicles/{vehicleId}/service-usage`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.setVehicleServiceUsage',
    ...write('Set odometer, last service and last tyre change. Feeds the maintenance reminders.'),
    request: {
      params: vehicleValidators.setVehicleServiceUsage.shape.params,
      body: json(vehicleValidators.setVehicleServiceUsage.shape.body),
    },
    responses: {
      200: { description: 'Service and usage' },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Vehicle not found', ...errorContent },
    },
  });

  // --- Vehicle verifications ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/vehicles/{vehicleId}/verifications`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.recordVehicleVerification',
    ...write(
      'Record a VAHAN check. A verified result also upserts the Insurance/RC/Permit/PUC/Fitness ' +
        'document rows from the supplied expiry dates, in the same transaction.',
    ),
    request: {
      params: vehicleValidators.recordVehicleVerification.shape.params,
      body: json(vehicleValidators.recordVehicleVerification.shape.body),
    },
    responses: {
      201: { description: 'Created verification snapshot' },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Vehicle not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/vehicles/{vehicleId}/verifications`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listVehicleVerifications',
    ...authenticated('List the VAHAN check history for a vehicle, most recent first.'),
    request: { params: vehicleValidators.listVehicleVerifications.shape.params },
    responses: {
      200: { description: 'Verification snapshots' },
      404: { description: 'Vehicle not found', ...errorContent },
    },
  });

  // --- Compliance alerts ---

  registry.registerPath({
    method: 'get',
    path: `${BASE}/compliance-alert`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listComplianceAlerts',
    ...authenticated(
      'Fleet-wide vehicle-document compliance alerts — documents already expired or expiring ' +
        `within ${DOCUMENT_EXPIRING_SOON_DAYS} days, most urgent first. Feeds the Home ` +
        "dashboard's Compliance widget.",
    ),
    request: { query: vehicleValidators.listComplianceAlerts.shape.query },
    responses: {
      200: {
        description:
          'Paginated compliance alerts — { data: { items, page, limit, total, totalPages } }; ' +
          'each item is a vehicle document with its vehicle relation loaded and status freshly ' +
          'recomputed (never trusts the persisted, possibly stale status column).',
      },
    },
  });
}
