import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { importSource, sendXlsx } from '../../../shared/import/upload';
import { ProductImportService } from './product-import.service';
import { buildProductImportSample, PRODUCT_IMPORT_SAMPLE_FILENAME } from './product-import.mapper';

export class ProductImportController {
  constructor(private readonly service: ProductImportService) {}

  sample = async (_req: Request, res: Response) =>
    sendXlsx(res, PRODUCT_IMPORT_SAMPLE_FILENAME, await buildProductImportSample());

  import = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.import(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        importSource(req.file!),
      ),
      201,
    );
}
