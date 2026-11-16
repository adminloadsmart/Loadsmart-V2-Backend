import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { adminValidators } from './admin.validators';
import {
  ADMIN_ORGANIZATIONS_MANAGE,
  KYC_ONLINE_VERIFY,
  KYC_ONLINE_REJECT,
  KYC_OFFLINE_VERIFY,
  KYC_OFFLINE_REJECT,
  KYC_OVERSEE,
} from '../../shared/constants/permissions';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { TAGS, permissionGated, errorContent, json } from '../../shared/openapi/core';

/**
 * OpenAPI docs for the admin module: registers every route in admin.routes.ts, in the same
 * order, under the `admin` tag. Permission groups here mirror admin.routes.ts's exactly — staff/
 * referral-code/assignment/status-edit routes stay platform_admin-only, while the KYC review
 * routes also admit KYC reviewers — Approval/Admin team members (role-level only; the
 * per-organization ownership and capacity check isn't expressible in OpenAPI, see
 * AdminService.assertOrgAccessible).
 */

const BASE = `${API_VERSION_PREFIX}/admin`; // absolute path — must match its mount in app.ts
const adminOnly = (description: string) =>
  permissionGated([ADMIN_ORGANIZATIONS_MANAGE], description);
const anyReviewer = (description: string) =>
  permissionGated(
    [
      ADMIN_ORGANIZATIONS_MANAGE,
      KYC_ONLINE_VERIFY,
      KYC_ONLINE_REJECT,
      KYC_OFFLINE_VERIFY,
      KYC_OFFLINE_REJECT,
    ],
    description,
  );
const onlineReview = (description: string) =>
  permissionGated([ADMIN_ORGANIZATIONS_MANAGE, KYC_ONLINE_VERIFY, KYC_ONLINE_REJECT], description);
const onlineVerify = (description: string) =>
  permissionGated([ADMIN_ORGANIZATIONS_MANAGE, KYC_ONLINE_VERIFY], description);
const onlineDeny = (description: string) =>
  permissionGated([ADMIN_ORGANIZATIONS_MANAGE, KYC_ONLINE_REJECT], description);
const offlineVerify = (description: string) =>
  permissionGated([ADMIN_ORGANIZATIONS_MANAGE, KYC_OFFLINE_VERIFY], description);
const kycAssign = (description: string) =>
  permissionGated([ADMIN_ORGANIZATIONS_MANAGE, KYC_OVERSEE], description);
const eitherReject = (description: string) =>
  permissionGated([ADMIN_ORGANIZATIONS_MANAGE, KYC_ONLINE_REJECT, KYC_OFFLINE_REJECT], description);

