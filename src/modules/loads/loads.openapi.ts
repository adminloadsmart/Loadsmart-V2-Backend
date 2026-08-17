import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { requisitionValidators } from './requisition.validators';
import { dispatchPlanningValidators } from './dispatch-planning.validators';
import { loadValidators } from './load.validators';
import { loadPaymentValidators } from './load-payment.validators';
import {
  REQUISITIONS_MANAGE,
  DISPATCH_PLANNING_MANAGE,
  LOADS_DOCUMENTS_MANAGE,
  PAYMENTS_MANAGE,
} from '../../shared/constants/permissions';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import {
  TAGS,
  authenticated,
  permissionGated,
  errorContent,
  json,
} from '../../shared/openapi/core';

/**
 * OpenAPI docs for the loads module: registers every route in loads.routes.ts, in the same
 * order, under the `loads` tag. See masters.openapi.ts for the pattern this mirrors.
 */

const BASE = `${API_VERSION_PREFIX}/loads`; // absolute path — must match its mount in composition-root.ts
const manageRequisitions = (description: string) =>
  permissionGated([REQUISITIONS_MANAGE], description);
const manageDispatch = (description: string) =>
  permissionGated([DISPATCH_PLANNING_MANAGE], description);
const manageDocuments = (description: string) =>
  permissionGated([LOADS_DOCUMENTS_MANAGE], description);
const managePayments = (description: string) => permissionGated([PAYMENTS_MANAGE], description);

