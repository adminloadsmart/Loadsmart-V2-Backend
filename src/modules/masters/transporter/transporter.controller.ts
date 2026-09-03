import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { ListTransportersInput } from './transporter.interface';
import { TransporterService } from './transporter.service';

export class TransporterController {
  constructor(private readonly transporterService: TransporterService) {}

  createTransporter = async (req: Request, res: Response) =>
    respond(
      res,
      await this.transporterService.create(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        req.body,
      ),
      201,
    );
  listTransporters = async (req: Request, res: Response) =>
    respond(
      res,
      await this.transporterService.list(
        requireTenantId(req),
        req.user!.role,
        req.validatedQuery as ListTransportersInput,
      ),
    );
  getTransporter = async (req: Request, res: Response) =>
    respond(
      res,
      await this.transporterService.get(
        requireTenantId(req),
        req.user!.role,
        String(req.params.transporterId),
      ),
    );
  updateTransporter = async (req: Request, res: Response) =>
    respond(
      res,
      await this.transporterService.update(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        String(req.params.transporterId),
        req.body,
      ),
    );
  deleteTransporter = async (req: Request, res: Response) => {
    await this.transporterService.delete(
      requireTenantId(req),
      req.user!.id,
      req.user!.role,
      String(req.params.transporterId),
    );
    respond(res, { success: true });
  };
}
