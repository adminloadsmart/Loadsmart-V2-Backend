import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import {
  ADMIN_ORGANIZATIONS_MANAGE,
  KYC_ONLINE_VERIFY,
  KYC_ONLINE_REJECT,
  KYC_OFFLINE_VERIFY,
  KYC_OFFLINE_REJECT,
} from '../../shared/constants/permissions';
import { AdminController } from './admin.controller';
import { adminValidators } from './admin.validators';

// Per-route permission groups — this module is no longer platform_admin-only across the board.
// online_kyc_desk/offline_kyc_desk are let in on the routes relevant to their KYC track (still
// role-level only: requirePermission has no notion of *which* organization, so it just decides
// whether this role may call this kind of endpoint at all). The per-organization ownership check
// — can this specific reviewer act on this specific org — lives in AdminService.assertOrgAccessible
// instead, since only the service layer has the fetched organization to compare against.
// platform_admin satisfies every group below via requirePermission's own code-level bypass.
const anyReviewer = [
  ADMIN_ORGANIZATIONS_MANAGE,
  KYC_ONLINE_VERIFY,
  KYC_ONLINE_REJECT,
  KYC_OFFLINE_VERIFY,
  KYC_OFFLINE_REJECT,
];
const onlineReview = [ADMIN_ORGANIZATIONS_MANAGE, KYC_ONLINE_VERIFY, KYC_ONLINE_REJECT];
const onlineVerify = [ADMIN_ORGANIZATIONS_MANAGE, KYC_ONLINE_VERIFY];
const onlineDeny = [ADMIN_ORGANIZATIONS_MANAGE, KYC_ONLINE_REJECT];
const offlineVerify = [ADMIN_ORGANIZATIONS_MANAGE, KYC_OFFLINE_VERIFY];
const eitherReject = [ADMIN_ORGANIZATIONS_MANAGE, KYC_ONLINE_REJECT, KYC_OFFLINE_REJECT];
const adminOnly = [ADMIN_ORGANIZATIONS_MANAGE]; // only platform_admin actually holds this key

export function createAdminRoutes(controller: AdminController): Router {
  const router = Router();

  router.get(
    '/organizations',
    requirePermission(...anyReviewer),
    validate(adminValidators.listOrganizations),
    asyncHandler(controller.listOrganizations),
  );
  router.get(
    '/organizations/:organizationId',
    requirePermission(...anyReviewer),
    validate(adminValidators.getOrganization),
    asyncHandler(controller.getOrganization),
  );

  // Direct status edits (e.g. suspending/reactivating an active org) stay an admin-only lever,
  // separate from the KYC review actions below.
  router.patch(
    '/organizations/:organizationId',
    requirePermission(...adminOnly),
    validate(adminValidators.updateOrganization),
    asyncHandler(controller.updateOrganization),
  );

  // Verifying/rejecting the last outstanding document also completes online KYC as a side
  // effect — see admin.service.ts's verifyOrganizationDocument. No separate completion step.
  router.patch(
    '/organizations/:organizationId/documents/:documentId',
    requirePermission(...onlineReview),
    validate(adminValidators.verifyOrganizationDocument),
    asyncHandler(controller.verifyOrganizationDocument),
  );

  // Attach a new document, or replace an existing one's file, on the org's behalf — e.g. the org
  // struggles to upload themselves, or a submitted file needs correcting mid-review. Takes an
  // already-uploaded, already-confirmed fileKey (see POST /files + POST /files/:fileId/confirm),
  // not raw bytes — same reviewer group as the verify route above, not adminOnly.
  router.post(
    '/organizations/:organizationId/documents',
    requirePermission(...onlineReview),
    validate(adminValidators.uploadOrganizationDocument),
    asyncHandler(controller.uploadOrganizationDocument),
  );

  // Assignment/dispatch stays platform_admin-only — online_kyc_desk/offline_kyc_desk don't pick
  // their own cases or hand off to a specific colleague, they just act once assigned.
  router.patch(
    '/organizations/:organizationId/online-verifier',
    requirePermission(...adminOnly),
    validate(adminValidators.assignOnlineVerifier),
    asyncHandler(controller.assignOnlineVerifier),
  );
  router.patch(
    '/organizations/:organizationId/physical-agent',
    requirePermission(...onlineVerify),
    validate(adminValidators.assignPhysicalAgent),
    asyncHandler(controller.assignPhysicalAgent),
  );

  // The physical agent's approval — see admin.service.ts's approvePhysicalKyc.
  router.post(
    '/organizations/:organizationId/physical-kyc/approve',
    requirePermission(...offlineVerify),
    validate(adminValidators.approvePhysicalKyc),
    asyncHandler(controller.approvePhysicalKyc),
  );

  // Grants platform access — the "source verifier" (assigned online_kyc_desk reviewer) or
  // platform_admin only; offline_kyc_desk never reaches this.
  router.post(
    '/organizations/:organizationId/approve',
    requirePermission(...onlineVerify),
    validate(adminValidators.approveOrganization),
    asyncHandler(controller.approveOrganization),
  );
  router.post(
    '/organizations/:organizationId/reject',
    requirePermission(...eitherReject),
    validate(adminValidators.rejectOrganization),
    asyncHandler(controller.rejectOrganization),
  );
  router.post(
    '/organizations/:organizationId/deny',
    requirePermission(...onlineDeny),
    validate(adminValidators.denyOrganization),
    asyncHandler(controller.denyOrganization),
  );

  router.get(
    '/organizations/:organizationId/audit',
    requirePermission(...anyReviewer),
    validate(adminValidators.getOrganizationAuditTrail),
    asyncHandler(controller.getOrganizationAuditTrail),
  );

  // Staff and referral-code management are unrelated to KYC review — admin-only, unchanged.
  router.post(
    '/staff',
    requirePermission(...adminOnly),
    validate(adminValidators.createStaff),
    asyncHandler(controller.createStaff),
  );
  router.get(
    '/staff',
    requirePermission(...anyReviewer),
    validate(adminValidators.listStaff),
    asyncHandler(controller.listStaff),
  );

  router.patch(
    '/staff/:staffId',
    requirePermission(...adminOnly),
    validate(adminValidators.updateStaff),
    asyncHandler(controller.updateStaff),
  );

  router.delete(
    '/staff/:staffId',
    requirePermission(...adminOnly),
    validate(adminValidators.deleteStaff),
    asyncHandler(controller.deleteStaff),
  );

  router.post(
    '/referral-codes',
    requirePermission(...adminOnly),
    validate(adminValidators.createReferralCode),
    asyncHandler(controller.createReferralCode),
  );
  router.get(
    '/referral-codes',
    requirePermission(...adminOnly),
    validate(adminValidators.listReferralCodes),
    asyncHandler(controller.listReferralCodes),
  );
  router.get(
    '/referral-codes/:referralCodeId',
    requirePermission(...adminOnly),
    validate(adminValidators.getReferralCode),
    asyncHandler(controller.getReferralCode),
  );
  router.patch(
    '/referral-codes/:referralCodeId',
    requirePermission(...adminOnly),
    validate(adminValidators.updateReferralCode),
    asyncHandler(controller.updateReferralCode),
  );
  router.patch(
    '/referral-codes/:referralCodeId/status',
    requirePermission(...adminOnly),
    validate(adminValidators.setReferralCodeStatus),
    asyncHandler(controller.setReferralCodeStatus),
  );
  router.delete(
    '/referral-codes/:referralCodeId',
    requirePermission(...adminOnly),
    validate(adminValidators.deleteReferralCode),
    asyncHandler(controller.deleteReferralCode),
  );

  return router;
}
