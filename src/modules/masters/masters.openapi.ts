import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { mastersValidators } from './masters.validators';
import { loadingPointValidators } from './loading-point.validators';
import { DOCUMENT_EXPIRING_SOON_DAYS } from './masters.constants';
import { productValidators } from './product.validators';
import { MASTERS_WRITE, MASTERS_APPROVE } from '../../shared/constants/permissions';
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
const approve = (description: string) => permissionGated([MASTERS_APPROVE], description);

export function registerMastersOpenApi(registry: OpenAPIRegistry): void {
  // --- Products ---
  registry.registerPath({
    method: 'post',
    path: `${BASE}/products/import`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.importProductsCsv',
    ...write(
      'Bulk import products from a CSV file. Each row creates one product and optional sub-items.',
    ),
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: {
                file: { type: 'string', format: 'binary', description: 'CSV file, maximum 5 MB.' },
              },
            },
          },
        },
      },
    },
    responses: {
      201: { description: 'Import report with created and failed row counts' },
      400: { description: 'Invalid CSV or missing file', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'post',
    path: `${BASE}/products`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.createProduct',
    ...write(
      'Create a product with optional sub-items. Org admins are automatically approved; other permitted creators remain pending.',
    ),
    request: { body: json(productValidators.create.shape.body) },
    responses: {
      201: { description: 'Created product' },
      400: { description: 'Validation failed', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/products`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listProducts',
    ...authenticated('List tenant products with pagination, search, and approval/status filters.'),
    request: { query: productValidators.list.shape.query },
    responses: { 200: { description: 'Paginated products with active sub-items' } },
  });
  registry.registerPath({
    method: 'get',
    path: `${BASE}/products/{productId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getProduct',
    ...authenticated('Get a product and its active sub-items.'),
    request: { params: productValidators.get.shape.params },
    responses: {
      200: { description: 'Product detail' },
      404: { description: 'Product not found', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/products/{productId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.updateProduct',
    ...write('Update product fields and add, edit, or soft-delete sub-items transactionally.'),
    request: {
      params: productValidators.update.shape.params,
      body: json(productValidators.update.shape.body),
    },
    responses: {
      200: { description: 'Updated product' },
      404: { description: 'Product not found', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/products/{productId}/approve`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.approveProduct',
    ...approve('Approve a pending product. org_admin only.'),
    request: { params: productValidators.approve.shape.params },
    responses: {
      200: { description: 'Approved product' },
      409: { description: 'Product is not pending', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/products/{productId}/reject`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.rejectProduct',
    ...approve('Reject a pending product with a mandatory reason. org_admin only.'),
    request: {
      params: productValidators.reject.shape.params,
      body: json(productValidators.reject.shape.body),
    },
    responses: {
      200: { description: 'Rejected product' },
      400: { description: 'Validation failed', ...errorContent },
      409: { description: 'Product is not pending', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/products/{productId}/status`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.setProductStatus',
    ...write('Set a product active or inactive.'),
    request: {
      params: productValidators.status.shape.params,
      body: json(productValidators.status.shape.body),
    },
    responses: { 200: { description: 'Updated product status' } },
  });
  registry.registerPath({
    method: 'delete',
    path: `${BASE}/products/{productId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.deleteProduct',
    ...write('Soft-delete a product and all of its sub-items.'),
    request: { params: productValidators.delete.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Product not found', ...errorContent },
    },
  });

  // --- Truck types ---

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
    request: { body: json(mastersValidators.addTruckTypesFromCatalog.shape.body) },
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
    request: { body: json(mastersValidators.resolveTruckType.shape.body) },
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

  // --- Loading points ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loading-points/import`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.importLoadingPointsCsv',
    ...write('Bulk import loading points from a CSV file.'),
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: {
                file: { type: 'string', format: 'binary', description: 'CSV file, maximum 5 MB.' },
              },
            },
          },
        },
      },
    },
    responses: {
      201: { description: 'Import report with created and failed row counts' },
      400: { description: 'Invalid CSV or missing file', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loading-points`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.createLoadingPoint',
    ...write(
      'Create a loading point (warehouse/factory origin). New records start pending and need org_admin approval before they go live.',
    ),
    request: { body: json(loadingPointValidators.create.shape.body) },
    responses: {
      201: { description: 'Created loading point' },
      400: { description: 'Validation failed', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loading-points`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listLoadingPoints',
    ...authenticated('List loading points for the tenant, paginated and optionally filtered.'),
    request: { query: loadingPointValidators.list.shape.query },
    responses: {
      200: {
        description:
          'Paginated loading points — { data: { items, page, limit, total, totalPages } }',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loading-points/cities`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listLoadingPointCities',
    ...authenticated(
      'Distinct cities with at least one loading point — feeds a city filter dropdown.',
    ),
    request: { query: loadingPointValidators.listCities.shape.query },
    responses: { 200: { description: 'Sorted list of distinct city names' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loading-points/{loadingPointId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getLoadingPoint',
    ...authenticated('Get a single loading point, including full address and contact details.'),
    request: { params: loadingPointValidators.get.shape.params },
    responses: {
      200: { description: 'Loading point detail' },
      404: { description: 'Loading point not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loading-points/{loadingPointId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.updateLoadingPoint',
    ...write('Update one or more fields on a loading point.'),
    request: {
      params: loadingPointValidators.update.shape.params,
      body: json(loadingPointValidators.update.shape.body),
    },
    responses: {
      200: { description: 'Updated loading point' },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Loading point not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loading-points/{loadingPointId}/approve`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.approveLoadingPoint',
    ...approve('Approve a pending loading point. org_admin only.'),
    request: { params: loadingPointValidators.approve.shape.params },
    responses: {
      200: { description: 'Approved loading point' },
      404: { description: 'Loading point not found', ...errorContent },
      409: { description: 'Loading point is not pending', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loading-points/{loadingPointId}/reject`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.rejectLoadingPoint',
    ...approve('Reject a pending loading point with a mandatory reason. org_admin only.'),
    request: {
      params: loadingPointValidators.reject.shape.params,
      body: json(loadingPointValidators.reject.shape.body),
    },
    responses: {
      200: { description: 'Rejected loading point' },
      400: { description: 'Validation failed (reason required)', ...errorContent },
      404: { description: 'Loading point not found', ...errorContent },
      409: { description: 'Loading point is not pending', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/loading-points/{loadingPointId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.deleteLoadingPoint',
    ...write('Soft-delete a loading point.'),
    request: { params: loadingPointValidators.delete.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Loading point not found', ...errorContent },
    },
  });

  // --- Transporters ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/transporters`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.createTransporter',
    ...authenticated('Create a transporter. Available only to the organization admin.'),
    request: { body: json(mastersValidators.createTransporter.shape.body) },
    responses: {
      201: { description: 'Created transporter' },
      400: { description: 'Validation failed', ...errorContent },
      403: { description: 'Only organization admins can manage transporters', ...errorContent },
      409: { description: 'A transporter with this name already exists', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/transporters`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listTransporters',
    ...authenticated(
      'List the organization transporters. Available only to the organization admin.',
    ),
    request: { query: mastersValidators.listTransporters.shape.query },
    responses: {
      200: {
        description: 'Paginated transporters — { data: { items, page, limit, total, totalPages } }',
      },
      403: { description: 'Only organization admins can manage transporters', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/transporters/{transporterId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getTransporter',
    ...authenticated('Get a single transporter. Available only to the organization admin.'),
    request: { params: mastersValidators.getTransporter.shape.params },
    responses: {
      200: { description: 'Transporter detail' },
      403: { description: 'Only organization admins can manage transporters', ...errorContent },
      404: { description: 'Transporter not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/transporters/import`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.importTransportersCsv',
    ...write('Bulk upload transporters from a CSV file. Organization admin only.'),
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: {
                file: { type: 'string', format: 'binary', description: 'CSV file, maximum 5 MB.' },
              },
            },
          },
        },
      },
    },
    responses: {
      201: { description: 'Import completed with a row-level result report' },
      400: { description: 'Invalid CSV or missing file', ...errorContent },
      403: { description: 'Only organization admins can manage transporters', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/transporters/{transporterId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.updateTransporter',
    ...authenticated('Update a transporter. Available only to the organization admin.'),
    request: {
      params: mastersValidators.updateTransporter.shape.params,
      body: json(mastersValidators.updateTransporter.shape.body),
    },
    responses: {
      200: { description: 'Updated transporter' },
      400: { description: 'Validation failed', ...errorContent },
      403: { description: 'Only organization admins can manage transporters', ...errorContent },
      404: { description: 'Transporter not found', ...errorContent },
      409: { description: 'A transporter with this name already exists', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/transporters/{transporterId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.deleteTransporter',
    ...authenticated('Soft-delete a transporter. Available only to the organization admin.'),
    request: { params: mastersValidators.deleteTransporter.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      403: { description: 'Only organization admins can manage transporters', ...errorContent },
      404: { description: 'Transporter not found', ...errorContent },
    },
  });

  // --- Vehicles ---

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
    ...authenticated(
      'Get a single vehicle, including its documents, linked drivers, and telemetry (EMI + GPS).',
    ),
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
    ...write(
      'Update one or more fields on a vehicle. Passing driverId re-links that driver as the ' +
        "vehicle's primary driver in the same request, ending whichever link previously held " +
        'that slot.',
    ),
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

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/vehicles/{vehicleId}/approve`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.approveVehicle',
    ...approve(
      'Approve a pending vehicle (added by dispatch — see onboardVehicle). Settings → Approvals. ' +
        'org_admin only.',
    ),
    request: { params: mastersValidators.approveVehicle.shape.params },
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
      params: mastersValidators.rejectVehicle.shape.params,
      body: json(mastersValidators.rejectVehicle.shape.body),
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

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/drivers/{driverId}/approve`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.approveDriver',
    ...approve(
      'Approve a pending driver (added by dispatch — see onboardDriver). Settings → Approvals. ' +
        'org_admin only.',
    ),
    request: { params: mastersValidators.approveDriver.shape.params },
    responses: {
      200: { description: 'Approved driver' },
      404: { description: 'Driver not found', ...errorContent },
      409: { description: 'Driver is not pending', ...errorContent },
    },
  });
  registry.registerPath({
    method: 'patch',
    path: `${BASE}/drivers/{driverId}/reject`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.rejectDriver',
    ...approve('Reject a pending driver with a mandatory reason. org_admin only.'),
    request: {
      params: mastersValidators.rejectDriver.shape.params,
      body: json(mastersValidators.rejectDriver.shape.body),
    },
    responses: {
      200: { description: 'Rejected driver' },
      400: { description: 'Validation failed (reason required)', ...errorContent },
      404: { description: 'Driver not found', ...errorContent },
      409: { description: 'Driver is not pending', ...errorContent },
    },
  });

  // --- Driver documents ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/drivers/{driverId}/documents`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.addDriverDocument',
    ...write(
      'Attach a document (driving license front/back) to a driver. `fileUrl` must be the storage `key` of a file already uploaded via POST /files with purpose `masters/driver` and confirmed — see storage.constants.ts.',
    ),
    request: {
      params: mastersValidators.addDriverDocument.shape.params,
      body: json(mastersValidators.addDriverDocument.shape.body),
    },
    responses: {
      201: { description: 'Created document, with fileUrl resolved to a fresh download URL' },
      400: { description: 'File is not a confirmed masters/driver upload', ...errorContent },
      404: { description: 'Driver or file not found', ...errorContent },
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
        'telemetry, service usage, operational status, and an optional driver link. When ' +
        'driverLink is given it is applied in the same transaction, so the vehicle and its driver ' +
        'link succeed or fail together; the link can also be made or changed later via ' +
        'POST /vehicles/{vehicleId}/drivers. Only org_admin and dispatch may call this at all — ' +
        "org_admin's vehicle is created `active` immediately; dispatch's is created `pending` " +
        'until an org_admin approves or rejects it via PATCH .../approve|reject.',
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
    path: `${BASE}/drivers/verify-dl`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.verifyDriverDl',
    ...write(
      'Check a driving licence + date of birth against the Sarathi registry via IDfy, before the ' +
        'driver record exists — step 2 of the "Add a driver" form. Submits an async IDfy task and ' +
        'polls for the result before responding. As of 2026-08 (IDfy credits exhausted), always ' +
        'falls back to verified (without registry fields) — whether IDFY_API_KEY/IDFY_ACCOUNT_ID/' +
        'IDFY_TASK_ID/IDFY_GROUP_ID are unset, the call fails, or IDfy completes the task but ' +
        'reports no match. Revert to manual_review on those paths once IDfy credits are restored.',
    ),
    request: { body: json(mastersValidators.verifyDriverDl.shape.body) },
    responses: {
      200: { description: 'verified (with registry fields when available)' },
      400: { description: 'Validation failed', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/drivers/onboard`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.onboardDriver',
    ...write(
      'Create a driver and every section of the "Add a driver" form in one transaction: Sarathi ' +
        'verification, licence photos, bank details and operational status. The vehicle link stays ' +
        "a separate call. Only org_admin and dispatch may call this at all — org_admin's driver " +
        "is created `active` immediately; dispatch's is created `pending` until an org_admin " +
        'approves or rejects it via PATCH .../approve|reject.',
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
    request: { query: mastersValidators.listComplianceAlerts.shape.query },
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
