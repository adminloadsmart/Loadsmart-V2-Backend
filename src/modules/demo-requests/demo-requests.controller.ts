import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { DemoRequestsService } from './demo-requests.service';
import { CreateDemoRequestInput } from './demo-requests.types';

export class DemoRequestsController {
  constructor(private readonly service: DemoRequestsService) {}

  create = async (req: Request, res: Response) => {
    const userAgent = req.get('user-agent');
    respond(
      res,
      await this.service.create(req.body as CreateDemoRequestInput, {
        ipAddress: req.ip ?? null,
        userAgent: userAgent ? userAgent.slice(0, 500) : null,
      }),
      201,
    );
  };
}
