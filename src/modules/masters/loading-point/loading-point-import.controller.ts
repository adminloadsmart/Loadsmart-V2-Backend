import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { importSource, sendXlsx } from '../../../shared/import/upload';
import { LoadingPointImportService } from './loading-point-import.service';
import {
  buildLoadingPointImportSample,
  LOADING_POINT_IMPORT_SAMPLE_FILENAME,
} from './loading-point-import.mapper';

export class LoadingPointImportController {
  constructor(private readonly service: LoadingPointImportService) {}

  sample = async (_req: Request, res: Response) =>
    sendXlsx(res, LOADING_POINT_IMPORT_SAMPLE_FILENAME, await buildLoadingPointImportSample());

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
