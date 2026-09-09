import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { truckTypeValidators } from './truck-type.validators';
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

export function registerTruckTypeOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/truck-types/catalog`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listTruckTypeCatalog',
    ...authenticated(
      'List the global truck-type catalog (PRD §5.7, "configurable from the Admin Panel") — the ' +
        'fixed reference names the "Add truck type" modal offers to pick from. Not tenant-scoped.',
    ),
    responses: {
      200: { description: 'Catalog entries' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/truck-types/from-catalog`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.addTruckTypesFromCatalog',
    ...write(
      'Add one or more catalog names as this tenant\'s own truck types — backs the "Add truck ' +
        'type" modal\'s multi-select. Any name not present in the catalog is rejected; a fully ' +
        'custom name still goes through POST /truck-types instead.',
    ),
    request: { body: json(truckTypeValidators.addTruckTypesFromCatalog.shape.body) },
    responses: {
      201: { description: "The tenant's truck types after the add, each with a vehicleCount" },
      400: { description: 'Validation failed, or a name not in the catalog', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/truck-types/resolve`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.resolveTruckType',
    ...write(
      "Market Fleet's 3-step picker (body type → wheel configuration → capacity) resolved " +
        "directly to a usable truckTypeId — get-or-create against the tenant's own truck types, " +
        'backed by the global catalog. No separate "add from catalog" step required first.',
    ),
    request: { body: json(truckTypeValidators.resolveTruckType.shape.body) },
    responses: {
      200: { description: 'The matching (or newly created) tenant truck type' },
      400: { description: 'Validation failed', ...errorContent },
      404: {
        description: 'No catalog entry for this body/wheel/capacity combination',
        ...errorContent,
      },
    },
  });

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
    request: { body: json(truckTypeValidators.createTruckType.shape.body) },
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
    request: { params: truckTypeValidators.deleteTruckType.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Truck type not found', ...errorContent },
      409: { description: 'Still referenced by one or more vehicles', ...errorContent },
    },
  });
}
