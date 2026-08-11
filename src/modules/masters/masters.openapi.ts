import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { mastersValidators } from './masters.validators';
import { MASTERS_WRITE } from '../../shared/constants/permissions';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import {
  TAGS,
  authenticated,
  permissionGated,
  SuccessResponseSchema,
  errorContent,
  json,
} from '../../shared/openapi/core';

/**
 * OpenAPI docs for the masters module: registers every route in masters.routes.ts, in the
 * same order, under the `masters` tag.
 *
 * masters.validators.ts is never imported for anything but its Zod schemas — request shapes
 * here are the literal same schema objects used by the `validate()` middleware, not
 * redescribed. Success response *bodies* aren't documented (see core.ts) — only status code +
 * description — except for the fixed `{ success: true }` shape on delete endpoints.
 */

const BASE = `${API_VERSION_PREFIX}/masters`; // absolute path — must match its mount in app.ts
const write = (description: string) => permissionGated([MASTERS_WRITE], description);

export function registerMastersOpenApi(registry: OpenAPIRegistry): void {
  // --- Truck types ---

  registry.registerPath({
    method: 'get',
    path: `${BASE}/truck-types`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listTruckTypes',
    ...authenticated(
      "List the tenant's truck types (Settings → Truck Types), each with how many vehicles " +
        'currently use it.',
    ),
    responses: {
      200: { description: 'Truck types, each with a vehicleCount' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/truck-types`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.createTruckType',
    ...write(
      'Create a truck type for the tenant — the exhaustive master vehicles.truckTypeId references.',
    ),
    request: { body: json(mastersValidators.createTruckType.shape.body) },
    responses: {
      201: { description: 'Created truck type' },
      400: { description: 'Validation failed', ...errorContent },
      409: { description: 'A truck type with this name already exists', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/truck-types/{truckTypeId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.deleteTruckType',
    ...write('Soft-delete a truck type. Blocked while any vehicle still references it.'),
    request: { params: mastersValidators.deleteTruckType.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Truck type not found', ...errorContent },
      409: { description: 'Still referenced by one or more vehicles', ...errorContent },
    },
  });

  // --- Vehicles ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/vehicles`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.createVehicle',
    ...write('Create a new vehicle for the tenant.'),
    request: { body: json(mastersValidators.createVehicle.shape.body) },
    responses: {
      201: { description: 'Created vehicle' },
      400: { description: 'Validation failed', ...errorContent },
      409: { description: 'Registration number already in use', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/vehicles`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listVehicles',
    ...authenticated('List vehicles for the tenant, paginated and optionally filtered.'),
    request: { query: mastersValidators.listVehicles.shape.query },
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
    ...authenticated('Get a single vehicle, including its documents and linked drivers.'),
    request: { params: mastersValidators.getVehicle.shape.params },
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
    ...write('Update one or more fields on a vehicle.'),
    request: {
      params: mastersValidators.updateVehicle.shape.params,
      body: json(mastersValidators.updateVehicle.shape.body),
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
    request: { params: mastersValidators.deleteVehicle.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Vehicle not found', ...errorContent },
    },
  });

  // --- Vehicle documents ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/vehicles/{vehicleId}/documents`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.addVehicleDocument',
    ...write('Attach a document (RC, insurance, permit, PUC, fitness) to a vehicle.'),
    request: {
      params: mastersValidators.addVehicleDocument.shape.params,
      body: json(mastersValidators.addVehicleDocument.shape.body),
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
    request: { params: mastersValidators.listVehicleDocuments.shape.params },
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
      params: mastersValidators.updateVehicleDocument.shape.params,
      body: json(mastersValidators.updateVehicleDocument.shape.body),
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
    request: { params: mastersValidators.deleteVehicleDocument.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Document not found', ...errorContent },
    },
  });

  // --- Drivers ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/drivers`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.createDriver',
    ...write('Create a new driver for the tenant.'),
    request: { body: json(mastersValidators.createDriver.shape.body) },
    responses: {
      201: { description: 'Created driver' },
      400: { description: 'Validation failed', ...errorContent },
      409: { description: 'Phone number already in use', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/drivers`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listDrivers',
    ...authenticated('List drivers for the tenant, paginated and optionally filtered.'),
    request: { query: mastersValidators.listDrivers.shape.query },
    responses: {
      200: {
        description: 'Paginated drivers — { data: { items, page, limit, total, totalPages } }',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/drivers/{driverId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getDriver',
    ...authenticated(
      'Get a single driver, including documents, verifications, bank details, and linked vehicles.',
    ),
    request: { params: mastersValidators.getDriver.shape.params },
    responses: {
      200: { description: 'Driver detail' },
      404: { description: 'Driver not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/drivers/{driverId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.updateDriver',
    ...write('Update one or more fields on a driver.'),
    request: {
      params: mastersValidators.updateDriver.shape.params,
      body: json(mastersValidators.updateDriver.shape.body),
    },
    responses: {
      200: { description: 'Updated driver' },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Driver not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/drivers/{driverId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.deleteDriver',
    ...write('Soft-delete a driver.'),
    request: { params: mastersValidators.deleteDriver.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Driver not found', ...errorContent },
    },
  });

  // --- Driver documents ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/drivers/{driverId}/documents`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.addDriverDocument',
    ...write('Attach a document (driving license front/back) to a driver.'),
    request: {
      params: mastersValidators.addDriverDocument.shape.params,
      body: json(mastersValidators.addDriverDocument.shape.body),
    },
    responses: {
      201: { description: 'Created document' },
      404: { description: 'Driver not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/drivers/{driverId}/documents`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listDriverDocuments',
    ...authenticated("List a driver's documents."),
    request: { params: mastersValidators.listDriverDocuments.shape.params },
    responses: {
      200: { description: 'Driver documents' },
      404: { description: 'Driver not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/drivers/{driverId}/documents/{documentId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.deleteDriverDocument',
    ...write('Soft-delete a driver document.'),
    request: { params: mastersValidators.deleteDriverDocument.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Document not found', ...errorContent },
    },
  });

  // --- Driver verifications ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/drivers/{driverId}/verifications`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.recordDriverVerification',
    ...write("Record the result of a driver's license verification (e.g. against Sarathi)."),
    request: {
      params: mastersValidators.recordDriverVerification.shape.params,
      body: json(mastersValidators.recordDriverVerification.shape.body),
    },
    responses: {
      201: { description: 'Recorded verification' },
      404: { description: 'Driver not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/drivers/{driverId}/verifications`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listDriverVerifications',
    ...authenticated("List a driver's recorded verifications."),
    request: { params: mastersValidators.listDriverVerifications.shape.params },
    responses: {
      200: { description: 'Driver verifications' },
      404: { description: 'Driver not found', ...errorContent },
    },
  });

  // --- Driver bank details ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/drivers/{driverId}/bank-details`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.addDriverBankDetails',
    ...write("Add a driver's bank account details."),
    request: {
      params: mastersValidators.addDriverBankDetails.shape.params,
      body: json(mastersValidators.addDriverBankDetails.shape.body),
    },
    responses: {
      201: { description: 'Created bank details' },
      404: { description: 'Driver not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/drivers/{driverId}/bank-details`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listDriverBankDetails',
    ...authenticated("List a driver's bank details."),
    request: { params: mastersValidators.listDriverBankDetails.shape.params },
    responses: {
      200: { description: 'Driver bank details' },
      404: { description: 'Driver not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/drivers/{driverId}/bank-details/{bankDetailsId}/verification`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.setDriverBankDetailsVerification',
    ...write('Set the verification status of a bank details record.'),
    request: {
      params: mastersValidators.setDriverBankDetailsVerification.shape.params,
      body: json(mastersValidators.setDriverBankDetailsVerification.shape.body),
    },
    responses: {
      200: { description: 'Updated bank details' },
      404: { description: 'Bank details not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/drivers/{driverId}/bank-details/{bankDetailsId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.deleteDriverBankDetails',
    ...write('Soft-delete a bank details record.'),
    request: { params: mastersValidators.deleteDriverBankDetails.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Bank details not found', ...errorContent },
    },
  });

  // --- Fleet-driver links ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/vehicles/{vehicleId}/drivers`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.linkDriver',
    ...write('Assign a driver to a vehicle.'),
    request: {
      params: mastersValidators.linkDriver.shape.params,
      body: json(mastersValidators.linkDriver.shape.body),
    },
    responses: {
      201: { description: 'Created link' },
      404: { description: 'Vehicle or driver not found', ...errorContent },
      409: { description: 'Driver already assigned to this vehicle', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/vehicles/{vehicleId}/drivers`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listVehicleLinks',
    ...authenticated('List the drivers linked to a vehicle.'),
    request: { params: mastersValidators.listVehicleLinks.shape.params },
    responses: {
      200: { description: 'Vehicle-driver links' },
      404: { description: 'Vehicle not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/drivers/{driverId}/vehicles`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listDriverLinks',
    ...authenticated('List the vehicles linked to a driver.'),
    request: { params: mastersValidators.listDriverLinks.shape.params },
    responses: {
      200: { description: 'Driver-vehicle links' },
      404: { description: 'Driver not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/fleet-driver-links/{linkId}/primary`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.setLinkPrimary',
    ...write(
      'Mark a fleet-driver link as the primary link for its vehicle (demotes any other primary link).',
    ),
    request: { params: mastersValidators.setLinkPrimary.shape.params },
    responses: {
      200: { description: 'Updated link' },
      404: { description: 'Link not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/fleet-driver-links/{linkId}/end`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.endLink',
    ...write('End an active fleet-driver link.'),
    request: {
      params: mastersValidators.endLink.shape.params,
      body: json(mastersValidators.endLink.shape.body),
    },
    responses: {
      200: { description: 'Updated link' },
      404: { description: 'Link not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/fleet-driver-links/{linkId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.deleteLink',
    ...write('Soft-delete a fleet-driver link.'),
    request: { params: mastersValidators.deleteLink.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Link not found', ...errorContent },
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
        'telemetry, service usage and operational status. The driver link stays a separate call.',
    ),
    request: { body: json(mastersValidators.onboardVehicle.shape.body) },
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
    request: { params: mastersValidators.getVehicleOperationalStatus.shape.params },
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
      params: mastersValidators.setVehicleOperationalStatus.shape.params,
      body: json(mastersValidators.setVehicleOperationalStatus.shape.body),
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
    request: { params: mastersValidators.getVehicleTelemetryMeta.shape.params },
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
      params: mastersValidators.setVehicleTelemetryMeta.shape.params,
      body: json(mastersValidators.setVehicleTelemetryMeta.shape.body),
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
    request: { params: mastersValidators.getVehicleServiceUsage.shape.params },
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
      params: mastersValidators.setVehicleServiceUsage.shape.params,
      body: json(mastersValidators.setVehicleServiceUsage.shape.body),
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
      params: mastersValidators.recordVehicleVerification.shape.params,
      body: json(mastersValidators.recordVehicleVerification.shape.body),
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
    request: { params: mastersValidators.listVehicleVerifications.shape.params },
    responses: {
      200: { description: 'Verification snapshots' },
      404: { description: 'Vehicle not found', ...errorContent },
    },
  });

  // --- Driver onboarding ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/drivers/onboard`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.onboardDriver',
    ...write(
      'Create a driver and every section of the "Add a driver" form in one transaction: Sarathi ' +
        'verification, licence photos, bank details and operational status. The vehicle link stays ' +
        'a separate call.',
    ),
    request: { body: json(mastersValidators.onboardDriver.shape.body) },
    responses: {
      201: { description: 'Created driver, with relations loaded' },
      400: { description: 'Validation failed', ...errorContent },
      409: { description: 'Phone number already in use', ...errorContent },
    },
  });

  // --- Driver operational status ---

  registry.registerPath({
    method: 'get',
    path: `${BASE}/drivers/{driverId}/operational-status`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getDriverOperationalStatus',
    ...authenticated("Get the driver's current operational status."),
    request: { params: mastersValidators.getDriverOperationalStatus.shape.params },
    responses: {
      200: { description: 'Operational status' },
      404: { description: 'Driver not found, or no status recorded yet', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/drivers/{driverId}/status`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.updateDriverStatus',
    ...write(
      'Set the operational status backing the My Drivers status dropdown (On trip / Active / On ' +
        'leave). One row per driver — first call inserts, later calls overwrite.',
    ),
    request: {
      params: mastersValidators.setDriverOperationalStatus.shape.params,
      body: json(mastersValidators.setDriverOperationalStatus.shape.body),
    },
    responses: {
      200: { description: 'Operational status' },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Driver not found', ...errorContent },
    },
  });

  // --- Driver trip metrics ---

  registry.registerPath({
    method: 'put',
    path: `${BASE}/drivers/{driverId}/trip-metrics`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.recordDriverTripMetrics',
    ...write(
      'Record trip count and on-time percentage for a period. Re-reporting a period overwrites it.',
    ),
    request: {
      params: mastersValidators.recordDriverTripMetrics.shape.params,
      body: json(mastersValidators.recordDriverTripMetrics.shape.body),
    },
    responses: {
      200: { description: 'Trip metrics for the period' },
      400: { description: 'Validation failed, or periodEnd before periodStart', ...errorContent },
      404: { description: 'Driver not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/drivers/{driverId}/trip-metrics`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listDriverTripMetrics',
    ...authenticated('List trip metrics for a driver, most recent period first.'),
    request: { params: mastersValidators.listDriverTripMetrics.shape.params },
    responses: {
      200: { description: 'Trip metrics' },
      404: { description: 'Driver not found', ...errorContent },
    },
  });
}
