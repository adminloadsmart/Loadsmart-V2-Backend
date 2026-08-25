import { Router } from 'express';
import multer, { FileFilterCallback } from 'multer';
import { asyncHandler } from '../../shared/middleware/async-handler';
import { requireTenant } from '../../shared/middleware/require-tenant.middleware';
import { requirePermission } from '../../shared/middleware/require-permission.middleware';
import { CUSTOMERS_CREATE } from '../../shared/constants/permissions';
import { CustomerImportController } from './customer-import.controller';
import { ValidationError } from '../../shared/errors';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, callback: FileFilterCallback) => {
    const isExcel = file.originalname.toLowerCase().endsWith('.xlsx');
    if (!isExcel) callback(new Error('Only .xlsx files are accepted'));
    else callback(null, true);
  },
});

function requireExcelFile(
  req: Parameters<import('express').RequestHandler>[0],
  _res: Parameters<import('express').RequestHandler>[1],
  next: Parameters<import('express').RequestHandler>[2],
) {
  if (!req.file) {
    next(new ValidationError('An Excel file is required in the "file" form field'));
    return;
  }
  next();
}

export function createCustomerImportRoutes(controller: CustomerImportController): Router {
  const router = Router();
  router.use(requireTenant);
  router.post(
    '/preview',
    requirePermission(CUSTOMERS_CREATE),
    upload.single('file'),
    requireExcelFile,
    asyncHandler(controller.preview),
  );
  router.post(
    '/',
    requirePermission(CUSTOMERS_CREATE),
    upload.single('file'),
    requireExcelFile,
    asyncHandler(controller.import),
  );
  return router;
}
