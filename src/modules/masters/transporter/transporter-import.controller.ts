import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { importSource, sendXlsx } from '../../../shared/import/upload';
import { TransporterImportService } from './transporter-import.service';
import {
  buildTransporterImportSample,
  TRANSPORTER_IMPORT_SAMPLE_FILENAME,
} from './transporter-import.mapper';

export class TransporterImportController {
  constructor(private readonly service: TransporterImportService) {}

  sample = async (_req: Request, res: Response) =>
    sendXlsx(res, TRANSPORTER_IMPORT_SAMPLE_FILENAME, await buildTransporterImportSample());

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
