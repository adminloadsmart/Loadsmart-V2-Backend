import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import { MASTERS_WRITE, MASTERS_APPROVE } from '../../../shared/constants/permissions';
import { VehicleController } from './vehicle.controller';
import { vehicleValidators } from './vehicle.validators';

export function createVehicleRoutes(controller: VehicleController): Router {
  const router = Router();
  const canWrite = requirePermission(MASTERS_WRITE);
  // Approve/reject a pending vehicle — org_admin only (see db/seed-roles.ts).
  const canApprove = requirePermission(MASTERS_APPROVE);

  // Backs the single "Save vehicle" button — whole form, one transaction. Declared before
  // '/vehicles/:vehicleId' so the literal segment isn't captured as an id.
  router.post(
    '/vehicles/onboard',
    canWrite,
    validate(vehicleValidators.onboardVehicle),
    asyncHandler(controller.onboardVehicle),
  );
  router.get(
    '/vehicles',
    validate(vehicleValidators.listVehicles),
    asyncHandler(controller.listVehicles),
  );
  router.get(
    '/vehicles/:vehicleId',
    validate(vehicleValidators.getVehicle),
    asyncHandler(controller.getVehicle),
  );
  router.patch(
    '/vehicles/:vehicleId',
    canWrite,
    validate(vehicleValidators.updateVehicle),
    asyncHandler(controller.updateVehicle),
  );
  router.delete(
    '/vehicles/:vehicleId',
    canWrite,
    validate(vehicleValidators.deleteVehicle),
    asyncHandler(controller.deleteVehicle),
  );

  // Settings → Approvals. Only a `pending` vehicle (added by dispatch) can be approved/rejected —
  // org_admin's own onboardVehicle calls land `active` immediately and never need this.
  router.patch(
    '/vehicles/:vehicleId/approve',
    canApprove,
    validate(vehicleValidators.approveVehicle),
    asyncHandler(controller.approveVehicle),
  );
  router.patch(
    '/vehicles/:vehicleId/reject',
    canApprove,
    validate(vehicleValidators.rejectVehicle),
    asyncHandler(controller.rejectVehicle),
  );

  router.post(
    '/vehicles/:vehicleId/documents',
    canWrite,
    validate(vehicleValidators.addVehicleDocument),
    asyncHandler(controller.addVehicleDocument),
  );
  router.get(
    '/vehicles/:vehicleId/documents',
    validate(vehicleValidators.listVehicleDocuments),
    asyncHandler(controller.listVehicleDocuments),
  );
  router.patch(
    '/vehicles/:vehicleId/documents/:documentId',
    canWrite,
    validate(vehicleValidators.updateVehicleDocument),
    asyncHandler(controller.updateVehicleDocument),
  );
  router.delete(
    '/vehicles/:vehicleId/documents/:documentId',
    canWrite,
    validate(vehicleValidators.deleteVehicleDocument),
    asyncHandler(controller.deleteVehicleDocument),
  );

  router.get(
    '/vehicles/:vehicleId/operational-status',
    validate(vehicleValidators.getVehicleOperationalStatus),
    asyncHandler(controller.getVehicleOperationalStatus),
  );
  router.put(
    '/vehicles/:vehicleId/operational-status',
    canWrite,
    validate(vehicleValidators.setVehicleOperationalStatus),
    asyncHandler(controller.setVehicleOperationalStatus),
  );

  router.get(
    '/vehicles/:vehicleId/telemetry',
    validate(vehicleValidators.getVehicleTelemetryMeta),
    asyncHandler(controller.getVehicleTelemetryMeta),
  );
  router.put(
    '/vehicles/:vehicleId/telemetry',
    canWrite,
    validate(vehicleValidators.setVehicleTelemetryMeta),
    asyncHandler(controller.setVehicleTelemetryMeta),
  );

  router.get(
    '/vehicles/:vehicleId/service-usage',
    validate(vehicleValidators.getVehicleServiceUsage),
    asyncHandler(controller.getVehicleServiceUsage),
  );
  router.put(
    '/vehicles/:vehicleId/service-usage',
    canWrite,
    validate(vehicleValidators.setVehicleServiceUsage),
    asyncHandler(controller.setVehicleServiceUsage),
  );

  router.post(
    '/vehicles/:vehicleId/verifications',
    canWrite,
    validate(vehicleValidators.recordVehicleVerification),
    asyncHandler(controller.recordVehicleVerification),
  );
  router.get(
    '/vehicles/:vehicleId/verifications',
    validate(vehicleValidators.listVehicleVerifications),
    asyncHandler(controller.listVehicleVerifications),
  );

  // Fleet-wide compliance alerts (documents expired or about to expire) — feeds the Home
  // dashboard's Compliance widget. Read-only, so no extra permission gate beyond the
  // router-level requireTenant applied by masters.routes.ts — same as every other list endpoint.
  router.get(
    '/compliance-alert',
    validate(vehicleValidators.listComplianceAlerts),
    asyncHandler(controller.listComplianceAlerts),
  );

  return router;
}
