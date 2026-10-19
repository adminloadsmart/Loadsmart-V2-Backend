import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { MastersSummaryController } from './summary.controller';

export function createMastersSummaryRoutes(controller: MastersSummaryController): Router {
  const router = Router();
  router.get('/summary', asyncHandler(controller.summary));
  return router;
}
