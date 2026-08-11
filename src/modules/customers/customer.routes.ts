import { Router } from 'express';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { validate } from '../../shared/middleware/validate.middleware';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import {
  CUSTOMERS_APPROVE,
  CUSTOMERS_CREATE,
  CUSTOMERS_READ,
  CUSTOMERS_WRITE,
} from '../../shared/constants/permissions';
import { CustomerController } from './customer.controller';
import { customerValidators } from './customer.validators';

export function createCustomerRoutes(controller: CustomerController): Router {
  const router = Router();
  router.use(requireTenant);
  router.post(
    '/',
    requirePermission(CUSTOMERS_CREATE),
    validate(customerValidators.create),
    asyncHandler(controller.create),
  );
  router.get(
    '/',
    requirePermission(CUSTOMERS_READ),
    validate(customerValidators.list),
    asyncHandler(controller.list),
  );
  router.get(
    '/:customerId',
    requirePermission(CUSTOMERS_READ),
    validate(customerValidators.get),
    asyncHandler(controller.get),
  );
  router.patch(
    '/:customerId',
    requirePermission(CUSTOMERS_WRITE),
    validate(customerValidators.update),
    asyncHandler(controller.update),
  );
  router.patch(
    '/:customerId/approve',
    requirePermission(CUSTOMERS_APPROVE),
    validate(customerValidators.approve),
    asyncHandler(controller.approve),
  );
  return router;
}