export function registerAdminOpenApi(registry: OpenAPIRegistry): void {
  registry.registerPath({
    method: 'get',
    path: `${BASE}/organizations`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.listOrganizations',
    ...anyReviewer(
      'List organizations, paginated and optionally filtered. platform_admin sees every ' +
        'organization, and so does the Admin team (kyc.oversee); an Approval reviewer only sees those where they are the ' +
        'onlineKycVerifierId, or the physicalKycAgentId once onlineKycCompletedAt is set.',
    ),
    request: { query: adminValidators.listOrganizations.shape.query },
    responses: {
      200: {
        description:
          'Paginated organizations — { data: { items, page, limit, total, totalPages } }. Each ' +
          'item includes journeyStageHistory: the full, chronological trail of journey-stage ' +
          'transitions it has passed through, each with a timestamp and who caused it — same ' +
          'shape as GET .../organizations/{organizationId} below — and govResult: the ' +
          'government-registry (IDfy) check of its GST/CIN/Udyam/shop document ' +
          '({ documentType, status, details, nameMatches }), null when none can be checked — ' +
          'and businessDocument ({ documentType, documentNumber }: GST, else CIN/Udyam/shop ' +
          'licence). status takes one value or a comma-separated list; excludeDrafts=true ' +
          'leaves out sign-ups that were never submitted.',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/organizations/summary`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.getOrganizationsSummary',
    ...anyReviewer(
      'Counts for the verification queue — { total, pending, partialPending, approved, ' +
        'rejected (incl. suspended), overdue (pending, submitted over 24h ago), approvedToday ' +
        '(approved today IST, whenever created) }. Same search, date range and reviewer ' +
        'scoping as the listing; draft (never-submitted) sign-ups are always left out.',
    ),
    request: { query: adminValidators.getOrganizationsSummary.shape.query },
    responses: { 200: { description: 'Queue counts' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/organizations/{organizationId}`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.getOrganization',
    ...anyReviewer(
      'Get a single organization by id. Includes its documents and full journey-stage history — ' +
        'application_submitted → online_kyc_handover → physical_kyc_handover → ' +
        'approved/rejected, oldest first, ' +
        'with who caused each transition and when. Same reviewer-scoping as the listing endpoint ' +
        "above — an org outside the caller's scope 404s rather than 403s, so it reads as " +
        'nonexistent, not merely forbidden.',
    ),
    request: { params: adminValidators.getOrganization.shape.params },
    responses: {
      200: {
        description:
          'Organization detail, including documents, journeyStageHistory and govResult (same ' +
          'as the listing). Each document ' +
          'carries registryCheck ({ status: verified | inactive | not_found | failed | ' +
          'in_progress | not_checked, details, nameMatches }, null when the registry cannot ' +
          "check it) and verifiedBy ('registry' | 'reviewer' | null).",
      },
      404: {
        description: 'Organization not found (or not visible to this reviewer)',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/organizations/{organizationId}`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.updateOrganization',
    ...adminOnly(
      "Update an organization's status directly — for lifecycle transitions outside the KYC review " +
        'moment (e.g. suspending an active org, reactivating one). `reason` is required for every ' +
        'call, recorded as decisionReason. For the actual review decision, use POST ' +
        '.../approve, .../reject, or .../deny below instead, which also validate documents and ' +
        "record why. Logged to this organization's audit trail either way.",
    ),
    request: {
      params: adminValidators.updateOrganization.shape.params,
      body: json(adminValidators.updateOrganization.shape.body),
    },
    responses: {
      200: { description: 'Updated organization' },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Organization not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/organizations/{organizationId}/seat-limit`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.updateOrganizationSeatLimit',
    ...adminOnly(
      'Set "Seats on the plan" for an organization (Settings → Users & Roles). null resets to ' +
        'the default. Invites beyond the limit are refused with 409.',
    ),
    request: {
      params: adminValidators.updateOrganizationSeatLimit.shape.params,
      body: json(adminValidators.updateOrganizationSeatLimit.shape.body),
    },
    responses: {
      200: { description: 'Updated organization' },
      404: { description: 'Organization not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/organizations/{organizationId}/documents/{documentId}`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.verifyOrganizationDocument',
    ...onlineReview(
      "Verify or reject one of an organization's submitted documents (gst_certificate, udyam, cin, " +
        'or shop_establishment) — separate from PATCH /v1/admin/organizations/{organizationId}, ' +
        "which only touches the organization's own status. Callable by platform_admin or the org's " +
        'assigned online verifier only. If this call is the one that makes every ' +
        "submitted document verified, it also completes the organization's online KYC as a side " +
        'effect (onlineKycCompletedAt gets set, journeyStage advances to online_kyc_completed) — ' +
        'there is no separate completion call; this is what makes the org visible to its assigned ' +
        'physical agent and unblocks POST .../physical-kyc/approve.',
    ),
    request: {
      params: adminValidators.verifyOrganizationDocument.shape.params,
      body: json(adminValidators.verifyOrganizationDocument.shape.body),
    },
    responses: {
      200: { description: 'Updated document' },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Organization or document not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/organizations/{organizationId}/documents`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.uploadOrganizationDocument',
    ...onlineReview(
      "Attach a new document, or replace an existing one's file, on the organization's behalf — " +
        'e.g. the org struggles to upload themselves, or a submitted file needs correcting ' +
        'mid-review. Upserts by (organizationId, documentType): creates the row if none exists, ' +
        'otherwise replaces its file and resets verificationStatus back to pending — same as the ' +
        "org's own resubmit flow, so replacing an already-verified document un-verifies it. " +
        'Takes an already-uploaded, already-confirmed fileKey/backFileKey — upload the file(s) ' +
        'through POST /v1/files (+ POST /v1/files/{fileId}/confirm) first, then pass the ' +
        'resulting key(s) here; this endpoint never accepts raw file bytes.',
    ),
    request: {
      params: adminValidators.uploadOrganizationDocument.shape.params,
      body: json(adminValidators.uploadOrganizationDocument.shape.body),
    },
    responses: {
      200: { description: 'Created or replaced document' },
      400: {
        description: 'Validation failed, or fileKey/backFileKey not a confirmed upload',
        ...errorContent,
      },
      404: {
        description: 'Organization not found (or not visible to this reviewer)',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/organizations/{organizationId}/online-verifier`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.assignOnlineVerifier',
    ...kycAssign(
      "Assign an active Approval or Admin team member as this organization's online KYC " +
        'reviewer — platform_admin or the Admin team (kyc.oversee). This is also ' +
        "what scopes the assignee's own access: once assigned, they can act on this organization " +
        'as its online verifier via the reviewer routes below.',
    ),
    request: {
      params: adminValidators.assignOnlineVerifier.shape.params,
      body: json(adminValidators.assignOnlineVerifier.shape.body),
    },
    responses: {
      200: { description: 'Updated organization' },
      400: { description: 'userId is not an active Approval/Admin team member', ...errorContent },
      404: { description: 'Organization or user not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/organizations/{organizationId}/physical-agent`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.assignPhysicalAgent',
    ...adminOnly(
      "Assign an active Approval or Admin team member as this organization's physical KYC field " +
        "agent — platform_admin or the org's online verifier (the hand-off). The " +
        "assignee still can't see this organization until its online KYC is completed, which " +
        'happens automatically once every submitted document is verified (see PATCH ' +
        '.../documents/{documentId}).',
    ),
    request: {
      params: adminValidators.assignPhysicalAgent.shape.params,
      body: json(adminValidators.assignPhysicalAgent.shape.body),
    },
    responses: {
      200: { description: 'Updated organization' },
      400: { description: 'userId is not an active Approval/Admin team member', ...errorContent },
      404: { description: 'Organization or user not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/organizations/{organizationId}/physical-kyc/approve`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.approvePhysicalKyc',
    ...offlineVerify(
      'Approve physical/offline KYC — unconditionally blocked until online KYC has been completed ' +
        '(POST .../online-kyc/complete), even for platform_admin. Once set, this is what ' +
        'POST .../approve is waiting on to grant platform access. Callable by platform_admin or ' +
        "the org's assigned physical agent only.",
    ),
    request: { params: adminValidators.approvePhysicalKyc.shape.params },
    responses: {
      200: { description: 'Updated organization, physicalKycApprovedAt now set' },
      400: { description: 'Online KYC has not been completed yet', ...errorContent },
      404: { description: 'Organization not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/organizations/{organizationId}/approve`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.approveOrganization',
    ...onlineVerify(
      'Approve the organization and grant platform access (status → active). Blocked until every ' +
        'submitted document is verified via PATCH .../documents/{documentId} AND physical KYC has ' +
        'been approved via POST .../physical-kyc/approve. Callable by the "source verifier" — the ' +
        "org's assigned online verifier — or platform_admin; the physical agent can't (403).",
    ),
    request: { params: adminValidators.approveOrganization.shape.params },
    responses: {
      200: { description: 'Updated organization' },
      400: {
        description:
          'One or more submitted documents are not yet verified, or physical KYC is not yet approved',
        ...errorContent,
      },
      404: { description: 'Organization not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/organizations/{organizationId}/reject`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.rejectOrganization',
    ...eitherReject(
      'Reject the organization (status → rejected) with a mandatory reason — typically one of the ' +
        'caller\'s own canned template reasons (e.g. "document expired"), but any non-empty string ' +
        'is accepted server-side. Distinguished from POST .../deny only by which audit action is ' +
        'recorded and by convention, not by a different status value. Callable by platform_admin, ' +
        "or by the org's assigned online verifier or physical agent.",
    ),
    request: {
      params: adminValidators.rejectOrganization.shape.params,
      body: json(adminValidators.rejectOrganization.shape.body),
    },
    responses: {
      200: { description: 'Updated organization' },
      400: { description: 'Validation failed (reason required)', ...errorContent },
      404: { description: 'Organization not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/organizations/{organizationId}/deny`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.denyOrganization',
    ...onlineDeny(
      'Deny platform access (status → rejected) with a mandatory free-text reason. Same status ' +
        'change as POST .../reject — see that endpoint for how the two are distinguished. Callable ' +
        "by platform_admin or the org's assigned online verifier only (unlike reject, the " +
        "physical agent can't deny).",
    ),
    request: {
      params: adminValidators.denyOrganization.shape.params,
      body: json(adminValidators.denyOrganization.shape.body),
    },
    responses: {
      200: { description: 'Updated organization' },
      400: { description: 'Validation failed (reason required)', ...errorContent },
      404: { description: 'Organization not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/organizations/{organizationId}/audit`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.getOrganizationAuditTrail',
    ...anyReviewer(
      "This organization's audit history — status changes, document verifications, verifier/agent " +
        'assignments, online/physical KYC completions, and approve/reject/deny decisions — newest ' +
        'first, paginated. Same reviewer-scoping as GET .../organizations/{organizationId}.',
    ),
    request: {
      params: adminValidators.getOrganizationAuditTrail.shape.params,
      query: adminValidators.getOrganizationAuditTrail.shape.query,
    },
    responses: {
      200: {
        description:
          'Paginated audit log entries — { data: { items, page, limit, total, totalPages } }',
      },
      404: { description: 'Organization not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/staff`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.createStaff',
    ...adminOnly(
      'Add a team member (the "Team members" screen).\n\n' +
        '`roleId` is the team — one of ls_admin, ls_approval, ls_placement, ls_tracking, ls_cs, ' +
        'ls_receivables, ls_payables, sales (platform_admin and org_admin are never assignable). ' +
        'The team decides all access; there are no per-member permissions (strictly one team per ' +
        'person). `teamRole` is the job title within the team: ls_admin → admin; ops teams → ' +
        'team_member; sales → salesperson | asm. `sales` ({ salesType: ' +
        'shipper_sales | tracker_sales, state, asmUserId }) is required on the sales team and ' +
        'rejected elsewhere; a salesperson needs an active sales ASM as asmUserId, an ASM has ' +
        'none. `reportsToUserId` must be an active team member or the platform admin. ' +
        '`employeeId` is unique per team (a second account on another team may reuse it).\n\n' +
        'No password: team members sign in with their mobile number and an OTP ' +
        '(POST /v1/auth/login/otp/request with portal "platform"); an SMS/email invite tells them ' +
        'so (best-effort — never fails the hire).',
    ),
    request: { body: json(adminValidators.createStaff.shape.body) },
    responses: {
      201: {
        description:
          'Created team member, in the GET .../staff item shape plus `permissions` (the team ' +
          'bundle). A sales hire also gets their own referral code, returned as referralCode ' +
          '({ id, code }; null for other teams).',
      },
      400: {
        description:
          'Validation failed: roleId is not a team, teamRole not valid for the team, sales fields ' +
          'missing/not allowed, asmUserId not an active ASM, or reportsToUserId not an active ' +
          'team member',
        ...errorContent,
      },
      404: { description: 'Role not found', ...errorContent },
      409: {
        description:
          'Phone number or email already in use, or employee ID already used on the team',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/staff`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.listStaff',
    ...adminOnly(
      'List team members, paginated. Filters: search (name, email, phone or employee ID), team ' +
        '(e.g. ?team=ls_approval for the KYC verifier/agent assignment dropdowns; `role` is the ' +
        'older name for the same filter), teamRole, region, status (invited | active). A KYC ' +
        'reviewer (not the platform admin) only gets { id, fullName, team, role, teamRole, region, ' +
        'workload } per item.',
    ),
    request: { query: adminValidators.listStaff.shape.query },
    responses: {
      200: {
        description:
          'Paginated team members — { data: { items, page, limit, total, totalPages } }. Each item: ' +
          'id, fullName, employeeId, phoneNumber, email, team (and role, the same value), teamRole, ' +
          'region, reportsTo ({ id, fullName } | null), sales ({ salesType, state, asm } | null), ' +
          'status (invited until first sign-in), lastActiveAt, plus signupCount (submitted orgs ' +
          "that used the member's referral codes), " +
          'approvedSignupCount (those now approved), referralCodes (each with its status) and ' +
          'workload (orgs currently assigned to them for KYC review, not yet completed).',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/staff/{staffId}`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.getStaff',
    ...adminOnly('One staff account, in the same shape as a GET .../staff item.'),
    request: { params: adminValidators.getStaff.shape.params },
    responses: {
      200: { description: 'Staff account' },
      404: { description: 'Staff member not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/staff/teams`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.listStaffTeams',
    ...adminOnly(
      'The teams a team member can be put in, for the Team members form — [{ id, name, ' +
        'teamRoles, capabilities }]: `id` is the roleId to send, `teamRoles` the job titles valid ' +
        'on that team, `capabilities` what the team can do (permission descriptions).',
    ),
    responses: { 200: { description: 'Teams' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/staff/summary`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.getStaffSummary',
    ...adminOnly(
      'Per-team cards for the Team members screen — { [team]: { count, workload, signups, ' +
        'approvedSignups } } for every team. Counts the same people GET .../staff lists, so the ' +
        'card totals and the list total agree.',
    ),
    responses: { 200: { description: 'Team member counts by team' } },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/referral-codes/summary`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.getReferralCodesSummary',
    ...adminOnly(
      'Counts for the Referral Codes cards — { total, active, expired, revoked }, status derived ' +
        'the same way as on each code.',
    ),
    responses: { 200: { description: 'Referral code counts' } },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/staff/{staffId}`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.updateStaff',
    ...adminOnly(
      'Update a team member — every POST field, all optional; the patch is merged onto the ' +
        'current record and validated as a whole with the POST rules (send teamRole when moving to ' +
        'a team where the current one is not valid; sales: null clears the sales details). ' +
        'Moving off a team is refused (409) while work tied to it would be orphaned: open KYC ' +
        'reviews (leaving Approval/Admin), active referral codes (leaving sales), salespeople ' +
        'under them (no longer an ASM). Changing the phone number signs the member out everywhere.',
    ),
    request: {
      params: adminValidators.updateStaff.shape.params,
      body: json(adminValidators.updateStaff.shape.body),
    },
    responses: {
      200: { description: 'Updated team member (GET .../staff item shape plus permissions)' },
      400: { description: 'Validation failed — same rules as POST', ...errorContent },
      403: { description: 'Attempted to edit your own record', ...errorContent },
      404: { description: 'Team member or role not found', ...errorContent },
      409: {
        description:
          'Phone/email/employee ID already in use, or the team change would orphan KYC reviews, ' +
          'referral codes or salespeople',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/staff/{staffId}`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.deleteStaff',
    ...adminOnly(
      'Remove a team member (soft delete; their sessions are revoked). platform_admin and org ' +
        "users aren't removed this way. Refused (409) while work still points at them — " +
        'unfinished KYC reviews, team members reporting to them, salespeople under them as ' +
        'ASM, or active referral codes — reassign first. A caller cannot delete their own account.',
    ),
    request: { params: adminValidators.deleteStaff.shape.params },
    responses: {
      200: { description: '{ success: true }' },
      403: { description: 'Attempted to delete your own account', ...errorContent },
      404: { description: 'Staff member not found', ...errorContent },
      409: {
        description: 'Staff member still has unfinished KYC review assignments',
        ...errorContent,
      },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/referral-codes`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.createReferralCode',
    ...adminOnly(
      'Create a referral code, optionally assigning it to a sales rep up front (ownerUserId, if ' +
        'provided, must hold the sales role — the check is skipped when omitted; an unowned code ' +
        'can be assigned later via PATCH). Shared with prospects, then redeemed at signup via ' +
        "POST /v1/auth/organization's optional referralCode field to attribute the resulting " +
        'organization to its owner. validUntil is optional (open-ended if omitted) — see GET ' +
        '.../{referralCodeId} for how the computed status (active/expired/revoked) is derived from it.',
    ),
    request: { body: json(adminValidators.createReferralCode.shape.body) },
    responses: {
      201: { description: 'Created referral code' },
      400: {
        description: 'Validation failed, or ownerUserId does not hold the sales role',
        ...errorContent,
      },
      404: { description: 'ownerUserId not found', ...errorContent },
      409: { description: 'code already exists', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/referral-codes`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.listReferralCodes',
    ...adminOnly(
      'List referral codes, paginated and optionally filtered by ownerUserId and/or code search. ' +
        'Each item includes its computed status, owner ({ id, fullName, region, deletedAt }), ' +
        'totalSignup (submitted orgs that used it) and approvedSignup (those now approved).',
    ),
    request: { query: adminValidators.listReferralCodes.shape.query },
    responses: {
      200: {
        description:
          'Paginated referral codes — { data: { items, page, limit, total, totalPages } }',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/referral-codes/{referralCodeId}`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.getReferralCode',
    ...adminOnly('Get a single referral code by id, with its computed status.'),
    request: { params: adminValidators.getReferralCode.shape.params },
    responses: {
      200: { description: 'Referral code detail, including computed status' },
      404: { description: 'Referral code not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/referral-codes/{referralCodeId}`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.updateReferralCode',
    ...adminOnly(
      "Update a referral code's owner and/or validity window. The code string itself is not " +
        "editable — it may already be in a prospect's hands, so create a new code instead of " +
        'changing this one. Omitted fields keep their current value. To revoke or reactivate the ' +
        'code, use PATCH .../status instead.',
    ),
    request: {
      params: adminValidators.updateReferralCode.shape.params,
      body: json(adminValidators.updateReferralCode.shape.body),
    },
    responses: {
      200: { description: 'Updated referral code' },
      400: {
        description: 'Validation failed, or ownerUserId does not hold the sales role',
        ...errorContent,
      },
      404: { description: 'Referral code or ownerUserId not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/referral-codes/{referralCodeId}/status`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.setReferralCodeStatus',
    ...adminOnly(
      'Set a referral code active or revoked directly — idempotent, so setting it to its current ' +
        'state is not an error. Revoking stops the code being redeemable at signup right away, ' +
        'independent of its validUntil; reactivating undoes that. Separate from PATCH ' +
        '.../referral-codes/{referralCodeId} above, which only touches owner/validity. Preferred ' +
        'over DELETE for a code that may already be in circulation, since the row (and any ' +
        'organization attribution already recorded) is kept either way.',
    ),
    request: {
      params: adminValidators.setReferralCodeStatus.shape.params,
      body: json(adminValidators.setReferralCodeStatus.shape.body),
    },
    responses: {
      200: { description: 'Updated referral code' },
      400: { description: 'Validation failed', ...errorContent },
      404: { description: 'Referral code not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'delete',
    path: `${BASE}/referral-codes/{referralCodeId}`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.deleteReferralCode',
    ...adminOnly(
      'Permanently delete a referral code — only allowed while it has never been redeemed by any ' +
        'organization. Once an organization has signed up with it, its attribution history must be ' +
        'preserved, so this is rejected and PATCH .../status is the only option at that point.',
    ),
    request: { params: adminValidators.deleteReferralCode.shape.params },
    responses: {
      200: { description: '{ success: true }' },
      404: { description: 'Referral code not found', ...errorContent },
      409: {
        description: 'Referral code has already been used by one or more organizations',
        ...errorContent,
      },
    },
  });
}
