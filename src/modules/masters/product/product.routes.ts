import { Router } from 'express';
import { asyncHandler } from '../../../shared/middleware/async-handler';
import { validate } from '../../../shared/middleware/validate.middleware';
import { requirePermission } from '../../../shared/middleware/require-permission.middleware';
import { MASTERS_WRITE, MASTERS_APPROVE } from '../../../shared/constants/permissions';
import { mastersExcelUpload, requireMastersExcelFile } from '../masters.upload';
import { ProductController } from './product.controller';
import { productValidators } from './product.validators';
import { ProductImportController } from './product-import.controller';

export function createProductRoutes(
  controller: ProductController,
  productImportController: ProductImportController,
): Router {
  const router = Router();
  const canWrite = requirePermission(MASTERS_WRITE);
  const canApprove = requirePermission(MASTERS_APPROVE);

  router.post(
    '/products/import',
    canWrite,
    mastersExcelUpload.single('file'),
    requireMastersExcelFile,
    asyncHandler(productImportController.import),
  );

  router.post(
    '/products',
    canWrite,
    validate(productValidators.create),
    asyncHandler(controller.createProduct),
  );
  router.get('/products', validate(productValidators.list), asyncHandler(controller.listProducts));
  router.get(
    '/products/:productId',
    validate(productValidators.get),
    asyncHandler(controller.getProduct),
  );
  router.patch(
    '/products/:productId',
    canWrite,
    validate(productValidators.update),
    asyncHandler(controller.updateProduct),
  );
  router.patch(
    '/products/:productId/approve',
    canApprove,
    validate(productValidators.approve),
    asyncHandler(controller.approveProduct),
  );
  router.patch(
    '/products/:productId/reject',
    canApprove,
    validate(productValidators.reject),
    asyncHandler(controller.rejectProduct),
  );
  router.patch(
    '/products/:productId/status',
    canWrite,
    validate(productValidators.status),
    asyncHandler(controller.setProductStatus),
  );
  router.delete(
    '/products/:productId',
    canWrite,
    validate(productValidators.delete),
    asyncHandler(controller.deleteProduct),
  );

  return router;
}
