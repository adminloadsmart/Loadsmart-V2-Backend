import { Router } from 'express';
import { env } from '../../../config/env';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { createIpRateLimit } from '../../../shared/middleware/rate-limit.middleware';
import { GstController } from './gst.controller';
import { gstValidators } from './gst.validators';

// Settings → Masters "Verify" on Add Customer / Add Transporter. No requirePermission: any tenant
// member who can start either form may look a GSTIN up (the record save itself is gated).
// Rate-limited per IP since every call is a paid IDfy request — same limits as /places.
export function createGstRoutes(controller: GstController): Router {
  const router = Router();
  const lookupRateLimit = createIpRateLimit({
    keyPrefix: 'gst-verify',
    limit: env.locationLookupRateLimitMax,
    windowSeconds: env.locationLookupRateLimitWindowSeconds,
  });

  router.post(
    '/gst/verify',
    lookupRateLimit,
    validate(gstValidators.verify),
    asyncHandler(controller.verify),
  );

  return router;
}
