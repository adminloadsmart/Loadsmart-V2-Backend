import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { fleetDriverLinkValidators } from './fleet-driver-link.validators';
import { MASTERS_WRITE } from '../../../shared/constants/permissions';
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

export function registerFleetDriverLinkOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: `${BASE}/vehicles/{vehicleId}/drivers`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.linkDriver',
    ...write('Assign a driver to a vehicle.'),
    request: {
      params: fleetDriverLinkValidators.linkDriver.shape.params,
      body: json(fleetDriverLinkValidators.linkDriver.shape.body),
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
    request: { params: fleetDriverLinkValidators.listVehicleLinks.shape.params },
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
    request: { params: fleetDriverLinkValidators.listDriverLinks.shape.params },
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
    request: { params: fleetDriverLinkValidators.setLinkPrimary.shape.params },
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
      params: fleetDriverLinkValidators.endLink.shape.params,
      body: json(fleetDriverLinkValidators.endLink.shape.body),
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
    request: { params: fleetDriverLinkValidators.deleteLink.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Link not found', ...errorContent },
    },
  });
}
