import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { MAINTENANCE_MANAGE } from '../../shared/constants/permissions';
import { MaintenanceController } from './maintenance.controller';
import { maintenanceValidators as v } from './maintenance.validators';

export function createMaintenanceRoutes(controller: MaintenanceController): Router {
  const router = Router();

  // Own-fleet workshop records are tenant-owned — same reasoning as masters.routes.ts.
  router.use(requireTenant);

  const canManage = requirePermission(MAINTENANCE_MANAGE);

  // Screen reads — no permission gate: a seat without money still sees both workshop headlines
  // and every queue. Cost fields are stripped per-seat in the service (see cost-visibility.ts).
  router.get('/overview', validate(v.getOverview), asyncHandler(controller.getOverview));
  router.get('/service-due', asyncHandler(controller.listServiceDue));
  router.get('/breakdowns', asyncHandler(controller.listBreakdowns));
  router.get('/tyres', asyncHandler(controller.listTyres));
  router.get('/batteries', asyncHandler(controller.listBatteries));
  router.get('/jobs', validate(v.listJobs), asyncHandler(controller.listJobs));

  // Check in (no completedAt) or record a past service (completedAt) — see logService.
  router.post('/services', canManage, validate(v.logService), asyncHandler(controller.logService));
  router.patch(
    '/services/:jobId',
    canManage,
    validate(v.updateService),
    asyncHandler(controller.updateService),
  );
  router.post(
    '/services/:jobId/complete',
    canManage,
    validate(v.completeService),
    asyncHandler(controller.completeService),
  );
  router.put(
    '/vehicles/:vehicleId/service-policy',
    canManage,
    validate(v.setServicePolicy),
    asyncHandler(controller.setServicePolicy),
  );

  router.post(
    '/breakdowns',
    canManage,
    validate(v.openBreakdown),
    asyncHandler(controller.openBreakdown),
  );
  router.patch(
    '/breakdowns/:jobId',
    canManage,
    validate(v.updateBreakdown),
    asyncHandler(controller.updateBreakdown),
  );
  router.post(
    '/breakdowns/:jobId/close',
    canManage,
    validate(v.closeBreakdown),
    asyncHandler(controller.closeBreakdown),
  );

  router.post('/tyres', canManage, validate(v.fitTyre), asyncHandler(controller.fitTyre));
  router.post(
    '/tyres/:tyreId/readings',
    canManage,
    validate(v.recordTyreReading),
    asyncHandler(controller.recordTyreReading),
  );
  router.post(
    '/tyres/:tyreId/remove',
    canManage,
    validate(v.removeTyre),
    asyncHandler(controller.removeTyre),
  );

  router.post(
    '/batteries',
    canManage,
    validate(v.registerBatteryPack),
    asyncHandler(controller.registerBatteryPack),
  );
  router.post(
    '/batteries/:packId/readings',
    canManage,
    validate(v.recordBatteryReading),
    asyncHandler(controller.recordBatteryReading),
  );

  return router;
}
