import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { CustomerImportService } from './customer-import.service';

export class CustomerImportController {
  constructor(private readonly service: CustomerImportService) {}
  preview = async (req: Request, res: Response) =>
    respond(res, await this.service.preview(requireTenantId(req), req.file!.buffer));
  import = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.import(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        req.file!.originalname,
        req.file!.buffer,
      ),
      201,
    );
}