export function registerLoadsOpenApi(registry: OpenAPIRegistry): void {
  // --- Requisitions ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/requisitions`,
    tags: [TAGS.LOADS],
    operationId: 'loads.createRequisition',
    ...manageRequisitions(
      'Capture the complete customer order (PRD §6.2). Every referenced customer/product/loading ' +
        'point must be approved/active, and the delivery point must belong to the given customer.',
    ),
    request: { body: json(requisitionValidators.create.shape.body) },
    responses: {
      201: { description: 'Created requisition, status "open", 0 tonnes dispatched' },
      400: { description: 'Validation failed', ...errorContent },
      409: { description: 'A referenced master record is not active', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/requisitions`,
    tags: [TAGS.LOADS],
    operationId: 'loads.listRequisitions',
    ...authenticated('List requisitions for the tenant, paginated and optionally filtered.'),
    request: { query: requisitionValidators.list.shape.query },
    responses: {
      200: {
        description: 'Paginated requisitions — { data: { items, page, limit, total, totalPages } }',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/requisitions/{requisitionId}`,
    tags: [TAGS.LOADS],
    operationId: 'loads.getRequisition',
    ...authenticated(
      "Requisition detail (PRD §6.10) — dispatched-vs-remaining tonnage plus every child load's current status.",
    ),
    request: { params: requisitionValidators.get.shape.params },
    responses: {
      200: { description: '{ requisition, loads }' },
      404: { description: 'Requisition not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/requisitions/{requisitionId}/close`,
    tags: [TAGS.LOADS],
    operationId: 'loads.closeRequisition',
    ...manageRequisitions(
      'Manually close a requisition with a reason (e.g. customer cancelled the remaining quantity) — FMS-REQ-012.',
    ),
    request: {
      params: requisitionValidators.close.shape.params,
      body: json(requisitionValidators.close.shape.body),
    },
    responses: {
      200: { description: 'Closed requisition' },
      404: { description: 'Requisition not found', ...errorContent },
      409: { description: 'Requisition is already closed', ...errorContent },
    },
  });

  // --- Dispatch Planning ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/requisitions/{requisitionId}/dispatch-plan`,
    tags: [TAGS.LOADS],
    operationId: 'loads.planDispatch',
    ...manageDispatch(
      'Plan how a requisition moves — one truck line per planned truck, own fleet or market (PRD ' +
        '§6.3). Splits the requisition into one Load per truck; partial dispatch is allowed and the ' +
        'requisition stays open with the remainder visible.',
    ),
    request: {
      params: dispatchPlanningValidators.plan.shape.params,
      body: json(dispatchPlanningValidators.plan.shape.body),
    },
    responses: {
      201: { description: '{ requisition, loads, capacitySummary }' },
      400: { description: 'Validation failed', ...errorContent },
      409: {
        description: 'Requisition not found or closed, or a referenced vehicle is not active',
        ...errorContent,
      },
    },
  });

  // --- Loads ---

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads`,
    tags: [TAGS.LOADS],
    operationId: 'loads.listLoads',
    ...authenticated('List loads for the tenant, paginated and optionally filtered.'),
    request: { query: loadValidators.list.shape.query },
    responses: {
      200: { description: 'Paginated loads — { data: { items, page, limit, total, totalPages } }' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads/{loadId}`,
    tags: [TAGS.LOADS],
    operationId: 'loads.getLoad',
    ...authenticated(
      'Load Detail (PRD §6.11) — status, assignment, documents (resolved to download URLs), ' +
        'payments, computed e-way-bill expiry, and the full chronological activity timeline. This ' +
        'is the only load/trip detail screen (FMS-LOAD-031).',
    ),
    request: { params: loadValidators.get.shape.params },
    responses: {
      200: { description: '{ load, timeline, payments, ewayBillExpiry }' },
      404: { description: 'Load not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads/{loadId}/activities`,
    tags: [TAGS.LOADS],
    operationId: 'loads.listLoadActivities',
    ...authenticated("List a load's activity timeline on its own, most recent last."),
    request: { params: loadValidators.getActivities.shape.params },
    responses: {
      200: { description: 'Load activities, chronological' },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/assign`,
    tags: [TAGS.LOADS],
    operationId: 'loads.assignLoad',
    ...manageDispatch(
      'Load Assignment (PRD §6.4). Own-fleet: resolves/validates the driver (defaults to the ' +
        "vehicle's primary linked driver) and surfaces a non-blocking compliance warning if the " +
        'vehicle has an expired document. Market: requires vehicleNumber/driverNumber (free text) ' +
        'plus freight terms.',
    ),
    request: {
      params: loadValidators.assign.shape.params,
      body: json(loadValidators.assign.shape.body),
    },
    responses: {
      200: { description: '{ load, complianceWarning }' },
      400: {
        description: 'Validation failed / missing required field for this source type',
        ...errorContent,
      },
      409: { description: 'Load is not in the "created" state', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/confirm-loading`,
    tags: [TAGS.LOADS],
    operationId: 'loads.confirmLoading',
    ...manageDocuments(
      'Attach invoice/e-way bill/E-LR and confirm loading (PRD §6.5). File keys must be confirmed ' +
        'uploads from POST /files with the matching purpose (loads/invoice, loads/eway-bill, ' +
        'trips/lr). Triggers tracking and, for market loads, enables advance payment.',
    ),
    request: {
      params: loadValidators.confirmLoading.shape.params,
      body: json(loadValidators.confirmLoading.shape.body),
    },
    responses: {
      200: { description: 'Loading confirmed' },
      400: {
        description: 'A file is not a confirmed upload for the expected purpose',
        ...errorContent,
      },
      409: { description: 'Load is not in the "assigned" state', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/status`,
    tags: [TAGS.LOADS],
    operationId: 'loads.updateLoadStatus',
    ...manageDocuments(
      'Manual tracking advance — At plant / In-transit / Reached delivery point (PRD §6.7; this ' +
        'build has no GPS/geofence automation). Rejects skipping ahead or moving backward.',
    ),
    request: {
      params: loadValidators.updateStatus.shape.params,
      body: json(loadValidators.updateStatus.shape.body),
    },
    responses: {
      200: { description: 'Updated load' },
      409: { description: "toStatus is not the load's next valid status", ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/pod`,
    tags: [TAGS.LOADS],
    operationId: 'loads.uploadPod',
    ...manageDocuments(
      'Record proof of delivery — exactly one of a document upload or a filled form (PRD §6.8). ' +
        'Marks the load Delivered; own-fleet loads close immediately, market loads wait for the ' +
        'balance payment.',
    ),
    request: {
      params: loadValidators.uploadPod.shape.params,
      body: json(loadValidators.uploadPod.shape.body),
    },
    responses: {
      200: { description: 'Updated load' },
      400: { description: 'Neither or both of {document, form} were provided', ...errorContent },
      409: { description: 'Loading has not been confirmed yet', ...errorContent },
    },
  });

  // --- Payments ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/payments/advance`,
    tags: [TAGS.LOADS],
    operationId: 'loads.recordAdvancePayment',
    ...managePayments(
      'Record the advance payment to a market-load transporter (PRD §6.6). Amount is computed ' +
        "from the load's freight value × advance %.",
    ),
    request: {
      params: loadPaymentValidators.recordAdvance.shape.params,
      body: json(loadPaymentValidators.recordAdvance.shape.body),
    },
    responses: {
      201: { description: 'Recorded advance payment' },
      409: {
        description: 'Not a market load, loading not confirmed, or already recorded',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/payments/balance`,
    tags: [TAGS.LOADS],
    operationId: 'loads.recordBalancePayment',
    ...managePayments(
      'Record the balance payment (PRD §6.9). Due date is derived from the E-POD date plus the ' +
        "transporter's credit days. Closes the load once advance is also paid.",
    ),
    request: {
      params: loadPaymentValidators.recordBalance.shape.params,
      body: json(loadPaymentValidators.recordBalance.shape.body),
    },
    responses: {
      201: { description: 'Recorded balance payment' },
      409: {
        description: 'Not a market load, E-POD not received, or already recorded',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads/{loadId}/payments`,
    tags: [TAGS.LOADS],
    operationId: 'loads.listLoadPayments',
    ...authenticated('List the advance/balance payments recorded against a load.'),
    request: { params: loadPaymentValidators.list.shape.params },
    responses: {
      200: { description: 'Load payments' },
    },
  });
}
