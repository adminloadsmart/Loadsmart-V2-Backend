import { OpenAPIRegistry } from '@asteasolutions/zod-to-openapi';
import { adminValidators } from './admin.validators';
import {
  ADMIN_ORGANIZATIONS_MANAGE,
  KYC_ONLINE_VERIFY,
  KYC_ONLINE_REJECT,
  KYC_OFFLINE_VERIFY,
  KYC_OFFLINE_REJECT,
} from '../../shared/constants/permissions';
import { API_VERSION_PREFIX } from '../../shared/constants/api';
import { TAGS, permissionGated, errorContent, json } from '../../shared/openapi/core';

/**
 * OpenAPI docs for the admin module: registers every route in admin.routes.ts, in the same
 * order, under the `admin` tag. Permission groups here mirror admin.routes.ts's exactly — staff/
 * referral-code/assignment/status-edit routes stay platform_admin-only, while the KYC review
 * routes also admit online_kyc_desk/offline_kyc_desk (role-level only; the per-organization
 * ownership check isn't expressible in OpenAPI, see AdminService.assertOrgAccessible).
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
        'organization; online_kyc_desk/offline_kyc_desk only see those assigned to them as ' +
        'onlineKycVerifierId/physicalKycAgentId respectively, and offline_kyc_desk additionally ' +
        'only once onlineKycCompletedAt is set (see POST .../online-kyc/complete).',
    ),
    request: { query: adminValidators.listOrganizations.shape.query },
    responses: {
      200: {
        description:
          'Paginated organizations — { data: { items, page, limit, total, totalPages } }',
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/organizations/{organizationId}`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.getOrganization',
    ...anyReviewer(
      'Get a single organization by id. Includes its documents and full journey-stage history — ' +
        'application_submitted → online_kyc → physical_kyc → approved/rejected, oldest first, ' +
        'with who caused each transition and when. The listing endpoint above only exposes the ' +
        "org's current stage, not this history. Same reviewer-scoping as the listing endpoint " +
        "above — an org outside the caller's scope 404s rather than 403s, so it reads as " +
        'nonexistent, not merely forbidden.',
    ),
    request: { params: adminValidators.getOrganization.shape.params },
    responses: {
      200: { description: 'Organization detail, including documents and journeyStageHistory' },
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
        'moment (e.g. suspending an active org, reactivating one). For the actual review decision, use ' +
        'POST .../approve, .../reject, or .../deny below instead, which also validate documents and ' +
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
    path: `${BASE}/organizations/{organizationId}/documents/{documentId}`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.verifyOrganizationDocument',
    ...onlineReview(
      "Verify or reject one of an organization's submitted documents (gst_certificate, pan, udyam, " +
        'aadhaar, cin, or shop_establishment) — separate from PATCH /v1/admin/organizations/{organizationId}, ' +
        "which only touches the organization's own status. Callable by platform_admin or the org's " +
        'assigned online_kyc_desk reviewer only.',
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
    method: 'patch',
    path: `${BASE}/organizations/{organizationId}/online-verifier`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.assignOnlineVerifier',
    ...adminOnly(
      "Assign a staff member (must hold the online_kyc_desk role) as this organization's online " +
        'KYC reviewer — platform_admin only; dispatch/routing stays an admin function. This is ' +
        "also what scopes the assignee's own access: once assigned, they can act on this " +
        'organization via the online_kyc_desk-accessible routes below.',
    ),
    request: {
      params: adminValidators.assignOnlineVerifier.shape.params,
      body: json(adminValidators.assignOnlineVerifier.shape.body),
    },
    responses: {
      200: { description: 'Updated organization' },
      400: { description: "userId doesn't hold the online_kyc_desk role", ...errorContent },
      404: { description: 'Organization or user not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'patch',
    path: `${BASE}/organizations/{organizationId}/physical-agent`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.assignPhysicalAgent',
    ...adminOnly(
      "Assign a staff member (must hold the offline_kyc_desk role) as this organization's physical " +
        'KYC field agent — platform_admin only, same as the online-verifier endpoint above. The ' +
        "assignee still can't see this organization until its online KYC is completed (see " +
        'POST .../online-kyc/complete).',
    ),
    request: {
      params: adminValidators.assignPhysicalAgent.shape.params,
      body: json(adminValidators.assignPhysicalAgent.shape.body),
    },
    responses: {
      200: { description: 'Updated organization' },
      400: { description: "userId doesn't hold the offline_kyc_desk role", ...errorContent },
      404: { description: 'Organization or user not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/organizations/{organizationId}/online-kyc/complete`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.completeOnlineKyc',
    ...onlineVerify(
      "Mark this organization's online KYC review done — the handover moment to physical/offline " +
        "review. Until this is set, the assigned offline_kyc_desk agent can't see this organization " +
        'at all (GET .../organizations and GET .../organizations/{organizationId} both exclude it). ' +
        'Blocked until every submitted document is verified, same gate as POST .../approve. ' +
        "Callable by platform_admin or the org's assigned online_kyc_desk reviewer only.",
    ),
    request: { params: adminValidators.completeOnlineKyc.shape.params },
    responses: {
      200: { description: 'Updated organization, onlineKycCompletedAt now set' },
      400: { description: 'One or more submitted documents are not yet verified', ...errorContent },
      404: { description: 'Organization not found', ...errorContent },
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
        "the org's assigned offline_kyc_desk agent only.",
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
        "org's assigned online_kyc_desk reviewer — or platform_admin; offline_kyc_desk never reaches " +
        'this endpoint.',
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
        "or by the org's assigned online_kyc_desk reviewer or offline_kyc_desk agent (whichever role " +
        'the caller holds).',
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
        "by platform_admin or the org's assigned online_kyc_desk reviewer only (unlike reject, " +
        "offline_kyc_desk can't deny).",
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
      'Provision an internal staff account (sales, online/offline KYC desk, load console).\n\n' +
        '`roleId` must resolve to one of those four platform-scope roles — platform_admin and ' +
        "org_admin can't be assigned this way. The password is generated server-side (not admin-" +
        "supplied) and isn't returned in this response; the staff member logs in themselves via " +
        'POST /v1/auth/login once they have it through some other channel.\n\n' +
        'Optional `permissionIds` grants extra permissions on top of the role, in the same call ' +
        "(each id from GET /v1/roles/permissions?scope=platform — group by that response's `module` " +
        'field to build a checklist). Not atomic with account creation: if one id in the list is ' +
        "invalid (wrong scope, or doesn't exist), the account is still created and any ids granted " +
        'before it stay granted — the error identifies which id failed so it can be retried alone ' +
        'via POST /v1/roles/users/{userId}/permissions. Response `permissions` is the final effective ' +
        'list (role ∪ granted), not just what this call added.',
    ),
    request: { body: json(adminValidators.createStaff.shape.body) },
    responses: {
      201: { description: 'Created staff account (no password hash in the response)' },
      400: { description: 'Validation failed, or roleId is not staff-assignable', ...errorContent },
      403: {
        description: 'A permissionId in the list is organization-scope, not platform-scope',
        ...errorContent,
      },
      404: {
        description: 'Role not found, or a permissionId in the list not found',
        ...errorContent,
      },
      409: { description: 'Phone number or email already in use', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/staff`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.listStaff',
    ...adminOnly(
      'List internal staff accounts, paginated and optionally filtered by name/email search and/or ' +
        'role (e.g. ?role=online_kyc_desk to populate the KYC verifier/agent assignment dropdowns).',
    ),
    request: { query: adminValidators.listStaff.shape.query },
    responses: {
      200: { description: 'Paginated staff — { data: { items, page, limit, total, totalPages } }' },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/staff/import/preview`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.previewStaffImport',
    ...adminOnly(
      'Upload a CSV and preview smart column mapping and row-level validation. No users are created.',
    ),
    responses: {
      200: { description: 'Import preview with mapping, summary, and row errors' },
      400: { description: 'Invalid CSV or ambiguous/missing columns', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/staff/import/commit`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.commitStaffImport',
    ...adminOnly(
      'Commit a previously previewed staff CSV. Valid rows are created through the normal staff service.',
    ),
    request: { body: json(adminValidators.commitStaffImport.shape.body) },
    responses: {
      200: { description: 'Import result with per-row success/failure status' },
      404: { description: 'Import not found', ...errorContent },
      409: { description: 'No valid rows or import already processing', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'get',
    path: `${BASE}/staff/import/{importId}`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.getStaffImport',
    ...adminOnly('Get the status and row-level results for a staff import.'),
    request: { params: adminValidators.getStaffImport.shape.params },
    responses: {
      200: { description: 'Staff import status and results' },
      404: { description: 'Import not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/referral-codes`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.createReferralCode',
    ...adminOnly(
      'Create a referral code and assign it to a sales rep (ownerUserId must hold the sales role). ' +
        "Shared with prospects, then redeemed at signup via POST /v1/auth/organization's optional " +
        'referralCode field to attribute the resulting organization to that rep. Both validFrom and ' +
        'validUntil are optional (open-ended if omitted) — see GET .../{referralCodeId} for how the ' +
        'computed status (upcoming/active/expired/revoked) is derived from them.',
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
        'Each item includes its computed status.',
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
        'changing this one. Omitted fields keep their current value.',
    ),
    request: {
      params: adminValidators.updateReferralCode.shape.params,
      body: json(adminValidators.updateReferralCode.shape.body),
    },
    responses: {
      200: { description: 'Updated referral code' },
      400: {
        description:
          'Validation failed, ownerUserId does not hold the sales role, or validUntil precedes validFrom',
        ...errorContent,
      },
      404: { description: 'Referral code or ownerUserId not found', ...errorContent },
    },
  });

  registry.registerPath({
    method: 'post',
    path: `${BASE}/referral-codes/{referralCodeId}/revoke`,
    tags: [TAGS.ADMIN],
    operationId: 'admin.revokeReferralCode',
    ...adminOnly(
      'Revoke a referral code immediately, independent of its validUntil — it stops being ' +
        'redeemable at signup right away. Preferred over DELETE for a code that may already be in ' +
        'circulation, since the row (and any organization attribution already recorded) is kept.',
    ),
    request: { params: adminValidators.revokeReferralCode.shape.params },
    responses: {
      200: { description: 'Revoked referral code' },
      404: { description: 'Referral code not found', ...errorContent },
      409: { description: 'Referral code is already revoked', ...errorContent },
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
        'preserved, so this is rejected and POST .../revoke is the only option at that point.',
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
