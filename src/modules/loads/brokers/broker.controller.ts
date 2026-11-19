import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { BrokerService } from './broker.service';
import type { BrokerFilters, ListBrokersQuery } from './broker.validators';

export class BrokerController {
  constructor(private readonly brokers: BrokerService) {}

  list = async (req: Request, res: Response) => {
    respond(res, await this.brokers.list(req.validatedQuery as ListBrokersQuery));
  };

  exportCsv = async (req: Request, res: Response) => {
    const csv = await this.brokers.exportCsv(req.validatedQuery as BrokerFilters);
    res
      .status(200)
      .type('text/csv')
      .attachment(`brokers-${new Date().toISOString().slice(0, 10)}.csv`)
      .send(csv);
  };
}
