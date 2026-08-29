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
      'Capture the complete customer order — one or more product lines, each with its own ' +
        'tonnage. Every referenced customer/product/loading point must be approved/active, and ' +
        'the delivery point must belong to the given customer. A PO/SO number already used on ' +
        'another requisition (C-05) is an amber, overridable check.',
    ),
    request: { body: json(requisitionValidators.create.shape.body) },
    responses: {
      201: {
        description:
          'Created requisition, status "open", 0 tonnes dispatched, with an auto-generated ' +
          '"REQ-nnnn" display code',
      },
      400: { description: 'Validation failed', ...errorContent },
      409: {
        description:
          'A referenced master record is not active, or the PO/SO number is already in use and no override was given',
        ...errorContent,
      },
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
      "Requisition detail — dispatched-vs-remaining tonnage plus every child load's current status.",
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
      'Manually close a requisition with a reason (e.g. customer cancelled the remaining quantity).',
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

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/requisitions/{requisitionId}`,
    tags: [TAGS.LOADS],
    operationId: 'loads.deleteRequisition',
    ...manageRequisitions(
      'Delete a requisition that has no loads created against it yet — undoes a mistaken ' +
        'create. Once any load exists, close it instead.',
    ),
    request: { params: requisitionValidators.delete.shape.params },
    responses: {
      200: { description: 'Deleted' },
      404: { description: 'Requisition not found', ...errorContent },
      409: {
        description: 'One or more loads already exist against this requisition',
        ...errorContent,
      },
    },
  });

  // --- Dispatch Planning ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/requisitions/{requisitionId}/dispatch-plan`,
    tags: [TAGS.LOADS],
    operationId: 'loads.planDispatch',
    ...manageDispatch(
      'Plan how a requisition moves — one truck line per planned truck, own fleet (multi-vehicle: ' +
        'one load per selected vehicle, all sharing the same cargo mix, created already "assigned") ' +
        'or market (truck-type + count, freight position captured now, transporter/vehicle/driver ' +
        'captured later at Assignment). Splits the requisition into one Load per truck; partial ' +
        'dispatch is allowed and the requisition stays open with the remainder visible.',
    ),
    request: {
      params: dispatchPlanningValidators.plan.shape.params,
      body: json(dispatchPlanningValidators.plan.shape.body),
    },
    responses: {
      201: {
        description:
          '{ requisition, loads, capacitySummary, allocationByProduct, fitVerdicts, complianceWarnings }',
      },
      400: {
        description: 'Validation failed, or a cargo mix exceeds truck capacity',
        ...errorContent,
      },
      409: {
        description:
          'Requisition not found/closed, a referenced vehicle/truck type is not usable, or a ' +
          'vehicle fails the C-01/C-02/C-03 duplicate-use checks',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/requisitions/{requisitionId}/available-vehicles`,
    tags: [TAGS.LOADS],
    operationId: 'loads.listAvailableVehicles',
    ...authenticated(
      "Vehicle picker for the own-fleet truck lines above — only status: 'active' vehicles " +
        '(never inactive/under_maintenance/pending/rejected), not on_trip, and not blocked by ' +
        'the same checks POST .../dispatch-plan enforces at submit time: "on_active_load" (on a ' +
        'live trip elsewhere, C-02) or "already_in_requisition" (already used earlier in this ' +
        'requisition, C-01b). Vehicles failing either check are excluded from the response ' +
        'entirely, not just flagged — so nothing returned here should 409 there. Paginated and ' +
        'optionally filtered further by operationalStatus/search.',
    ),
    request: {
      params: dispatchPlanningValidators.availableVehicles.shape.params,
      query: dispatchPlanningValidators.availableVehicles.shape.query,
    },
    responses: {
      200: {
        description:
          'Paginated vehicles — { data: { items: AvailableVehicleRow[], page, limit, total, totalPages } }',
      },
      404: { description: 'Requisition not found', ...errorContent },
    },
  });

  // --- Loads ---

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads`,
    tags: [TAGS.LOADS],
    operationId: 'loads.listLoads',
    ...authenticated(
      'List loads ("trips") for the tenant, paginated and optionally filtered. `group=active|' +
        'completed` is the Trips Home-page tab filter (completed = delivered + closed), mutually ' +
        "exclusive with `status`. `search` matches (case-insensitive, partial) against the load's " +
        "requisition's customer name. Each row's `route`/`customer` come from the load's " +
        'requisition; `source.label` is "Own fleet" or "Market · {transporter name}". ' +
        '`expectedRate` is the planned freight rate — market loads only, always null for ' +
        'own-fleet (the Freight column shows "Internal" for those instead). `driver` is ' +
        "the load's own snapshot from Dispatch Planning time, falling back to the vehicle's " +
        'current active primary driver-link when that snapshot is null (own-fleet loads planned ' +
        'before any driver was linked to the vehicle).',
    ),
    request: { query: loadValidators.list.shape.query },
    responses: {
      200: {
        description:
          'Paginated trips — { data: { items: TripListRow[], page, limit, total, totalPages, ' +
          'counts: { active, completed } } }. `counts` is tenant-wide (scoped by any non-group ' +
          'filters given) and independent of which group, if any, was requested — lets the UI ' +
          'render both tab badges from one call. Each row also carries `plannedCapacityTonnes`, ' +
          '`freightValue` (market-only, null until Assignment confirms a rate), `advance`/`balance` ' +
          '(`{ applicable, amount, paid, paidAt }` — `applicable`/`amount` are market-only, false/' +
          "null for own-fleet loads, same shape and computation as the detail endpoint's " +
          '`nextAction.advance`/`nextAction.balance`), and `cargoItems` (`{ productId, ' +
          'productDetails, tonnesPerTruck }[]`, the product mix this load carries).',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads/{loadId}`,
    tags: [TAGS.LOADS],
    operationId: 'loads.getLoad',
    ...authenticated(
      'Load / Trip Detail — status, assignment, documents (resolved to download URLs), ' +
        'payments, computed e-way-bill expiry, the full chronological activity timeline (now with ' +
        "each entry's actor name/role resolved), an 8-step technical progress stepper, and a " +
        'next-action panel (next stage, "step N of 4/6" — counted against the load\'s own sourcing ' +
        'strategy\'s doc lifecycle, Own Fleet 4 stages vs Market 6 including a derived "Payments" ' +
        'stage, not one shared count — plus tracking/advance-due info). This is the single trip ' +
        'detail screen — GET /loads/{loadId}/activities returns the same timeline entries alone.',
    ),
    request: { params: loadValidators.get.shape.params },
    responses: {
      200: {
        description:
          '{ load, timeline: LoadActivityWithActor[], payments, ewayBillExpiry, stepper: ' +
          'TripStepperStep[], nextAction: TripNextAction }',
      },
      404: { description: 'Load not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads/{loadId}/activities`,
    tags: [TAGS.LOADS],
    operationId: 'loads.listLoadActivities',
    ...authenticated(
      "List a load's activity timeline on its own, most recent last, with each entry's actor " +
        'name/role resolved. GET /loads/{loadId} embeds this same timeline alongside the rest of ' +
        'the trip detail screen — prefer that endpoint unless only the timeline is needed.',
    ),
    request: { params: loadValidators.getActivities.shape.params },
    responses: {
      200: { description: 'LoadActivityWithActor[], chronological' },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/assign`,
    tags: [TAGS.LOADS],
    operationId: 'loads.assignLoad',
    ...manageDispatch(
      'Load Assignment — market loads only. Own-fleet loads are assigned at Dispatch Planning ' +
        '(vehicle+driver already known there) and 409 if sent here. Requires transporterId, ' +
        'vehicleNumber/driverNumber (free text), an optional driverName, and freightType; ' +
        'freightValue defaults to the target rate captured at planning if omitted (the ' +
        'negotiation landed on the original ask).',
    ),
    request: {
      params: loadValidators.assign.shape.params,
      body: json(loadValidators.assign.shape.body),
    },
    responses: {
      200: { description: 'Updated load' },
      400: { description: 'Validation failed', ...errorContent },
      409: {
        description:
          'Load is own-fleet, is not in the "created" state, or the vehicle number is already ' +
          'on another active load elsewhere (C-07)',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/confirm-loading`,
    tags: [TAGS.LOADS],
    operationId: 'loads.confirmLoading',
    ...manageDocuments(
      'Attach invoice/e-way bill/E-LR. Documents may be submitted one at a time or all ' +
        'together — invoiceNumber+invoiceFileKey and ewayBillNumber+ewayBillFileKey must each ' +
        'arrive as a pair, elrFileKey may arrive without elrNumber, and at least one document ' +
        'must be present per call. The load stays "assigned" until all three documents are ' +
        'present (accumulated across calls or sent at once), at which point it flips to ' +
        '"loading_confirmed" and tracking/advance payment (market loads) are enabled. File keys ' +
        'must be confirmed uploads from POST /files with the matching purpose (loads/invoice, ' +
        'loads/eway-bill, trips/lr).',
    ),
    request: {
      params: loadValidators.confirmLoading.shape.params,
      body: json(loadValidators.confirmLoading.shape.body),
    },
    responses: {
      200: {
        description:
          'Document(s) saved; load remains "assigned" until all three are present, then flips ' +
          'to "loading_confirmed"',
      },
      400: {
        description: 'A file is not a confirmed upload for the expected purpose',
        ...errorContent,
      },
      409: {
        description:
          'Load is not in the "assigned" state, or the E-LR number is already used on another load (C-04)',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/status`,
    tags: [TAGS.LOADS],
    operationId: 'loads.updateLoadStatus',
    ...manageDocuments(
      'Manual tracking advance — At plant / In-transit / Reached delivery point. ' +
        'Rejects skipping ahead or moving backward.',
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
      'Record proof of delivery — the delivery receipt photo, receiver name/mobile/designation, ' +
        'quantity received and seal-on-arrival check are all required together (only podRemarks ' +
        'is optional). A broken seal never blocks — recorded on the activity/audit trail only, ' +
        'advisory pending a future exceptions/escalations module. Marks the load Delivered; ' +
        'own-fleet loads close immediately, market loads wait for the balance payment.',
    ),
    request: {
      params: loadValidators.uploadPod.shape.params,
      body: json(loadValidators.uploadPod.shape.body),
    },
    responses: {
      200: { description: 'Updated load' },
      400: { description: 'A required delivery-receipt field is missing', ...errorContent },
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
      'Record the advance payment to a market-load transporter. Amount is computed ' +
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
      'Record the balance payment. Due date is derived from the E-POD date plus the ' +
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
