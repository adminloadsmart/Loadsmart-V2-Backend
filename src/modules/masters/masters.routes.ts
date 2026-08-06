import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { MastersController } from './masters.controller';
import { mastersValidators } from './masters.validators';
import { MASTERS_WRITE } from '../../shared/constants/permissions';

export function createMastersProtectedRoutes(controller: MastersController): Router {
  const router = Router();

  // Tenant-owned resources only — no platform-scope caller (platform_admin/staff) has any
  // business here, unlike /roles or /admin. See require-tenant.middleware.ts.
  router.use(requireTenant);

  // Reads are open to any authenticated member of the tenant; writes are restricted below.
  const canWrite = requirePermission(MASTERS_WRITE);

  router.post('/vehicles', canWrite, validate(mastersValidators.createVehicle), asyncHandler(controller.createVehicle));
  router.get('/vehicles', validate(mastersValidators.listVehicles), asyncHandler(controller.listVehicles));
  router.get('/vehicles/:vehicleId', validate(mastersValidators.getVehicle), asyncHandler(controller.getVehicle));
  router.patch(
    '/vehicles/:vehicleId',
    canWrite,
    validate(mastersValidators.updateVehicle),
    asyncHandler(controller.updateVehicle),
  );
  router.delete(
    '/vehicles/:vehicleId',
    canWrite,
    validate(mastersValidators.deleteVehicle),
    asyncHandler(controller.deleteVehicle),
  );

  router.post(
    '/vehicles/:vehicleId/documents',
    canWrite,
    validate(mastersValidators.addVehicleDocument),
    asyncHandler(controller.addVehicleDocument),
  );
  router.get(
    '/vehicles/:vehicleId/documents',
    validate(mastersValidators.listVehicleDocuments),
    asyncHandler(controller.listVehicleDocuments),
  );
  router.patch(
    '/vehicles/:vehicleId/documents/:documentId',
    canWrite,
    validate(mastersValidators.updateVehicleDocument),
    asyncHandler(controller.updateVehicleDocument),
  );
  router.delete(
    '/vehicles/:vehicleId/documents/:documentId',
    canWrite,
    validate(mastersValidators.deleteVehicleDocument),
    asyncHandler(controller.deleteVehicleDocument),
  );

  router.post('/drivers', canWrite, validate(mastersValidators.createDriver), asyncHandler(controller.createDriver));
  router.get('/drivers', validate(mastersValidators.listDrivers), asyncHandler(controller.listDrivers));
  router.get('/drivers/:driverId', validate(mastersValidators.getDriver), asyncHandler(controller.getDriver));
  router.patch(
    '/drivers/:driverId',
    canWrite,
    validate(mastersValidators.updateDriver),
    asyncHandler(controller.updateDriver),
  );
  router.delete(
    '/drivers/:driverId',
    canWrite,
    validate(mastersValidators.deleteDriver),
    asyncHandler(controller.deleteDriver),
  );

  router.post(
    '/drivers/:driverId/documents',
    canWrite,
    validate(mastersValidators.addDriverDocument),
    asyncHandler(controller.addDriverDocument),
  );
  router.get(
    '/drivers/:driverId/documents',
    validate(mastersValidators.listDriverDocuments),
    asyncHandler(controller.listDriverDocuments),
  );
  router.delete(
    '/drivers/:driverId/documents/:documentId',
    canWrite,
    validate(mastersValidators.deleteDriverDocument),
    asyncHandler(controller.deleteDriverDocument),
  );

  router.post(
    '/drivers/:driverId/verifications',
    canWrite,
    validate(mastersValidators.recordDriverVerification),
    asyncHandler(controller.recordDriverVerification),
  );
  router.get(
    '/drivers/:driverId/verifications',
    validate(mastersValidators.listDriverVerifications),
    asyncHandler(controller.listDriverVerifications),
  );

  router.post(
    '/drivers/:driverId/bank-details',
    canWrite,
    validate(mastersValidators.addDriverBankDetails),
    asyncHandler(controller.addDriverBankDetails),
  );
  router.get(
    '/drivers/:driverId/bank-details',
    validate(mastersValidators.listDriverBankDetails),
    asyncHandler(controller.listDriverBankDetails),
  );
  router.patch(
    '/drivers/:driverId/bank-details/:bankDetailsId/verification',
    canWrite,
    validate(mastersValidators.setDriverBankDetailsVerification),
    asyncHandler(controller.setDriverBankDetailsVerification),
  );
  router.delete(
    '/drivers/:driverId/bank-details/:bankDetailsId',
    canWrite,
    validate(mastersValidators.deleteDriverBankDetails),
    asyncHandler(controller.deleteDriverBankDetails),
  );

  router.post(
    '/vehicles/:vehicleId/drivers',
    canWrite,
    validate(mastersValidators.linkDriver),
    asyncHandler(controller.linkDriver),
  );
  router.get(
    '/vehicles/:vehicleId/drivers',
    validate(mastersValidators.listVehicleLinks),
    asyncHandler(controller.listVehicleLinks),
  );
  router.get(
    '/drivers/:driverId/vehicles',
    validate(mastersValidators.listDriverLinks),
    asyncHandler(controller.listDriverLinks),
  );
  router.patch(
    '/fleet-driver-links/:linkId/primary',
    canWrite,
    validate(mastersValidators.setLinkPrimary),
    asyncHandler(controller.setLinkPrimary),
  );
  router.patch(
    '/fleet-driver-links/:linkId/end',
    canWrite,
    validate(mastersValidators.endLink),
    asyncHandler(controller.endLink),
  );
  router.delete(
    '/fleet-driver-links/:linkId',
    canWrite,
    validate(mastersValidators.deleteLink),
    asyncHandler(controller.deleteLink),
  );

  return router;
}
