import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { LoadingPointImportService } from './loading-point-import.service';

export class LoadingPointImportController {
  constructor(private readonly service: LoadingPointImportService) {}

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
