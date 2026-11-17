import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import { LOADS_POST } from '../../../shared/constants/permissions';
import { LoadPostingController } from './load-posting.controller';
import { loadPostingValidators } from './load-posting.validators';

/** Mounted at `/loads/post` inside the loads router, which already applies `requireTenant`.
 *  Literal segments are registered before the `:param` ones. */
export function createLoadPostingRoutes(controller: LoadPostingController): Router {
  const router = Router();
  const canPost = requirePermission(LOADS_POST);

  // --- Pickers behind the form ---
  // Timing rules from Super Admin → Settings (earliest truck reporting time, memo expiry).
  router.get('/rules', canPost, asyncHandler(controller.rules));
  router.get(
    '/recent-customers',
    canPost,
    validate(loadPostingValidators.recentCustomers),
    asyncHandler(controller.recentCustomers),
  );
  router.get(
    '/customers',
    canPost,
    validate(loadPostingValidators.customerSearch),
    asyncHandler(controller.searchCustomers),
  );
  router.post(
    '/customers',
    canPost,
    validate(loadPostingValidators.quickAddCustomer),
    asyncHandler(controller.quickAddCustomer),
  );
  router.get(
    '/customers/:customerId/unloading-points',
    canPost,
    validate(loadPostingValidators.unloadingPoints),
    asyncHandler(controller.unloadingPoints),
  );
  router.get(
    '/past-loads',
    canPost,
    validate(loadPostingValidators.pastLoads),
    asyncHandler(controller.pastLoads),
  );
  router.get(
    '/loading-points',
    canPost,
    validate(loadPostingValidators.loadingPoints),
    asyncHandler(controller.loadingPoints),
  );
  router.get(
    '/commodities',
    canPost,
    validate(loadPostingValidators.commodities),
    asyncHandler(controller.commodities),
  );
  router.get(
    '/transporters',
    canPost,
    validate(loadPostingValidators.transporters),
    asyncHandler(controller.transporters),
  );
  router.get(
    '/truck-options',
    canPost,
    validate(loadPostingValidators.truckOptions),
    asyncHandler(controller.truckOptions),
  );
  router.get(
    '/fleet-options',
    canPost,
    validate(loadPostingValidators.fleetOptions),
    asyncHandler(controller.fleetOptions),
  );

  router.get(
    '/available-drivers',
    canPost,
    validate(loadPostingValidators.availableDrivers),
    asyncHandler(controller.availableDrivers),
  );

  // --- Indent contracts ---
  router.get(
    '/contracts',
    canPost,
    validate(loadPostingValidators.listContracts),
    asyncHandler(controller.listContracts),
  );
  router.post(
    '/contracts',
    canPost,
    validate(loadPostingValidators.createContract),
    asyncHandler(controller.createContract),
  );

  // --- Drafts ---
  router.get('/drafts', canPost, asyncHandler(controller.listDrafts));
  router.post(
    '/drafts',
    canPost,
    validate(loadPostingValidators.draftBody),
    asyncHandler(controller.createDraft),
  );
  router.get(
    '/drafts/:draftId',
    canPost,
    validate(loadPostingValidators.draftParams),
    asyncHandler(controller.getDraft),
  );
  router.put(
    '/drafts/:draftId',
    canPost,
    validate(loadPostingValidators.updateDraft),
    asyncHandler(controller.updateDraft),
  );
  router.delete(
    '/drafts/:draftId',
    canPost,
    validate(loadPostingValidators.draftParams),
    asyncHandler(controller.deleteDraft),
  );

  // --- Post ---
  router.post('/', canPost, validate(loadPostingValidators.post), asyncHandler(controller.post));
  router.get('/:postingId', canPost, asyncHandler(controller.getPosting));
  // Edit a posted load: everything until bids come in, then the reporting time and the area.
  router.put(
    '/:postingId',
    canPost,
    validate(loadPostingValidators.editPosting),
    asyncHandler(controller.editPosting),
  );
  router.patch(
    '/:postingId/details',
    canPost,
    validate(loadPostingValidators.editDetails),
    asyncHandler(controller.editDetails),
  );

  return router;
}
