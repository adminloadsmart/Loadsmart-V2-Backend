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
      'My Drivers roster, paginated and optionally filtered. `status` defaults to `active` — ' +
        'drivers who joined, including those who left (operationalStatus `inactive`); pass a ' +
        'link status (e.g. pending_staff_review) for just those, or `all` for every status. ' +
        'total/totalPages follow the same filter. `search` matches name, mobile or DL ' +
        'number; "Invitations Sent" = status=pending_driver_review&initiatedBy=fleet_owner. ' +
        '`segment` picks an Active Roster tab (all, on_trip, available, not_available, ' +
        'left_company, licence_expired, hazmat_endorsed, not_verified); every segment but ' +
        'left_company excludes drivers who left, and on_trip/available use the live active-load ' +
        'check. Each row adds `licence`, `contact`, `assignment`, `availability`, `performance` ' +
        'and `behaviour`, plus `appInstalled`/`appLastSeenAt`, shaped as on GET ' +
        '/drivers/{driverId} (driverScore and behaviour are null until backed by data). ' +
        'not_available = on_leave or medically_unfit; ' +
        "hazmat_endorsed = 'hazmat' in licenseEndorsements. Filter panel (lists are " +
        'comma-separated, OR within a list, AND across keys; also narrows every count): ' +
        "`employmentType` fixed | per_trip | per_km | vendor (a vendor's driver only matches " +
        'vendor); `licenceValidity` valid (>30 days left) | expiring (0-30) | expired; ' +
        '`licenceClass` HTV | HMV | HGMV (latest Sarathi check, whole codes); `hazmatEndorsed` ' +
        'true | false; `scoreStatus` new | strong | watch (every driver is `new` until scoring ' +
        'exists); `appInstalled` true | false (has ever logged into the driver app).',
    ),
    request: { query: driverValidators.listDrivers.shape.query },
    responses: {
      200: {
        description:
          'Paginated drivers — { data: { items, page, limit, total, totalPages, counts } }, ' +
          'counts = { total, all, on_trip, available, not_available, left_company, ' +
          'licence_expired, hazmat_endorsed, not_verified } under the same search and ' +
          'filter-panel settings as the list (only `segment` is ignored, and `status` — counts ' +
          'always cover the roster).',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/drivers/export`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.exportDrivers',
    ...authenticated(
      'Download the Active Roster as an Excel file (.xlsx) — every driver who joined, including ' +
        'those who left the company; pending and declined links are never included. Optionally ' +
        'filtered like GET /drivers (search, segment, filter panel); no paging. One column per ' +
        'field of the driver detail screen — profile (name, mobile, date of birth, address), ' +
        'licence credentials (number, class, endorsements, validity, days left, Sarathi ' +
        'verification and check date, eligible to drive), contact & engagement (blood group, ' +
        'emergency contact, engagement, joining date, tenure, pay, bhatta, advance outstanding), ' +
        'assignment (vehicle, truck type, home base), availability (status, reason, ' +
        'current load), performance (trips, on-time %, score), driver app (installed, last ' +
        'seen) and the fleet note. Bank details, insurance answers and documents are not included. ' +
        'Up to 5000 drivers.',
    ),
    request: { query: driverValidators.exportDrivers.shape.query },
    responses: {
      200: { description: 'Excel file (.xlsx) attachment' },
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
        'validTo, daysLeft, registry, eligibleToDrive, transportClasses [{ code, label }] (e.g. HTV · ' +
        'Heavy Transport Vehicle), dateOfBirth, age, issuingRtoCode (e.g. HR55 — from the licence ' +
        'number; the RTO name is not available) }, `contact` { primaryMobile, bloodGroup, ' +
        'emergencyContact, engagementType, dateOfJoining (staff-entered, else the date this fleet ' +
        'approved the driver), dateOfJoiningSource (entered | approved | null), tenureYears, ' +
        'advanceOutstanding, ' +
        'compensation { salaryType, salaryAmount, bhattaPerDay } }, `assignment` { vehicle, ' +
        'homeBase }, `availability` { activeLoad, dispatchable, notDispatchableReason (not_active | ' +
        'on_load | on_leave | medically_unfit | no_longer_with_us | null), companyStatus, ' +
        'availableFrom ("fit to drive again from"), statusNote }, `appDevice` { deviceType, ' +
        'deviceInfo } | null (the phone the driver last used the app on), `teamNote` { text, ' +
        'updatedAt, updatedBy { id, name } } | null (the fleet note card; author null for notes ' +
        'saved before it was recorded), ' +
        '`performance` { totalTrips, onTimePercentage, driverScore, scoreStatus }, `knownLanes`, ' +
        '`behaviour`, `slaBreachTrips`. `scoreStatus` (new | strong | watch) is the score badge — ' +
        '`new` until the driver has 5 trips and a score, so a just-added driver is neutral. ' +
        '`appInstalled` is true once the driver has ever logged into the driver app (any session, ' +
        'revoked or expired included — uninstalls are not detectable); `appLastSeenAt` is their ' +
        'latest app activity, null if never. Not yet backed by data, so always null/[] for now: driverScore, ' +
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
        "(e.g. ['hazmat']; replaces the whole list) and `note` (max 500; null clears it). " +
        '`phoneNumber` is not editable here — it is the driver app login; a sent one is ignored.',
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
    ...approve(
      'Reject a pending driver, with an optional reason. org_admin only. Records when and by ' +
        'whom (rejectedAt/rejectedBy); a rejected join request can be restored for 30 days via ' +
        'PATCH /drivers/{driverId}/restore. `notifyDriver` (default true) sends the driver the ' +
        '"request declined" notification — only for their own join request.',
    ),
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

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/drivers/{driverId}/restore`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.restoreDriverJoinRequest',
    ...approve(
      'Recently Rejected → Restore: a join request this organisation rejected goes back to ' +
        'Requests to You (`pending_staff_review`), where it can be approved; rejectedAt, ' +
        'rejectedBy and rejectionReason are cleared and the restore is audited. The driver is ' +
        'not notified. Same permission as approve/reject. No body.',
    ),
    request: { params: driverValidators.restoreDriver.shape.params },
    responses: {
      200: { description: 'The restored join request — same shape as a pending-list item' },
      403: { description: 'Not allowed to approve/reject requests', ...errorContent },
      404: { description: '`REQUEST_NOT_FOUND` — no such request here', ...errorContent },
      409: {
        description:
          '`NOT_REJECTED` (already restored/approved) · `RESTORE_WINDOW_EXPIRED` (rejected over ' +
          '30 days ago) · `DRIVER_UNAVAILABLE` (joined a fleet or left Loadsmart). `message` ' +
          'is user-facing.',
        ...errorContent,
      },
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
        'and `licenseClass` (latest licence verification’s class, or null). `status=rejected` ' +
        'lists Recently Rejected instead: requests this organisation rejected in the last 30 ' +
        'days, newest rejection first, without drivers who have since joined a fleet or left ' +
        'Loadsmart. Each adds `rejectedAt`, `rejectedBy` { id, name, role }, `rejectionReason`, ' +
        '`restorableUntil` and `canRestore` (whether this caller can restore it now).',
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
        '`rejected` (declined by the driver), `cancelled` (withdrawn by this organisation). ' +
        '`phoneNumber` searches by mobile only (names are not unique) — partial digits match, ' +
        'spaces/hyphens/+ ignored. Items: { invitationId, requestId (INV-00042), driverId, ' +
        'fullName, phoneNumber, status, sentAt, expiresAt, respondedAt, rejectionReason, ' +
        'deliveryChannels [{ channel: sms | whatsapp | push, status, statusAt }], appInstalled, ' +
        "openedAt (when the driver read the latest send's WhatsApp message; null until then, " +
        'cleared by Resend), canResend (whether Resend would go through now), sendsLeftAfterDecline (sends left since ' +
        'the driver first declined — once declined, the invite can be sent one more time, then ' +
        'once more every 30 days after the latest decline or send; null when never declined), ' +
        'canSendAgainAt (while no send is left, when the next one opens up; else null) }.',
    ),
    request: { query: driverValidators.listInvitations.shape.query },
    responses: {
      200: {
        description: 'Paginated invitations — { data: { items, page, limit, total, totalPages } }',
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/drivers/invitations`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.inviteDriverByPhone',
    ...write(
      'Invite a driver by mobile number from the Invitations tab. Only a number that already ' +
        'belongs to a driver on Loadsmart (added by any organisation, or registered through the ' +
        'driver app) can be invited — any other number returns 404 `DRIVER_NOT_FOUND` before ' +
        'anything is created or sent. A previous expired, declined or cancelled invite is ' +
        "re-sent on its own row. org_admin's invite goes out immediately (`invitation` set); " +
        "dispatch's waits for org_admin approval (`awaitingApproval: true`, `invitation: null`) " +
        'and is sent by PATCH /drivers/{driverId}/approve. Delivery is push today; WhatsApp is ' +
        'added once the notification templates are merged.',
    ),
    request: { body: json(driverValidators.inviteDriverByPhone.shape.body) },
    responses: {
      201: { description: '{ driverId, invitationId, awaitingApproval, invitation }' },
      400: { description: 'Validation failed', ...errorContent },
      404: {
        description: '`DRIVER_NOT_FOUND` — no driver on Loadsmart has this number',
        ...errorContent,
      },
      409: {
        description:
          'Driver already in your fleet, already awaiting approval, an invite is already ' +
          'pending, or the driver declined and was already sent it once more',
        ...errorContent,
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
        'the invite — one thread sorted by time: sent { at, by: { name, role } } (first send), ' +
        'resent { at, by } (each Resend or re-invite, its own entry), opened { at } (the driver ' +
        "read that send's WhatsApp message; once per send), installed { at } (the driver's " +
        'first app login — can come before the first send), expired { at } (logged when an ' +
        'expired invite is resent), declined { at, ' +
        'reason }, cancelled { at, by }, accepted { at }, delivery_failed { at, channel: sms | ' +
        'whatsapp | push } — then, while the invite is pending, a derived last step: expired ' +
        '{ at: expiresAt } once it ran out, else awaiting_response — and `deliveryChannels` ' +
        '[{ channel: sms | whatsapp | push, status, ' +
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
      'Re-send an invite on the same invitation (id and Req ID unchanged): pending, expired or ' +
        'declined. It goes back to `pending` with new sentAt/expiresAt, respondedAt and ' +
        'rejectionReason cleared, so the driver can accept it; the driver is re-notified, every ' +
        'delivery channel resets to `pending` (push then carries its real result) and the ' +
        'timeline gains `resent` (after `expired` if it had run out). Once the driver has ' +
        'declined, the invite can be sent only one more time (Resend or invite-by-mobile); ' +
        'after that this returns 409.',
    ),
    request: { params: driverValidators.resendInvitation.shape.params },
    responses: {
      200: { description: 'Updated invitation (same item shape as the list)' },
      404: { description: 'Invitation not found', ...errorContent },
      409: {
        description:
          'Not resendable — accepted, cancelled, rejected by your organisation, awaiting ' +
          'approval, driver left the platform, the driver has a newer invite, already sent once ' +
          'more after a decline, or changed meanwhile. `message` is user-facing.',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/drivers/invitations/{invitationId}`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.cancelDriverInvitation',
    ...write(
      'Cancel a pending invite. The row stays in this list with status `cancelled`; it disappears ' +
        'from the driver app (they can no longer accept or decline it), and the driver can no ' +
        "longer request to join this organisation. Only this organisation's link changes.",
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
      'Check a driving licence + date of birth against the Sarathi registry via ULIP, before the ' +
        'driver record exists — step 2 of the "Add a driver" form. IDfy is not used for licence ' +
        'verification. ' +
        '`licenseNumber` must be the standard 15-character DL format (e.g. MH1220190012345); ' +
        'spaces and hyphens are stripped first. `validUntil` is the transport validity when the ' +
        'licence has one, else the non-transport validity. `transportClass` lists only the ' +
        'transport classes. `age` is computed from `dateOfBirth`, so it is present even when the ' +
        'registry returned nothing.',
    ),
    request: { body: json(driverValidators.verifyDriverDl.shape.body) },
    responses: {
      200: {
        description:
          '{ status, holderName?, licenseClass?, transportClass?, validUntil?, licenseStatus?, ' +
          'age, addressLine1?, city?, rawResponse? } — registry fields only when available',
      },
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
        'verification, licence photos, bank details and operational status. `licenseNumber` and ' +
        '`dateOfBirth` are required — the server re-runs the Sarathi lookup itself and records ' +
        'that result; a client `verification` is only used when the lookup comes back ' +
        'manual_review. `fullName` is taken from the lookup and is required only when the lookup ' +
        'returns no holder name (400 otherwise). With both driving_license_front and ' +
        "driving_license_back in `documents`, the new profile's onboardingStep is set to " +
        '`completed`, so the driver app skips its registration wizard. Also takes the emergency ' +
        'contact (`emergencyContactName`, `emergencyContactPhone`, `emergencyContactRelation`) and ' +
        '`hasHealthInsurance`/`hasLifeInsurance` (yes | no | dont_know). The vehicle link stays ' +
        "a separate call. Only org_admin and dispatch may call this at all — org_admin's driver " +
        "is created `active` immediately; dispatch's is created `pending` until an org_admin " +
        'approves or rejects it via PATCH .../approve|reject. Also takes `emergencyContactRelation`, ' +
        '`engagementType` (on_roll | per_trip | vendor), `bhattaPerDay`, `advanceOutstanding`, ' +
        "`homeBase`, `licenseEndorsements` and `note` — this fleet's own note about the driver " +
        "(max 500), stored on the fleet's link so other fleets never see it.",
    ),
    request: { body: json(driverValidators.onboardDriver.shape.body) },
    responses: {
      201: { description: 'Created driver, with relations loaded' },
      400: {
        description: 'Validation failed, or no fullName when the lookup returned no name',
        ...errorContent,
      },
      409: { description: 'Phone number already in use', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/drivers/import/preview`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.previewDriverImport',
    ...write(
      'Bulk upload, step 1. Reads an .xlsx with one row per driver (the onboardDriver fields, ' +
        'flattened: bank details as bankAccountNumber/bankIfsc/bankAccountHolderName/bankUpiId, ' +
        'operationalStatus/operationalStatusReason; no licence photos). phoneNumber, ' +
        'licenseNumber and dateOfBirth columns are required. Also reads bloodGroup, ' +
        'hasHealthInsurance/hasLifeInsurance (yes | no | dont_know), salaryType + salaryAmount, ' +
        'bhattaPerDay and note (max 500). Headers match case/space-insensitively, and these ' +
        'aliases are accepted: Monthly Salary/Salary/Pay → salaryAmount, Bhatta/Daily Bhatta → ' +
        'bhattaPerDay, Health Insurance/Life Insurance, Blood → bloodGroup, Notes/Remarks/Comment ' +
        '→ note. Validates every row, checks for ' +
        'drivers that already exist, and runs the Sarathi lookup for each valid row. Nothing is ' +
        'saved. Each row comes back as ready | needs_review | invalid with errors, warnings, the ' +
        'Sarathi result and, unless invalid, `data` — the onboardDriver body to send to ' +
        'POST /drivers/import once the admin approves it.',
    ),
    request: {
      body: {
        content: {
          'multipart/form-data': {
            schema: {
              type: 'object',
              required: ['file'],
              properties: {
                file: {
                  type: 'string',
                  format: 'binary',
                  description: 'Excel file (.xlsx), maximum 5 MB and 100 rows.',
                },
              },
            },
          },
        },
      },
    },
    responses: {
      200: { description: 'Row-by-row preview; nothing saved' },
      400: { description: 'Invalid Excel file or missing file', ...errorContent },
      403: { description: 'Not permitted to write masters', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/drivers/import`,
    tags: [TAGS.MASTERS],
    operationId: 'masters.importDrivers',
    ...write(
      'Bulk upload, step 2. Saves the rows the admin approved on the preview — `drivers` is an ' +
        'array of onboardDriver bodies (the `data` of each preview row). Each driver is onboarded ' +
        'on its own, exactly like POST /drivers/onboard, so a bad row never blocks the others. ' +
        'Sarathi results from the preview are reused for up to an hour instead of being paid for ' +
        'again.',
    ),
    request: { body: json(driverValidators.importDrivers.shape.body) },
    responses: {
      201: { description: 'Per-driver result report: created (with driverId) or failed' },
      400: { description: 'Validation failed', ...errorContent },
      403: { description: 'Not permitted to write masters', ...errorContent },
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
        'leave). One row per driver — first call inserts, later calls overwrite. Only for drivers ' +
        'who have joined (relation status `active`); pending drivers get a 400. `availableFrom` ' +
        '(YYYY-MM-DD, "Fit to drive again from") is only allowed with on_leave / medically_unfit: ' +
        'a daily job at 00:05 IST sets the driver back to `active` on that date, clearing the ' +
        'date and `reason`. Every call overwrites it, so omit it to clear.',
    ),
    request: {
      params: driverValidators.setDriverOperationalStatus.shape.params,
      body: json(driverValidators.setDriverOperationalStatus.shape.body),
    },
    responses: {
      200: { description: 'Operational status' },
      400: {
        description:
          'Validation failed, or the driver has not joined yet (pending_driver_review / ' +
          'pending_staff_review)',
        ...errorContent,
      },
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
      'Record trip count and on-time percentage for a period. Re-reporting a period overwrites it. ' +
        'Only for drivers who have joined (relation status `active`).',
    ),
    request: {
      params: driverValidators.recordDriverTripMetrics.shape.params,
      body: json(driverValidators.recordDriverTripMetrics.shape.body),
    },
    responses: {
      200: { description: 'Trip metrics for the period' },
      400: {
        description:
          'Validation failed, periodEnd before periodStart, or the driver has not joined yet',
        ...errorContent,
      },
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
