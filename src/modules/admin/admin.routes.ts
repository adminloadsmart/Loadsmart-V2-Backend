import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { ADMIN_ORGANIZATIONS_MANAGE } from '../../shared/constants/permissions';
import { AdminController } from './admin.controller';
import { adminValidators } from './admin.validators';

export function createAdminRoutes(controller: AdminController): Router {
  const router = Router();

  // Everything in this module is cross-tenant — platform_admin only, no exceptions.
  router.use(requirePermission(ADMIN_ORGANIZATIONS_MANAGE));

  router.get(
    '/organizations',
    validate(adminValidators.listOrganizations),
    asyncHandler(controller.listOrganizations),
  );
  router.get(
    '/organizations/:organizationId',
    validate(adminValidators.getOrganization),
    asyncHandler(controller.getOrganization),
  );

  router.patch(
    '/organizations/:organizationId',
    validate(adminValidators.updateOrganization),
    asyncHandler(controller.updateOrganization),
  );

  router.patch(
    '/organizations/:organizationId/documents/:documentId',
    validate(adminValidators.verifyOrganizationDocument),
    asyncHandler(controller.verifyOrganizationDocument),
  );

  router.patch(
    '/organizations/:organizationId/online-verifier',
    validate(adminValidators.assignOnlineVerifier),
    asyncHandler(controller.assignOnlineVerifier),
  );
  router.patch(
    '/organizations/:organizationId/physical-agent',
    validate(adminValidators.assignPhysicalAgent),
    asyncHandler(controller.assignPhysicalAgent),
  );

  router.post(
    '/organizations/:organizationId/approve',
    validate(adminValidators.approveOrganization),
    asyncHandler(controller.approveOrganization),
  );
  router.post(
    '/organizations/:organizationId/reject',
    validate(adminValidators.rejectOrganization),
    asyncHandler(controller.rejectOrganization),
  );
  router.post(
    '/organizations/:organizationId/deny',
    validate(adminValidators.denyOrganization),
    asyncHandler(controller.denyOrganization),
  );

  router.get(
    '/organizations/:organizationId/audit',
    validate(adminValidators.getOrganizationAuditTrail),
    asyncHandler(controller.getOrganizationAuditTrail),
  );

  router.post(
    '/staff',
    validate(adminValidators.createStaff),
    asyncHandler(controller.createStaff),
  );
  router.get('/staff', validate(adminValidators.listStaff), asyncHandler(controller.listStaff));

  router.post(
    '/referral-codes',
    validate(adminValidators.createReferralCode),
    asyncHandler(controller.createReferralCode),
  );
  router.get(
    '/referral-codes',
    validate(adminValidators.listReferralCodes),
    asyncHandler(controller.listReferralCodes),
  );
  router.get(
    '/referral-codes/:referralCodeId',
    validate(adminValidators.getReferralCode),
    asyncHandler(controller.getReferralCode),
  );
  router.patch(
    '/referral-codes/:referralCodeId',
    validate(adminValidators.updateReferralCode),
    asyncHandler(controller.updateReferralCode),
  );
  router.post(
    '/referral-codes/:referralCodeId/revoke',
    validate(adminValidators.revokeReferralCode),
    asyncHandler(controller.revokeReferralCode),
  );
  router.delete(
    '/referral-codes/:referralCodeId',
    validate(adminValidators.deleteReferralCode),
    asyncHandler(controller.deleteReferralCode),
  );

  return router;
}
