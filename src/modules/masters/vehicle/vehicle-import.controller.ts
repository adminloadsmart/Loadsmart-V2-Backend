import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { importSource, sendXlsx } from '../../../shared/import/upload';
import { VehicleImportService } from './vehicle-import.service';
import { buildVehicleImportSample, VEHICLE_IMPORT_SAMPLE_FILENAME } from './vehicle-import.mapper';

export class VehicleImportController {
  constructor(private readonly service: VehicleImportService) {}

  sample = async (_req: Request, res: Response) =>
    sendXlsx(res, VEHICLE_IMPORT_SAMPLE_FILENAME, await buildVehicleImportSample());

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
