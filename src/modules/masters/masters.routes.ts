import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { createIpRateLimit } from '../../shared/middleware/rate-limit.middleware';
import { env } from '../../config/env';
import { MastersController } from './masters.controller';
import { mastersValidators } from './masters.validators';
import { loadingPointValidators } from './loading-point.validators';
import { MASTERS_WRITE, MASTERS_APPROVE } from '../../shared/constants/permissions';
import multer, { FileFilterCallback } from 'multer';
import { ValidationError } from '../../shared/errors';
import { TransporterImportController } from './transporter-import.controller';
import { productValidators } from './product.validators';

const transporterCsvUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback: FileFilterCallback) => {
    if (!file.originalname.toLowerCase().endsWith('.csv'))
      callback(new Error('Only .csv files are accepted'));
    else callback(null, true);
  },
});

function requireTransporterCsvFile(
  req: Parameters<import('express').RequestHandler>[0],
  _res: Parameters<import('express').RequestHandler>[1],
  next: Parameters<import('express').RequestHandler>[2],
) {
  if (!req.file) {
    next(new ValidationError('A CSV file is required in the "file" form field'));
    return;
  }
  next();
}

export function createMastersProtectedRoutes(
  controller: MastersController,
  transporterImportController: TransporterImportController,
): Router {
  const router = Router();

  // Tenant-owned resources only — no platform-scope caller (platform_admin/staff) has any
  // business here, unlike /roles or /admin. See require-tenant.middleware.ts.
  router.use(requireTenant);

  // Reads are open to any authenticated member of the tenant; writes are restricted below.
  const canWrite = requirePermission(MASTERS_WRITE);
  // Approve/reject a pending vehicle or driver — org_admin only (see db/seed-roles.ts).
  const canApprove = requirePermission(MASTERS_APPROVE);
  // Throttles POST /drivers/verify-dl — it fans out to IDfy's paid Sarathi lookup. Same
  // createIpRateLimit + env-driven limit/window pattern as auth.routes.ts.
  const verifyDriverDlRateLimit = createIpRateLimit({
    keyPrefix: 'verify-dl',
    limit: env.driverVerifyDlRateLimitMax,
    windowSeconds: env.driverVerifyDlRateLimitWindowSeconds,
  });

  // Settings → Truck Types — vehicles.truckTypeId references these, so declared first.
  router.get(
    '/truck-types',
    validate(mastersValidators.listTruckTypes),
    asyncHandler(controller.listTruckTypes),
  );
  router.post(
    '/truck-types',
    canWrite,
    validate(mastersValidators.createTruckType),
    asyncHandler(controller.createTruckType),
  );
  router.delete(
    '/truck-types/:truckTypeId',
    canWrite,
    validate(mastersValidators.deleteTruckType),
    asyncHandler(controller.deleteTruckType),
  );

  router.post(
    '/products',
    canWrite,
    validate(productValidators.create),
    asyncHandler(controller.createProduct),
  );
  router.get('/products', validate(productValidators.list), asyncHandler(controller.listProducts));
  router.get(
    '/products/:productId',
    validate(productValidators.get),
    asyncHandler(controller.getProduct),
  );
  router.patch(
    '/products/:productId',
    canWrite,
    validate(productValidators.update),
    asyncHandler(controller.updateProduct),
  );
  router.patch(
    '/products/:productId/approve',
    canApprove,
    validate(productValidators.approve),
    asyncHandler(controller.approveProduct),
  );
  router.patch(
    '/products/:productId/reject',
    canApprove,
    validate(productValidators.reject),
    asyncHandler(controller.rejectProduct),
  );
  router.patch(
    '/products/:productId/status',
    canWrite,
    validate(productValidators.status),
    asyncHandler(controller.setProductStatus),
  );
  router.delete(
    '/products/:productId',
    canWrite,
    validate(productValidators.delete),
    asyncHandler(controller.deleteProduct),
  );

  // Settings → Loading Points — origins used by dispatch and load creation.
  router.post(
    '/loading-points',
    canWrite,
    validate(loadingPointValidators.create),
    asyncHandler(controller.createLoadingPoint),
  );
  router.get(
    '/loading-points',
    validate(loadingPointValidators.list),
    asyncHandler(controller.listLoadingPoints),
  );
  router.get(
    '/loading-points/:loadingPointId',
    validate(loadingPointValidators.get),
    asyncHandler(controller.getLoadingPoint),
  );
  router.patch(
    '/loading-points/:loadingPointId',
    canWrite,
    validate(loadingPointValidators.update),
    asyncHandler(controller.updateLoadingPoint),
  );
  router.patch(
    '/loading-points/:loadingPointId/approve',
    canApprove,
    validate(loadingPointValidators.approve),
    asyncHandler(controller.approveLoadingPoint),
  );
  router.patch(
    '/loading-points/:loadingPointId/reject',
    canApprove,
    validate(loadingPointValidators.reject),
    asyncHandler(controller.rejectLoadingPoint),
  );
  router.delete(
    '/loading-points/:loadingPointId',
    canWrite,
    validate(loadingPointValidators.delete),
    asyncHandler(controller.deleteLoadingPoint),
  );

  router.post(
    '/transporters',
    validate(mastersValidators.createTransporter),
    asyncHandler(controller.createTransporter),
  );
  router.post(
    '/transporters/import',
    requirePermission(MASTERS_WRITE),
    transporterCsvUpload.single('file'),
    requireTransporterCsvFile,
    asyncHandler(transporterImportController.import),
  );
  router.get(
    '/transporters',
    validate(mastersValidators.listTransporters),
    asyncHandler(controller.listTransporters),
  );
  router.patch(
    '/transporters/:transporterId',
    validate(mastersValidators.updateTransporter),
    asyncHandler(controller.updateTransporter),
  );
  router.delete(
    '/transporters/:transporterId',
    validate(mastersValidators.deleteTransporter),
    asyncHandler(controller.deleteTransporter),
  );

  // Backs the single "Save vehicle" button — whole form, one transaction. Declared before
  // '/vehicles/:vehicleId' so the literal segment isn't captured as an id.
  router.post(
    '/vehicles/onboard',
    canWrite,
    validate(mastersValidators.onboardVehicle),
    asyncHandler(controller.onboardVehicle),
  );
  router.get(
    '/vehicles',
    validate(mastersValidators.listVehicles),
    asyncHandler(controller.listVehicles),
  );
  router.get(
    '/vehicles/:vehicleId',
    validate(mastersValidators.getVehicle),
    asyncHandler(controller.getVehicle),
  );
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

  // Settings → Approvals. Only a `pending` vehicle (added by dispatch) can be approved/rejected —
  // org_admin's own onboardVehicle calls land `active` immediately and never need this.
  router.patch(
    '/vehicles/:vehicleId/approve',
    canApprove,
    validate(mastersValidators.approveVehicle),
    asyncHandler(controller.approveVehicle),
  );
  router.patch(
    '/vehicles/:vehicleId/reject',
    canApprove,
    validate(mastersValidators.rejectVehicle),
    asyncHandler(controller.rejectVehicle),
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

  // Step-2 preflight for "Add a driver" — checks a licence before the driver exists, so it has no
  // :driverId param. Declared before '/drivers/onboard' for the same reason as vehicles/onboard.
  router.post(
    '/drivers/verify-dl',
    verifyDriverDlRateLimit,
    canWrite,
    validate(mastersValidators.verifyDriverDl),
    asyncHandler(controller.verifyDriverDl),
  );

  // Backs the single "Save driver" button — whole form, one transaction.
  router.post(
    '/drivers/onboard',
    canWrite,
    validate(mastersValidators.onboardDriver),
    asyncHandler(controller.onboardDriver),
  );
  router.get(
    '/drivers',
    validate(mastersValidators.listDrivers),
    asyncHandler(controller.listDrivers),
  );
  router.get(
    '/drivers/:driverId',
    validate(mastersValidators.getDriver),
    asyncHandler(controller.getDriver),
  );
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

  // Settings → Approvals. Only a `pending` driver (added by dispatch) can be approved/rejected —
  // org_admin's own onboardDriver calls land `active` immediately and never need this.
  router.patch(
    '/drivers/:driverId/approve',
    canApprove,
    validate(mastersValidators.approveDriver),
    asyncHandler(controller.approveDriver),
  );
  router.patch(
    '/drivers/:driverId/reject',
    canApprove,
    validate(mastersValidators.rejectDriver),
    asyncHandler(controller.rejectDriver),
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

  router.get(
    '/vehicles/:vehicleId/operational-status',
    validate(mastersValidators.getVehicleOperationalStatus),
    asyncHandler(controller.getVehicleOperationalStatus),
  );
  router.put(
    '/vehicles/:vehicleId/operational-status',
    canWrite,
    validate(mastersValidators.setVehicleOperationalStatus),
    asyncHandler(controller.setVehicleOperationalStatus),
  );

  router.get(
    '/vehicles/:vehicleId/telemetry',
    validate(mastersValidators.getVehicleTelemetryMeta),
    asyncHandler(controller.getVehicleTelemetryMeta),
  );
  router.put(
    '/vehicles/:vehicleId/telemetry',
    canWrite,
    validate(mastersValidators.setVehicleTelemetryMeta),
    asyncHandler(controller.setVehicleTelemetryMeta),
  );

  router.get(
    '/vehicles/:vehicleId/service-usage',
    validate(mastersValidators.getVehicleServiceUsage),
    asyncHandler(controller.getVehicleServiceUsage),
  );
  router.put(
    '/vehicles/:vehicleId/service-usage',
    canWrite,
    validate(mastersValidators.setVehicleServiceUsage),
    asyncHandler(controller.setVehicleServiceUsage),
  );

  router.post(
    '/vehicles/:vehicleId/verifications',
    canWrite,
    validate(mastersValidators.recordVehicleVerification),
    asyncHandler(controller.recordVehicleVerification),
  );
  router.get(
    '/vehicles/:vehicleId/verifications',
    validate(mastersValidators.listVehicleVerifications),
    asyncHandler(controller.listVehicleVerifications),
  );

  router.get(
    '/drivers/:driverId/operational-status',
    validate(mastersValidators.getDriverOperationalStatus),
    asyncHandler(controller.getDriverOperationalStatus),
  );
  // "My Drivers" status dropdown (On trip / Active / On leave); one row per driver, so the first
  // call inserts and later calls overwrite it.
  router.patch(
    '/drivers/:driverId/status',
    canWrite,
    validate(mastersValidators.setDriverOperationalStatus),
    asyncHandler(controller.setDriverOperationalStatus),
  );

  router.put(
    '/drivers/:driverId/trip-metrics',
    canWrite,
    validate(mastersValidators.recordDriverTripMetrics),
    asyncHandler(controller.recordDriverTripMetrics),
  );
  router.get(
    '/drivers/:driverId/trip-metrics',
    validate(mastersValidators.listDriverTripMetrics),
    asyncHandler(controller.listDriverTripMetrics),
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
