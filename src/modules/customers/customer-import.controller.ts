import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { importSource, sendXlsx } from '../../shared/import/upload';
import { CustomerImportService } from './customer-import.service';
import {
  buildCustomerImportSample,
  CUSTOMER_IMPORT_SAMPLE_FILENAME,
} from './customer-import.sample';

export class CustomerImportController {
  constructor(private readonly service: CustomerImportService) {}
  sample = async (_req: Request, res: Response) =>
    sendXlsx(res, CUSTOMER_IMPORT_SAMPLE_FILENAME, await buildCustomerImportSample());
  preview = async (req: Request, res: Response) =>
    respond(res, await this.service.preview(requireTenantId(req), importSource(req.file!)));
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
