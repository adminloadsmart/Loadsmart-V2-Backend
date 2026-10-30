import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { requisitionValidators } from './requisition.validators';
import { dispatchPlanningValidators } from './dispatch-planning.validators';
import { loadValidators } from './load.validators';
import { loadPaymentValidators } from './load-payment.validators';
import { loadIssueValidators } from './load-issue.validators';
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
        'one load per selected vehicle, all sharing the same cargo mix, created already "truck_assigned") ' +
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
          '{ requisition, loads, capacitySummary, allocationByProduct, fitVerdicts, complianceWarnings } ' +
          '— complianceWarnings lists expired vehicle papers (LS_N_0017); the plan still goes through.',
      },
      400: {
        description: 'Validation failed, or a cargo mix exceeds truck capacity',
        ...errorContent,
      },
      409: {
        description:
          'Requisition not found/closed, a referenced vehicle/truck type is not usable, a ' +
          'vehicle fails the C-01/C-02/C-03 duplicate-use checks, or a driver has an expired ' +
          'licence (LS_N_0017; details.reason = ' +
          '"compliance_expired" with subject, docType, expiryDate)',
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
        'completed|open|upcoming` is the tab filter (upcoming = created, bids_received and truck_assigned loads whose requisition pickupDate is today or later), mutually ' +
        'exclusive with `status`. `podStatus=pending|accepted|rejected` filters by E-POD status. ' +
        '`fromDate`/`toDate` (YYYY-MM-DD, inclusive, UTC, either optional) filter on deliveredAt ' +
        'when group=completed, otherwise on createdAt. ' +
        "`search` matches (case-insensitive, partial) against the load's " +
        "requisition's customer name. Each row's `route`/`customer` come from the load's " +
        'requisition; `source.label` is "Own fleet" or "Market · {transporter name}". ' +
        '`expectedRate` is the planned freight rate — market loads only, always null for ' +
        'own-fleet (the Freight column shows "Internal" for those instead). `driver` is ' +
        "the load's own snapshot from Dispatch Planning time (own-fleet), falling back to the " +
        "vehicle's current active primary driver-link when that snapshot is null (own-fleet " +
        'loads planned before any driver was linked to the vehicle), or to the free-text ' +
        'driverName entered at Assignment for market loads (`id: null` in that case).',
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
        "each entry's actor name/role resolved), the stage stepper for the load's own route " +
        '(market/indent: Created → Bids received → Truck assigned → In-transit for loading → ' +
        'Reached loading point → Loaded → In-transit for unloading → Reached unloading point → ' +
        'Delivered; own fleet starts at Truck assigned; Delivered with issues appears only when the ' +
        'POD noted an issue), and a next-action panel (current/next stage, "step N of M" on that ' +
        'route, plus advance/balance info). This is the single trip ' +
        'detail screen — GET /loads/{loadId}/activities returns the same timeline entries alone.',
    ),
    request: { params: loadValidators.get.shape.params },
    responses: {
      200: {
        description:
          '{ load (document fields are download URLs), ownerPhoneNumber, dispatchPhoneNumber, ' +
          'documentKeys (the same document fields as raw ' +
          'storage keys), timeline: LoadActivityWithActor[], payments, ewayBillExpiry, stepper: ' +
          'TripStepperStep[] (steps ahead of a halted trip have onHold: true), nextAction: TripNextAction, ' +
          'incident: TripIncident | null (newest unresolved driver-reported issue; halted: true for ' +
          'accident/breakdown) }',
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
      'Load Assignment — market and indent loads, from Created or Bids received; moves the load ' +
        'to Truck assigned. Own-fleet loads are assigned at Dispatch Planning ' +
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
      200: {
        description:
          'Updated load, plus complianceWarnings — expired papers on the vehicle (matched to Fleet ' +
          'Master by number); the assignment still goes through',
      },
      400: { description: 'Validation failed', ...errorContent },
      409: {
        description:
          'Load is own-fleet, is not in the "created" state, the vehicle number is already ' +
          'on another active load elsewhere (C-07), or the driver (matched by phone) has an expired ' +
          'licence ' +
          '(LS_N_0017; details.reason = "compliance_expired" with subject, docType, expiryDate)',
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
      'Attach invoice/e-way bill/E-LR (mandatory), plus optional loading photos ' +
        '(loadingPhotoFileKeys, up to 3 — back and sides of the loaded truck) and a weighing ' +
        'slip (weighingSlipFileKey). Documents may be submitted one at a time or all together — ' +
        'invoiceNumber+invoiceFileKey and ewayBillNumber+ewayBillFileKey must each arrive as a ' +
        'pair, elrFileKey may arrive without elrNumber, and at least one field must be present ' +
        'per call. Only at the loading point (Reached loading point). The load moves to Loaded as ' +
        'soon as all three MANDATORY papers are present (accumulated across calls, already on the ' +
        'load from an earlier caller, or sent at once — a document staff already attached never ' +
        'needs to be resent); advance payment (market/indent) is then enabled. The two ' +
        'non-mandatory fields never affect this. This same endpoint is also reachable by ' +
        'the assigned driver via PATCH /driver-portal/loads/{loadId}/confirm-loading. File keys ' +
        'must be confirmed uploads from POST /files with the matching purpose (loads/invoice, ' +
        'loads/eway-bill, trips/lr, loads/loading-photo, loads/weighing-slip).',
    ),
    request: {
      params: loadValidators.confirmLoading.shape.params,
      body: json(loadValidators.confirmLoading.shape.body),
    },
    responses: {
      200: {
        description:
          'Document(s) saved; load stays at Reached loading point until all three are present, ' +
          'then moves to Loaded',
      },
      400: {
        description: 'A file is not a confirmed upload for the expected purpose',
        ...errorContent,
      },
      409: {
        description:
          'Load is not at the loading point, or the E-LR number is already used on another load (C-04)',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/documents`,
    tags: [TAGS.LOADS],
    operationId: 'loads.updateDocuments',
    ...manageDocuments(
      'Attach or replace load documents (invoice/e-way bill/E-LR/loading photos/weighing slip) ' +
        'at any point in the load\'s lifecycle except once "closed" (terminal). A load at the ' +
        'loading point still moves to Loaded once this call completes the three papers. Intended for ' +
        'correcting a document after loading has already been confirmed, or attaching one that ' +
        'only arrived later. Same body shape and file-key rules (purposes, pairing, E-LR ' +
        'uniqueness) as confirm-loading. Also reachable by the assigned driver via PATCH ' +
        '/driver-portal/loads/{loadId}/documents.',
    ),
    request: {
      params: loadValidators.updateDocuments.shape.params,
      body: json(loadValidators.updateDocuments.shape.body),
    },
    responses: {
      200: {
        description: 'Document(s) saved; status unchanged unless this completed the loading papers',
      },
      400: {
        description: 'A file is not a confirmed upload for the expected purpose',
        ...errorContent,
      },
      409: {
        description:
          'Load is already "closed", or the E-LR number is already used on another load (C-04)',
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
      'Manual stage mark — `in_transit_loading` (Start trip), `reached_loading`, ' +
        '`in_transit_unloading` (left for the drop), `reached_unloading`. There is no live ' +
        'tracking yet. Rejects skipping ahead, moving backward, or a stage not on the route.',
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
      'Record proof of delivery — POD front (podFileKey), receiver name/mobile, and quantity ' +
        'received are required; POD back (podBackFileKey), receiver designation, sealStatus, ' +
        'shortageOrDamage, numberOfTonnesShort, damagePhotoKey, and podRemarks are optional. ' +
        'damagePhotoKey becomes required when shortageOrDamage is `damage`, `wet` or `both`. ' +
        'Accepted once the load is In-transit for unloading (it is marked Reached unloading point ' +
        'first) or at the unloading point. The POD decides the stage: nothing noted → Delivered ' +
        'without issues; damage, shortage, wet or pilferage → Delivered with issues, until PATCH ' +
        '/loads/{loadId}/delivery-issue/settle. podStatus becomes `pending` — closing requires ' +
        'staff to accept the E-POD via PATCH /loads/{loadId}/pod/review. Also usable to resubmit ' +
        'after a rejection (podStatus resets to `pending`).',
    ),
    request: {
      params: loadValidators.uploadPod.shape.params,
      body: json(loadValidators.uploadPod.shape.body),
    },
    responses: {
      200: { description: 'Updated load' },
      400: { description: 'A required delivery-receipt field is missing', ...errorContent },
      409: {
        description: 'The truck has not left for the unloading point yet',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/pod/review`,
    tags: [TAGS.LOADS],
    operationId: 'loads.reviewPod',
    ...manageDocuments(
      'Staff accept/reject of a pending E-POD. `reason` is required when `decision` is ' +
        '`rejected`. Accepting closes the load if it is Delivered without issues and — for market ' +
        'and indent loads — both advance and balance are paid; otherwise it closes when the last ' +
        'of those lands (issue settlement or balance payment). Rejecting leaves the stage as it ' +
        'is — the driver resubmits via PATCH /loads/{loadId}/pod, which resets podStatus back to ' +
        '`pending`.',
    ),
    request: {
      params: loadValidators.reviewPod.shape.params,
      body: json(loadValidators.reviewPod.shape.body),
    },
    responses: {
      200: { description: 'Updated load' },
      400: { description: 'reason is missing on a rejected decision', ...errorContent },
      409: { description: "This load's E-POD is not pending review", ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/loading-contact`,
    tags: [TAGS.LOADS],
    operationId: 'loads.setLoadingContact',
    ...manageDispatch(
      'Who meets the truck at the loading point, for this load only — shared with the driver and ' +
        'used by the next load memo. Allowed until the truck reaches the loading point.',
    ),
    request: {
      params: loadValidators.setLoadingContact.shape.params,
      body: json(loadValidators.setLoadingContact.shape.body),
    },
    responses: {
      200: { description: 'Updated load' },
      409: { description: 'The truck is already at the loading point', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/loading-point`,
    tags: [TAGS.LOADS],
    operationId: 'loads.setLoadingPoint',
    ...manageDispatch(
      'Switch this load to another saved, active loading point (the requisition/posting keep ' +
        "theirs). Clears a changed loading contact so the new point's own contact applies. " +
        'Allowed until the truck reaches the loading point.',
    ),
    request: {
      params: loadValidators.setLoadingPoint.shape.params,
      body: json(loadValidators.setLoadingPoint.shape.body),
    },
    responses: {
      200: { description: 'Updated load' },
      404: { description: 'Loading point not found', ...errorContent },
      409: {
        description: 'The truck is already at the loading point, or the point is not active',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/elr`,
    tags: [TAGS.LOADS],
    operationId: 'loads.generateElr',
    ...manageDocuments(
      'Make the e-LR at the loading point (Reached loading point or Loaded). The invoice is ' +
        'required — uploaded (invoice number + file on the load), or typed with ' +
        '`invoiceNumber`, `invoiceDate` and `invoiceValue` (own fleet may). The shipper adds ' +
        '`packages` and `sealNumber`; the rest fills in from the load. Freight is hidden unless ' +
        '`showFreight` is true. Assigns the next LR-nnnn number (kept on regeneration), stores ' +
        'the PDF (purpose trips/lr) in `elrDocumentFileKey`, and returns a download URL. The ' +
        'signed LR the driver brings back is still uploaded separately and completes the ' +
        'loading papers.',
    ),
    request: {
      params: loadValidators.generateElr.shape.params,
      body: json(loadValidators.generateElr.shape.body),
    },
    responses: {
      201: { description: '{ load, elrNumber, downloadUrl }' },
      400: { description: 'No invoice on the load and none typed', ...errorContent },
      409: { description: 'Not at the loading point', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/delivery-issue/settle`,
    tags: [TAGS.LOADS],
    operationId: 'loads.settleDeliveryIssue',
    ...manageDocuments(
      'Delivered with issues → Delivered without issues, once the damage, shortage or pilferage ' +
        'noted on the POD has been settled (own fleet: handled internally; market/indent: with ' +
        'the transporter). `note` records how. Closes the load if the E-POD is accepted and — for ' +
        'market and indent loads — both payments are recorded.',
    ),
    request: {
      params: loadValidators.settleDeliveryIssue.shape.params,
      body: json(loadValidators.settleDeliveryIssue.shape.body),
    },
    responses: {
      200: { description: 'Updated load' },
      409: { description: 'The load is not Delivered with issues', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads/{loadId}/issues`,
    tags: [TAGS.LOADS],
    operationId: 'loads.listLoadIssues',
    ...authenticated(
      'List "Report An Issue" entries a driver has filed against this load (breakdown, halt, ' +
        'accident, etc.), most recent first. Read-only — the driver-app POST lives at ' +
        'POST /driver-portal/loads/{loadId}/issues, not here. Not actionable/escalated ' +
        'automatically; each entry also has a matching ISSUE_REPORTED row on the activity ' +
        'timeline (GET /loads/{loadId}/activities).',
    ),
    request: { params: loadIssueValidators.list.shape.params },
    responses: {
      200: { description: 'LoadIssueReportEntity[], most recent first' },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/issues/{issueId}/resolve`,
    tags: [TAGS.LOADS],
    operationId: 'loads.resolveLoadIssue',
    ...authenticated(
      'Mark a driver-reported issue resolved. Releases the hold if it was an accident or breakdown.',
    ),
    request: { params: loadIssueValidators.resolve.shape.params },
    responses: {
      200: { description: 'The resolved LoadIssueReportEntity' },
      404: { description: 'Load or open issue not found', ...errorContent },
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
