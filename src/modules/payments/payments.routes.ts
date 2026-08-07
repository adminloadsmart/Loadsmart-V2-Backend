import { Router } from 'express';
import { PaymentsController } from './payments.controller';

export function createPaymentsRoutes(_controller: PaymentsController): Router {
  const router = Router();
  // TODO: register routes
  return router;
}
