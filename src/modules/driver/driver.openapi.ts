import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { driverValidators } from './driver.validators';
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

const BASE = `${API_VERSION_PREFIX}/masters`; // absolute path — must match its mount in app.ts
const write = (description: string) => permissionGated([MASTERS_WRITE], description);
const approve = (description: string) => permissionGated([MASTERS_APPROVE], description);

export function registerDriverOpenApi(registry: OpenAPIRegistry): void {
  // --- Drivers ---

  registry.registerPath({
    method: 'get',
    path: `${BASE}/drivers`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listDrivers',
    ...authenticated(
      'My Drivers roster, paginated and optionally filtered. `search` matches name, mobile or DL ' +
        'number; "Invitations Sent" = status=pending_driver_review&initiatedBy=fleet_owner. ' +
        '`segment` picks an Active Roster tab (all, on_trip, available, not_available, ' +
        'left_company, licence_expired, hazmat_endorsed, not_verified); every segment but ' +
        'left_company excludes drivers who left, and on_trip/available use the live active-load ' +
        'check. Each row adds `licence`, `contact`, `assignment`, `availability`, `performance` ' +
        'and `behaviour`, shaped as on GET /drivers/{driverId} (driverScore and behaviour are ' +
        'null until backed by data). not_available = on_leave or medically_unfit; ' +
        "hazmat_endorsed = 'hazmat' in licenseEndorsements.",
    ),
    request: { query: driverValidators.listDrivers.shape.query },
    responses: {
      200: {
        description:
          'Paginated drivers — { data: { items, page, limit, total, totalPages, counts } }, ' +
          'counts = { total, all, on_trip, available, not_available, left_company, ' +
          'licence_expired, hazmat_endorsed, not_verified } under the same filters minus segment.',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/drivers/{driverId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getDriver',
    ...authenticated(
      'Driver detail screen in one call — the driver (documents, verifications, bank details, ' +
        'linked vehicles) plus screen sections: `licence` { number, classOfVehicle, endorsements, ' +
        'validTo, daysLeft, registry, eligibleToDrive }, `contact` { primaryMobile, bloodGroup, ' +
        'emergencyContact, engagementType, dateOfJoining, tenureYears, advanceOutstanding, ' +
        'compensation { salaryType, salaryAmount, bhattaPerDay } }, `assignment` { vehicle, ' +
        'homeBase }, `availability` { operationalStatus, activeLoad, dispatchable }, ' +
        '`performance` { totalTrips, onTimePercentage, driverScore }, `knownLanes`, `behaviour`, ' +
        '`slaBreachTrips`. Not yet backed by data, so always null/[] for now: driverScore, ' +
        'knownLanes ' +
        '({ from, to, laneType, distanceKm }[]), behaviour ({ event, per1000Km, ' +
        'fleetComparison }[]), slaBreachTrips ({ loadId, code, status, from, to, date, ' +
        'progressPercentage }[]).',
    ),
    request: { params: driverValidators.getDriver.shape.params },
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
    ...write(
      'Update one or more fields on a driver, including `emergencyContactRelation`, ' +
        '`engagementType` (on_roll | per_trip | vendor — how they are employed, separate from ' +
        '`salaryType`), `bhattaPerDay` (daily trip allowance), `advanceOutstanding` ' +
        '(hand-entered balance), `homeBase` (yard, free text) and `licenseEndorsements` ' +
        "(e.g. ['hazmat']; replaces the whole list).",
    ),
    request: {
      params: driverValidators.updateDriver.shape.params,
      body: json(driverValidators.updateDriver.shape.body),
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
    request: { params: driverValidators.deleteDriver.shape.params },
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
    request: { params: driverValidators.approveDriver.shape.params },
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
    ...approve('Reject a pending driver, with an optional reason. org_admin only.'),
    request: {
      params: driverValidators.rejectDriver.shape.params,
      body: json(driverValidators.rejectDriver.shape.body),
    },
    responses: {
      200: { description: 'Rejected driver' },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Driver not found', ...errorContent },
      409: { description: 'Driver is not pending', ...errorContent },
    },
  });

  // --- Driver account linking (multi-tenant) ---
  // A driver profile is global (masters.drivers has no tenantId) and can be linked, with mutual
  // approval, to more than one tenant at once — see driver-tenant-relation.entity.ts. These two
  // endpoints are the tenant-side half of that workflow; the driver-side half (accept/reject an
  // invite, request to join a tenant) lives under TAGS.DRIVER_AUTH's /relations/* — see
  // driver-auth.openapi.ts.

  registry.registerPath({
    method: 'get',
    path: `${BASE}/drivers/join-requests`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listDriverJoinRequests',
    ...authenticated(
      'List driver-initiated join requests awaiting this tenant’s approval (status ' +
        '`pending_staff_review`, initiatedBy `driver`) — distinct from dispatch-added drivers ' +
        'awaiting approval, which surface via GET /drivers?status=pending_staff_review instead. ' +
        'Approve/reject reuse PATCH /drivers/{driverId}/approve|reject above. `search` matches ' +
        'name, mobile or DL number. Each item carries `requestedAt` (when the request was made) ' +
        'and `licenseClass` (latest licence verification’s class, or null).',
    ),
    request: { query: driverValidators.listJoinRequests.shape.query },
    responses: {
      200: {
        description:
          'Paginated join requests — { data: { items, page, limit, total, totalPages } }',
      },
    },
  });

  // --- Invitations Sent ---

  registry.registerPath({
    method: 'get',
    path: `${BASE}/drivers/invitations`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.listDriverInvitations',
    ...authenticated(
      'List invites this tenant sent to drivers (org_admin onboarding, or dispatch-added drivers ' +
        'after approval), newest `sentAt` first. `status` is derived: `pending` (awaiting the ' +
        'driver, not expired), `expired` (unanswered 7 days after the last send), `accepted`, ' +
        '`rejected` (declined by the driver). `search` matches name, mobile or DL number. Items: ' +
        '{ invitationId, requestId (INV-00042), driverId, fullName, phoneNumber, status, sentAt, ' +
        'expiresAt, respondedAt, rejectionReason }.',
    ),
    request: { query: driverValidators.listInvitations.shape.query },
    responses: {
      200: {
        description: 'Paginated invitations — { data: { items, page, limit, total, totalPages } }',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/drivers/invitations/{invitationId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.getDriverInvitation',
    ...authenticated(
      'Invitation detail drawer — the list item plus `credentials` { licenseNumber, ' +
        'licenseClass, registry: { source: sarathi, status, checkedAt } | null }, `timeline` for ' +
        'the latest send (sent { at, by: { name, role } } → viewed { at, device }, once the ' +
        'driver opened the invite notification → accepted | rejected | expired | ' +
        'awaiting_response) and `deliveryChannels` [{ channel: sms | whatsapp | push, status, ' +
        'statusAt }]. SMS/WhatsApp are recorded as `pending` but not yet actually sent.',
    ),
    request: { params: driverValidators.getInvitation.shape.params },
    responses: {
      200: { description: 'Invitation detail' },
      404: { description: 'Invitation not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/drivers/invitations/{invitationId}/resend`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.resendDriverInvitation',
    ...write(
      'Re-send a pending, unexpired invite: re-notifies the driver, restarts the 7-day expiry, ' +
        'resets the viewed step and every delivery channel to `pending`. Req ID is unchanged.',
    ),
    request: { params: driverValidators.resendInvitation.shape.params },
    responses: {
      200: { description: 'Updated invitation (same item shape as the list)' },
      404: { description: 'Invitation not found', ...errorContent },
      409: { description: 'Invitation is not pending, or it has expired', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/drivers/invitations/{invitationId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.cancelDriverInvitation',
    ...write(
      'Cancel a pending invite. It disappears from this list and the driver app, and the driver ' +
        'can be invited again.',
    ),
    request: { params: driverValidators.cancelInvitation.shape.params },
    responses: {
      200: { description: '{ data: { success: true } }' },
      404: { description: 'Invitation not found', ...errorContent },
      409: { description: 'Invitation is not pending', ...errorContent },
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
      params: driverValidators.addDriverDocument.shape.params,
      body: json(driverValidators.addDriverDocument.shape.body),
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
    request: { params: driverValidators.listDriverDocuments.shape.params },
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
    request: { params: driverValidators.deleteDriverDocument.shape.params },
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
      params: driverValidators.recordDriverVerification.shape.params,
      body: json(driverValidators.recordDriverVerification.shape.body),
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
    request: { params: driverValidators.listDriverVerifications.shape.params },
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
      params: driverValidators.addDriverBankDetails.shape.params,
      body: json(driverValidators.addDriverBankDetails.shape.body),
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
    request: { params: driverValidators.listDriverBankDetails.shape.params },
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
      params: driverValidators.setDriverBankDetailsVerification.shape.params,
      body: json(driverValidators.setDriverBankDetailsVerification.shape.body),
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
    request: { params: driverValidators.deleteDriverBankDetails.shape.params },
    responses: {
      200: { description: 'Deleted', ...json(SuccessResponseSchema) },
      404: { description: 'Bank details not found', ...errorContent },
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
        'reports no match. Revert to manual_review on those paths once IDfy credits are restored. ' +
        '`validUntil` is the transport validity when the licence has one, else the non-transport ' +
        'validity.',
    ),
    request: { body: json(driverValidators.verifyDriverDl.shape.body) },
    responses: {
      200: { description: 'verified (with registry fields when available)' },
      400: { description: 'Validation failed', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/drivers/verify-bank-account`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.verifyDriverBankAccount',
    ...write(
      'Check a bank account number + IFSC against IDfy (penny-less first, then penny drop) ' +
        'before the bank details exist. Submits an async IDfy task and polls for the result ' +
        'before responding. Returns verificationStatus verified | rejected | pending (pending = ' +
        'no verdict: IDfy unconfigured/out of credits/timed out). Nothing is saved — adding the ' +
        'bank details (POST /drivers/onboard or /drivers/{driverId}/bank-details) re-runs the ' +
        'check server-side and stores that result.',
    ),
    request: { body: json(driverValidators.verifyDriverBankAccount.shape.body) },
    responses: {
      200: { description: '{ verificationStatus, nameAtBank?, sourceReference?, rawResponse? }' },
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
        'approves or rejects it via PATCH .../approve|reject. Also takes `emergencyContactRelation`, ' +
        '`engagementType` (on_roll | per_trip | vendor), `bhattaPerDay`, `advanceOutstanding`, ' +
        '`homeBase` and `licenseEndorsements`.',
    ),
    request: { body: json(driverValidators.onboardDriver.shape.body) },
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
    request: { params: driverValidators.getDriverOperationalStatus.shape.params },
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
      params: driverValidators.setDriverOperationalStatus.shape.params,
      body: json(driverValidators.setDriverOperationalStatus.shape.body),
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
      params: driverValidators.recordDriverTripMetrics.shape.params,
      body: json(driverValidators.recordDriverTripMetrics.shape.body),
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
    request: { params: driverValidators.listDriverTripMetrics.shape.params },
    responses: {
      200: { description: 'Trip metrics' },
      404: { description: 'Driver not found', ...errorContent },
    },
  });
}
