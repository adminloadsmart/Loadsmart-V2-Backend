import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { sendCsv } from '../../../shared/utils/csv';
import { ContractService } from './contract.service';
import { ContractImportService } from './contract-import.service';
import {
  CreateContractInput,
  LaneAllocationInput,
  ListContractsInput,
  UpdateContractInput,
} from './contract.interface';

export class ContractController {
  constructor(
    private readonly service: ContractService,
    private readonly importService: ContractImportService,
  ) {}

  create = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.create(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        req.body as CreateContractInput,
      ),
      201,
    );
  list = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.list(requireTenantId(req), req.validatedQuery as ListContractsInput),
    );
  export = async (req: Request, res: Response) =>
    sendCsv(
      res,
      'contracts',
      await this.service.export(
        requireTenantId(req),
        req.validatedQuery as Omit<ListContractsInput, 'page' | 'limit'>,
      ),
    );
  laneAllocation = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.laneAllocation(
        requireTenantId(req),
        req.validatedQuery as LaneAllocationInput,
      ),
    );
  import = async (req: Request, res: Response) =>
    respond(
      res,
      await this.importService.import(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        req.file!.originalname,
        req.file!.buffer,
      ),
      201,
    );
  get = async (req: Request, res: Response) =>
    respond(res, await this.service.get(requireTenantId(req), String(req.params.contractId)));
  update = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.update(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        String(req.params.contractId),
        req.body as UpdateContractInput,
      ),
    );
  delete = async (req: Request, res: Response) => {
    await this.service.delete(
      requireTenantId(req),
      req.user!.id,
      req.user!.role,
      String(req.params.contractId),
    );
    respond(res, { success: true });
  };
}
