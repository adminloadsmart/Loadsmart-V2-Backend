import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { mastersValidators } from './masters.validators';
import { MASTERS_WRITE } from '../../shared/constants/permissions';
import { TAGS, authenticated, permissionGated, SuccessResponseSchema, errorContent, json } from '../../shared/openapi/core';

/**
 * OpenAPI docs for the masters module: registers every route in masters.routes.ts, in the
 * same order, under the `masters` tag.
 *
 * masters.validators.ts is never imported for anything but its Zod schemas — request shapes
 * here are the literal same schema objects used by the `validate()` middleware, not
 * redescribed. Success response *bodies* aren't documented (see core.ts) — only status code +
 * description — except for the fixed `{ success: true }` shape on delete endpoints.
 */

const BASE = '/masters'; // absolute path — must match its mount in composition-root.ts
const write = (description: string) => permissionGated([MASTERS_WRITE], description);

export function registerMastersOpenApi(registry: OpenAPIRegistry): void {
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
      200: { description: 'Paginated vehicles — { data: { items, page, limit, total, totalPages } }' },
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
      200: { description: 'Paginated drivers — { data: { items, page, limit, total, totalPages } }' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/drivers/{driverId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getDriver',
    ...authenticated('Get a single driver, including documents, verifications, bank details, and linked vehicles.'),
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
    ...write('Mark a fleet-driver link as the primary link for its vehicle (demotes any other primary link).'),
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
}
