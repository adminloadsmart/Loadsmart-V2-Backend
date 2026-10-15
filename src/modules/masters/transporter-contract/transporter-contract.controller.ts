import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import {
  LaneSummaryQueryInput,
  ListTransporterContractsInput,
} from './transporter-contract.interface';
import { TransporterContractService } from './transporter-contract.service';

export class TransporterContractController {
  constructor(private readonly service: TransporterContractService) {}

  createContract = async (req: Request, res: Response) =>
    respond(res, await this.service.create(requireTenantId(req), req.user!.id, req.body), 201);
  listContracts = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.list(
        requireTenantId(req),
        req.validatedQuery as ListTransporterContractsInput,
      ),
    );
  getContract = async (req: Request, res: Response) =>
    respond(res, await this.service.get(requireTenantId(req), String(req.params.contractId)));
  updateContract = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.update(
        requireTenantId(req),
        req.user!.id,
        String(req.params.contractId),
        req.body,
      ),
    );
  deleteContract = async (req: Request, res: Response) => {
    await this.service.delete(requireTenantId(req), req.user!.id, String(req.params.contractId));
    respond(res, { success: true });
  };
  customerContracts = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.listForCustomer(requireTenantId(req), String(req.params.customerId)),
    );
  laneSummary = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.laneSummary(
        requireTenantId(req),
        req.validatedQuery as LaneSummaryQueryInput,
      ),
    );
}
