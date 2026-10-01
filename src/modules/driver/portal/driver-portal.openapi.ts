import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { driverPortalValidators } from './driver-portal.validators';
import { API_VERSION_PREFIX } from '../../../shared/constants/api';
import { TAGS, authenticated, errorContent, json } from '../../../shared/openapi/core';

const BASE = `${API_VERSION_PREFIX}/driver-portal`; // absolute path — must match its mount in app.ts

// Driver-app self-service only — every path is implicitly scoped to the caller's own driver
// record (no :driverId anywhere), authenticated with a driver-access token, never the staff/org
// bearer token TAGS.AUTH documents. See docs/driver-auth.md.
export function registerDriverPortalOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/me`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.getMe',
    ...authenticated(
      'Profile screen. Also reachable with an identity-access token (no active tenant relation ' +
        'required) for a driver who hasn’t linked to a fleet owner yet — in that case the response ' +
        'is just the global driver profile (documents, verifications, bankDetails), with none of ' +
        'the tenant-aggregated fields below. Once linked, this becomes the same full ' +
        'driver record as the staff GET /masters/drivers/{driverId} (documents, verifications, ' +
        'bankDetails, vehicleLinks, etc., unchanged), plus assigned vehicle compliance dates ' +
        '(insurance/fitness expiry), a document upload-status summary, trip-metric performance, ' +
        'and the organization’s name. Fields with no backing data in this build (experience, KMs ' +
        'driven, settlement due, and every entry under settings) come back as explicit null, not ' +
        'omitted.',
    ),
    responses: {
      200: {
        description:
          'DriverProfileView (tenant-linked) or the bare DriverEntity with documents/' +
          'verifications/bankDetails (not yet linked to any tenant) — see driver.service.ts',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/me/status`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.getMyStatus',
    ...authenticated(
      'Get the caller’s own live operational status. Also reachable with an identity-access ' +
        'token (no active tenant relation required) — returns null in that case, since a driver ' +
        'not linked to any tenant has no operational status anywhere.',
    ),
    responses: {
      200: { description: 'Operational status, or null when not linked to any tenant' },
      404: { description: 'No operational status yet', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/me/status`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.updateMyStatus',
    ...authenticated(
      'Set the caller’s own operational status — the same DriverService code path staff use, invoked by the driver on themselves.',
    ),
    request: { body: json(driverPortalValidators.updateMyStatus.shape.body) },
    responses: { 200: { description: 'Updated operational status' } },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/me/bank-details/verify`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.verifyMyBankAccount',
    ...authenticated(
      'Bank-account preflight, like the licence check — verifies an account number + IFSC ' +
        'against IDfy (penny-less, then penny drop), polling IDfy in the request. Returns ' +
        'verificationStatus verified | rejected | pending (no verdict) and nameAtBank. Nothing ' +
        'is saved. Works with an identity-access token (no tenant relation needed).',
    ),
    request: { body: json(driverPortalValidators.verifyMyBankAccount.shape.body) },
    responses: {
      200: { description: '{ verificationStatus, nameAtBank?, sourceReference?, rawResponse? }' },
      400: { description: 'Validation failed', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/me/bank-details`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.addMyBankDetails',
    ...authenticated(
      'Add the caller’s own bank account. The IDfy check is re-run server-side and its result ' +
        'stored (verificationStatus verified | rejected | pending, plus nameAtBank) — the client ' +
        'cannot supply it. Call POST /me/bank-details/verify first to show the result before saving.',
    ),
    request: { body: json(driverPortalValidators.addMyBankDetails.shape.body) },
    responses: {
      201: { description: 'Created bank details, with the verification outcome' },
      409: { description: 'Account already on file', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/me/bank-details`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.listMyBankDetails',
    ...authenticated('List the caller’s own bank accounts with their verification status.'),
    responses: { 200: { description: 'Bank details' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/me/trip-metrics`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.getMyTripMetrics',
    ...authenticated(
      'List the caller’s own trip metrics by reporting period. Read-only — these are ' +
        'ops-computed KPIs, not driver-editable. Also reachable with an identity-access token ' +
        '(no active tenant relation required) — returns an empty array in that case.',
    ),
    responses: {
      200: { description: 'Trip metrics by period, or [] when not linked to any tenant' },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/me/loads`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.getMyLoads',
    ...authenticated(
      'List loads assigned to the caller, paginated. `group=open` is the "Open Trips" tab — ' +
        'every status except closed, including a delivered load whose E-POD is still pending or ' +
        'was rejected (podStatus/podRejectionReason are included per item so the app can route a ' +
        'rejected one back to re-upload). Also reachable with an identity-access token (no ' +
        'active tenant relation required) — returns an empty page in that case, since a driver ' +
        'with no active relation cannot be assigned to any load in any tenant.',
    ),
    request: { query: driverPortalValidators.listMyLoads.shape.query },
    responses: {
      200: {
        description:
          'Paginated loads — { data: { items, page, limit, total, totalPages } }, items empty when not linked to any tenant',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/me/trips-done`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.getMyTripsDone',
    ...authenticated(
      'Trips Done screen — a dedicated, always-completed-only view of the caller’s own trip ' +
        'history, separate from GET /me/loads (which serves any status/group). Also reachable ' +
        'with an identity-access token (no active tenant relation required) — returns a zeroed/' +
        'empty result in that case. Per-trip amount/paid and distance are not included yet — ' +
        'own-fleet loads (what every driver-app caller has) carry no driver-payout amount ' +
        'anywhere in this build, and there’s no distance-capture point wired up yet either; both ' +
        'are follow-up work.',
    ),
    request: { query: driverPortalValidators.getMyTripsDone.shape.query },
    responses: {
      200: {
        description:
          '{ data: { items, page, limit, total, totalPages, totalTrips, epodVerifiedPercentage } }',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/me/home`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.getMyHome',
    ...authenticated(
      'Home screen — one call bundling driver name/vehicle number, on-time %/trips-done/open-' +
        'trips stats, the current active job (first of GET /me/loads?group=active), the ' +
        'upcoming-jobs list (GET /me/loads?status=assigned, first 5), and the unread ' +
        "notification count. stats.openTrips (GET /me/loads?group=open's total) counts loads " +
        'not yet closed, including a delivered load pending or rejected E-POD review — it can ' +
        'overlap with stats.tripsDone, which answers a different question (completed-only, ' +
        'always the "Trips Done" tab). Also reachable with an identity-access token (no active ' +
        'tenant relation required) — driver name and unreadNotificationCount still populate in ' +
        'that case, but stats/currentJob/upcomingJobs come back zeroed/empty. Settlement Due, ' +
        'per-trip Distance, and a driver Score/Rating are deliberately not included — no backing ' +
        'data exists for any of them yet.',
    ),
    responses: {
      200: {
        description:
          '{ data: { driver: { fullName, vehicleNumber }, stats: { tripsDone, onTimePercentage, ' +
          'openTrips }, currentJob: TripListRow | null, upcomingJobs: TripListRow[], ' +
          'unreadNotificationCount } }',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/me/notifications`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.getMyNotifications',
    ...authenticated(
      'Notifications screen — the caller’s own notification feed, spanning every tenant they’ve ' +
        'ever had a relation with (active, pending, or rejected) in one unified inbox, not scoped ' +
        'to one tenant at a time the way staff’s GET /notifications is. `category` filters by the ' +
        '`driver.<category>.*` type-prefix convention (jobs/documents/settlements/account) — a ' +
        'client-facing shorthand, not a stored column. Each item may carry `metadata.actionLabel` ' +
        '+ `metadata.actionRoute` (the "→ Job Detail" style button) and `metadata.tag` + ' +
        "`metadata.tagVariant` ('default' | 'warning' | 'success' — the right-side status " +
        'chip, e.g. "Action required", "Resolved") when the producer set them; both are optional, ' +
        'producer-defined fields on the existing jsonb `metadata` column, not new schema.',
    ),
    request: { query: driverPortalValidators.getMyNotifications.shape.query },
    responses: {
      200: {
        description:
          'Paginated notifications — { data: { items, page, limit, total, totalPages } }',
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/me/notifications/{notificationId}/read`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.markMyNotificationRead',
    ...authenticated('Mark one of the caller’s own notifications read. Idempotent.'),
    request: { params: driverPortalValidators.markMyNotificationRead.shape.params },
    responses: {
      200: { description: 'The updated notification' },
      404: { description: 'Notification not found, or not the caller’s own', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/me/notifications/mark-all-read`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.markAllMyNotificationsRead',
    ...authenticated(
      'Mark every one of the caller’s own currently-unread notifications read in one call — ' +
        'backs the Notifications screen’s "Mark all read" action.',
    ),
    responses: {
      200: { description: '{ markedCount } — how many notifications were just flipped to read' },
    },
  });

  // --- Self-service load actions — :loadId is client-supplied here, unlike every path above;
  // ownership (the load must actually be assigned to the caller) is enforced in LoadService, not
  // documented as a distinct auth tier since it's a 404, not a 401/403. Same
  // LoadService.get/updateStatus/uploadPod the staff-facing loads.openapi.ts documents under
  // GET /loads/{loadId} and PATCH /loads/{loadId}/status and /pod. ---

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads/{loadId}`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.getMyLoad',
    ...authenticated(
      'Load / Trip Detail for a load assigned to the caller — same shape as the staff ' +
        'GET /loads/{loadId}: status, documents (resolved to download URLs), payments, computed ' +
        'e-way-bill expiry, the full activity timeline, the 8-step progress stepper, and the ' +
        'next-action panel.',
    ),
    request: { params: driverPortalValidators.getMyLoad.shape.params },
    responses: {
      200: {
        description:
          '{ load, timeline: LoadActivityWithActor[], payments, ewayBillExpiry, stepper: ' +
          'TripStepperStep[], nextAction: TripNextAction }',
      },
      404: { description: 'Load not found, or not assigned to the caller', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/loads/{loadId}/trip-detail`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.getMyTripDetail',
    ...authenticated(
      'Trip Done detail — the "Trips Done" list’s per-item drill-down. A lean, single-pickup/' +
        'single-drop summary of a completed trip’s receipt (vehicle, cargo, planned vs. received ' +
        'tonnage, pickup/drop addresses and timestamps, seal/shortage/damage status). Distinct ' +
        'from GET /loads/{loadId} above, whose payments/stepper/nextAction are staff planning ' +
        'concepts that don’t apply once a trip is closed. Today’s data model is one requisition ' +
        '= one delivery point per load, so this returns exactly one `drop`, not multiple stops.',
    ),
    request: { params: driverPortalValidators.getMyTripDetail.shape.params },
    responses: {
      200: {
        description:
          '{ id, code, status, isClosed, vehicleNumber, vehicle, cargoSummary, cargoItems, ' +
          'plannedCapacityTonnes, podQuantityReceived, pickup, drop, closedAt }',
      },
      404: { description: 'Load not found, or not assigned to the caller', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/confirm-loading`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.confirmMyLoading',
    ...authenticated(
      'Attach invoice/e-way bill/E-LR (mandatory) and confirm loading for a load assigned to ' +
        'the caller — same rules as the staff PATCH /loads/{loadId}/confirm-loading. A document ' +
        'staff already attached never needs to be resent: the load only stays "assigned" while ' +
        'any of the three mandatory documents are genuinely still missing from the row. Also ' +
        'accepts two non-mandatory fields that never affect that flip: loadingPhotoFileKeys (up ' +
        'to 3 photos of the loaded truck, back and sides) and weighingSlipFileKey. File keys must ' +
        'be confirmed uploads from POST /driver-portal/files with the matching purpose ' +
        '(loads/invoice, loads/eway-bill, trips/lr, loads/loading-photo, loads/weighing-slip).',
    ),
    request: {
      params: driverPortalValidators.confirmMyLoading.shape.params,
      body: json(driverPortalValidators.confirmMyLoading.shape.body),
    },
    responses: {
      200: {
        description:
          'Document(s) saved; load remains "assigned" until all three mandatory documents are ' +
          'present, then flips to "loading_confirmed"',
      },
      400: {
        description: 'A file is not a confirmed upload for the expected purpose',
        ...errorContent,
      },
      404: { description: 'Load not found, or not assigned to the caller', ...errorContent },
      409: {
        description:
          'Load is not in the "assigned" state, or the E-LR number is already used on another load (C-04)',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/documents`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.updateMyDocuments',
    ...authenticated(
      'Attach or replace documents on a load assigned to the caller, with no status-transition ' +
        'side effects — unlike PATCH /driver-portal/loads/{loadId}/confirm-loading, this never ' +
        "checks completeness and never flips the load's status. Usable at any point in the " +
        'load\'s lifecycle except once "closed"; intended for correcting a document after loading ' +
        'has already been confirmed, or attaching one that only arrived later. Same body shape ' +
        'and file-key rules as confirm-loading.',
    ),
    request: {
      params: driverPortalValidators.updateMyDocuments.shape.params,
      body: json(driverPortalValidators.updateMyDocuments.shape.body),
    },
    responses: {
      200: { description: 'Document(s) saved; load status is unchanged' },
      400: {
        description: 'A file is not a confirmed upload for the expected purpose',
        ...errorContent,
      },
      404: { description: 'Load not found, or not assigned to the caller', ...errorContent },
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
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.updateMyLoadStatus',
    ...authenticated(
      'Manual tracking advance — At plant / In-transit / Reached delivery point — for a load ' +
        'assigned to the caller. Same rules as the staff PATCH /loads/{loadId}/status: one hop ' +
        'at a time, rejects skipping ahead or moving backward.',
    ),
    request: {
      params: driverPortalValidators.updateMyLoadStatus.shape.params,
      body: json(driverPortalValidators.updateMyLoadStatus.shape.body),
    },
    responses: {
      200: { description: 'Updated load' },
      404: { description: 'Load not found, or not assigned to the caller', ...errorContent },
      409: { description: "toStatus is not the load's next valid status", ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/loads/{loadId}/pod`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.uploadMyPod',
    ...authenticated(
      'Record proof of delivery for a load assigned to the caller — same fields and rules as ' +
        'the staff PATCH /loads/{loadId}/pod: delivery receipt photo, receiver name/mobile, and ' +
        'quantity received are required; receiver designation and sealStatus are optional (not ' +
        'collected by the ePOD screen, kept for other callers). shortageOrDamage ' +
        '(none/shortage/damage/both) captures cargo condition on arrival — numberOfTonnesShort ' +
        'is accepted whenever shortageOrDamage is sent, and damagePhotoKey becomes required when ' +
        'shortageOrDamage is `damage` or `both`. podFileKey and damagePhotoKey must both be ' +
        'confirmed uploads from POST /driver-portal/files with purpose trips/pod. Marks the load ' +
        'Delivered; own-fleet loads (the only kind reachable here) close immediately.',
    ),
    request: {
      params: driverPortalValidators.uploadMyPod.shape.params,
      body: json(driverPortalValidators.uploadMyPod.shape.body),
    },
    responses: {
      200: { description: 'Updated load' },
      400: { description: 'A required delivery-receipt field is missing', ...errorContent },
      404: { description: 'Load not found, or not assigned to the caller', ...errorContent },
      409: { description: 'Loading has not been confirmed yet', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/loads/{loadId}/issues`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.reportMyIssue',
    ...authenticated(
      '"Report An Issue" — flag a problem (breakdown, halt/rest stop, traffic jam, accident, ' +
        'road blocked, police/RTO check, or other) on a load assigned to the caller. Location ' +
        '(latitude/longitude/locationLabel/locationCapturedAt) is captured client-side — the ' +
        "driver app resolves the address itself, the backend just stores what it's given. " +
        'photoFileKeys, if given, must be confirmed uploads from POST /driver-portal/files with ' +
        "purpose loads/issue. Visible to staff via GET /loads/{loadId}/issues and on the load's " +
        'activity timeline; not actionable/escalated automatically.',
    ),
    request: {
      params: driverPortalValidators.reportMyIssue.shape.params,
      body: json(driverPortalValidators.reportMyIssue.shape.body),
    },
    responses: {
      201: { description: 'Created issue report' },
      400: { description: 'A photo key is not a confirmed loads/issue upload', ...errorContent },
      404: { description: 'Load not found, or not assigned to the caller', ...errorContent },
      409: { description: 'Load is already delivered/closed', ...errorContent },
    },
  });

  // --- Upload handshake for POD and issue-report photos — a driver-portal-scoped mirror of
  // POST /files / POST /files/{fileId}/confirm (storage.openapi.ts), unreachable by a driver
  // token since those sit behind the staff-only authMiddleware/requirePermission. Locked to the
  // trips/pod and loads/issue purposes only. ---

  registry.registerPath({
    method: 'post',
    path: `${BASE}/files`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.requestUploadUrl',
    ...authenticated(
      'Create a pending file record and return a presigned S3 POST for the driver app to upload ' +
        'a photo directly to. purpose must be "trips/pod" (E-POD) or "loads/issue" (issue-report ' +
        'photo) — this route accepts no other storage purpose.',
    ),
    request: { body: json(driverPortalValidators.requestUploadUrl.shape.body) },
    responses: {
      201: { description: 'Pending file record plus presigned upload URL/fields' },
      400: { description: 'Validation failed', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/files/{fileId}/confirm`,
    tags: [TAGS.DRIVER_PORTAL],
    operationId: 'driverPortal.confirmUpload',
    ...authenticated(
      "Confirm a presigned upload actually landed in S3 and flip the file's status to " +
        'confirmed. The resulting key is what gets passed as podFileKey to ' +
        'PATCH /driver-portal/loads/{loadId}/pod, or as one of photoFileKeys to ' +
        'POST /driver-portal/loads/{loadId}/issues.',
    ),
    request: { params: driverPortalValidators.confirmUpload.shape.params },
    responses: {
      200: { description: 'Confirmed file record' },
      404: { description: 'File not found', ...errorContent },
      409: { description: 'Upload was never completed in S3', ...errorContent },
    },
  });
}
