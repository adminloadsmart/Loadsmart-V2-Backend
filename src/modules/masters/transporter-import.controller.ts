import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { TransporterImportService } from './transporter-import.service';

export class TransporterImportController {
  constructor(private readonly service: TransporterImportService) {}

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
