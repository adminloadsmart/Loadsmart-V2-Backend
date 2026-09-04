import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { TransporterSettlementService } from './transporter-settlement.service';
import { RecordTransporterSettlementInput } from './utils/transporter-settlement.interface';
import { TransporterPayablesService } from './transporter-payables.service';
import {
  TransporterLoadsQuery,
  TransporterPayablesQuery,
} from './utils/transporter-payables.interface';

type LoadParams = { loadId: string };
type TransporterParams = { transporterId: string };

export class PaymentsController {
  constructor(
    private readonly transporterSettlementService: TransporterSettlementService,
    private readonly transporterPayablesService: TransporterPayablesService,
  ) {}

  getTransporterSettlementSummary = async (req: Request<LoadParams>, res: Response) => {
    const summary = await this.transporterSettlementService.getSummary(
      requireTenantId(req),
      req.params.loadId,
    );
    respond(res, summary);
  };

  recordTransporterSettlement = async (req: Request<LoadParams>, res: Response) => {
    const settlement = await this.transporterSettlementService.recordSettlement(
      requireTenantId(req),
      req.user!.id,
      req.params.loadId,
      req.body as RecordTransporterSettlementInput,
    );
    respond(res, settlement, 201);
  };

  getTransporterPayablesDashboard = async (req: Request, res: Response) => {
    const dashboard = await this.transporterPayablesService.getDashboard(
      requireTenantId(req),
      req.validatedQuery as TransporterPayablesQuery,
    );
    respond(res, dashboard);
  };

  getTransporterPayableLoads = async (req: Request<TransporterParams>, res: Response) => {
    const result = await this.transporterPayablesService.getTransporterLoads(
      requireTenantId(req),
      req.params.transporterId,
      req.validatedQuery as TransporterLoadsQuery,
    );
    respond(res, result);
  };
}
