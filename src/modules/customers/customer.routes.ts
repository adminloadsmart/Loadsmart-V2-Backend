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
import { CustomerImportController } from './customer-import.controller';
import { createCustomerImportRoutes } from './customer-import.routes';

export function createCustomerRoutes(
  controller: CustomerController,
  importController: CustomerImportController,
): Router {
  const router = Router();
  router.use(requireTenant);

  // Mounted before the dynamic ':customerId' routes below so the literal 'import' segment is
  // never captured as an id.
  router.use('/import', createCustomerImportRoutes(importController));

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
  router.patch(
    '/:customerId/reject',
    requirePermission(CUSTOMERS_APPROVE),
    validate(customerValidators.reject),
    asyncHandler(controller.reject),
  );
  router.delete(
    '/delete/:customer_id',
    requirePermission(CUSTOMERS_WRITE),
    validate(customerValidators.delete),
    asyncHandler(controller.delete),
  );
  return router;
}
