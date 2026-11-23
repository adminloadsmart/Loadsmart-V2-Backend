import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { createIpRateLimit } from '../../shared/middleware/rate-limit.middleware';
import { validate } from '../../shared/middleware/validate.middleware';
import { DemoRequestsController } from './demo-requests.controller';
import { demoRequestsValidators as v } from './demo-requests.validators';

/** Generous enough for a shared office IP, tight enough to stop a script filling the table. */
export const DEMO_REQUEST_RATE_LIMIT = { limit: 10, windowSeconds: 60 * 60 };

/** /v1/demo-requests — public: the landing page's "Book a Demo" form has no signed-in user. */
export function createDemoRequestsRoutes(c: DemoRequestsController): Router {
  const router = Router();
  router.post(
    '/',
    createIpRateLimit({ keyPrefix: 'demo-requests', ...DEMO_REQUEST_RATE_LIMIT }),
    validate(v.create),
    asyncHandler(c.create),
  );
  return router;
}
