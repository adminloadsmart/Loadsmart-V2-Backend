import { Router } from 'express';
import { env } from '../../config/env';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { createIpRateLimit } from '../../shared/middleware/rate-limit.middleware';
import { PlacesController } from './places.controller';
import { placesValidators } from './places.validators';

// No requirePermission/requireTenant: place lookup is reference data, not a tenant-owned
// resource, so any authenticated caller past the global tenant-scope middleware may use it.
// Rate-limited per IP since every call is a paid Google request.
export function createPlacesRoutes(controller: PlacesController): Router {
  const router = Router();

  const lookupRateLimit = createIpRateLimit({
    keyPrefix: 'places-lookup',
    limit: env.locationLookupRateLimitMax,
    windowSeconds: env.locationLookupRateLimitWindowSeconds,
  });

  router.get(
    '/search',
    lookupRateLimit,
    validate(placesValidators.search),
    asyncHandler(controller.search),
  );
  // Registered after /search so the :placeId segment can't swallow it.
  router.get(
    '/:placeId',
    lookupRateLimit,
    validate(placesValidators.details),
    asyncHandler(controller.details),
  );

  return router;
}
