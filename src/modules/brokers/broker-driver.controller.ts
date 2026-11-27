import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { BrokerDriverService } from './broker-driver.service';
import type {
  CreateBrokerDriverInput,
  ListBrokerDriversQuery,
  UpdateBrokerDriverInput,
} from './broker-driver.validators';

type DriverParams = { driverId: string };

export class BrokerDriverController {
  constructor(private readonly drivers: BrokerDriverService) {}

  list = async (req: Request, res: Response) => {
    respond(res, await this.drivers.list(req.validatedQuery as ListBrokerDriversQuery));
  };

  detail = async (req: Request<DriverParams>, res: Response) => {
    respond(res, await this.drivers.detail(req.params.driverId));
  };

  create = async (req: Request, res: Response) => {
    respond(res, await this.drivers.create(req.user!.id, req.body as CreateBrokerDriverInput), 201);
  };

  update = async (req: Request<DriverParams>, res: Response) => {
    respond(
      res,
      await this.drivers.update(
        req.user!.id,
        req.params.driverId,
        req.body as UpdateBrokerDriverInput,
      ),
    );
  };
}
