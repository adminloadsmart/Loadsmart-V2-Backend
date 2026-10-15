import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { TransporterContractImportService } from './transporter-contract-import.service';

export class TransporterContractImportController {
  constructor(private readonly service: TransporterContractImportService) {}

  import = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.import(
        requireTenantId(req),
        req.user!.id,
        req.file!.originalname,
        req.file!.buffer,
      ),
      201,
    );
}
