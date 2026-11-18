import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import { BrokerController } from './broker.controller';
import { brokerValidators as v } from './broker.validators';
import { BROKER_VIEW_PERMISSIONS } from './broker.permissions';

/** At /v1/loadsmart-ops — the Brokers page (Masters → Brokers). */
export function createBrokerRoutes(c: BrokerController): Router {
  const router = Router();
  const canView = requirePermission(...BROKER_VIEW_PERMISSIONS);
  router.get('/brokers', canView, validate(v.listBrokers), asyncHandler(c.list));
  router.get('/brokers/export', canView, validate(v.exportBrokers), asyncHandler(c.exportCsv));
  return router;
}
