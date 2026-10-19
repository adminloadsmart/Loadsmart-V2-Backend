import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { DriverImportService } from './driver-import.service';

export class DriverImportController {
  constructor(private readonly service: DriverImportService) {}

  preview = async (req: Request, res: Response) =>
    respond(res, await this.service.preview(requireTenantId(req), req.file!.buffer));

  import = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.import(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        req.body.drivers,
      ),
      201,
    );
}
