import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { VehicleImportService } from './vehicle-import.service';

export class VehicleImportController {
  constructor(private readonly service: VehicleImportService) {}

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
