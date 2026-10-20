import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { GEOFENCES_MANAGE } from '../../shared/constants/permissions';
import {
  TAGS,
  SuccessResponseSchema,
  authenticated,
  errorContent,
  json,
  permissionGated,
} from '../../shared/openapi/core';
import { geofenceValidators } from './geofence.validators';

const BASE = `${API_VERSION_PREFIX}/geofences`; // absolute path — must match its mount in app.ts
const manage = (description: string) => permissionGated([GEOFENCES_MANAGE], description);

export function registerGeofencesOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'post',
    path: BASE,
    tags: [TAGS.GEOFENCES],
    operationId: 'geofences.create',
    ...manage(
      'Create a geofence: a circle (latitude/longitude + radiusM, 50–5000 m) or a drawn polygon, with alert rules, the trucks it applies to and who is alerted. loadingPointId / customerDeliveryPointId link a loading_point / unloading_point geofence to the master point it stands for — required for the tracking service’s geofence entry to drive load status.',
    ),
    request: { body: json(geofenceValidators.create.shape.body) },
    responses: {
      201: { description: 'Geofence created' },
      400: { description: 'Validation failed', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: BASE,
    tags: [TAGS.GEOFENCES],
    operationId: 'geofences.list',
    ...authenticated('List the organization’s geofences, newest first. Filter by type / isActive.'),
    request: { query: geofenceValidators.list.shape.query },
    responses: { 200: { description: 'Paginated geofences' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/{geofenceId}`,
    tags: [TAGS.GEOFENCES],
    operationId: 'geofences.get',
    ...authenticated('Get one geofence.'),
    request: { params: geofenceValidators.get.shape.params },
    responses: {
      200: { description: 'Geofence' },
      404: { description: 'Geofence not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/{geofenceId}`,
    tags: [TAGS.GEOFENCES],
    operationId: 'geofences.update',
    ...manage(
      'Update a geofence. Send only what changes; appliesTo and recipients replace the stored lists when present.',
    ),
    request: {
      params: geofenceValidators.update.shape.params,
      body: json(geofenceValidators.update.shape.body),
    },
    responses: {
      200: { description: 'Geofence updated' },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Geofence not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/{geofenceId}`,
    tags: [TAGS.GEOFENCES],
    operationId: 'geofences.delete',
    ...manage('Delete (soft) a geofence. Past enter/exit events are kept.'),
    request: { params: geofenceValidators.delete.shape.params },
    responses: {
      200: { description: 'Geofence deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Geofence not found', ...errorContent },
    },
  });
}
