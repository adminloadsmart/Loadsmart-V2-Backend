import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import { LoadPostingService } from './load-posting.service';
import { LoadPostingLookupService } from './load-posting-lookup.service';
import { CustomerContractService } from './customer-contract.service';
import { LoadDraftService } from './load-draft.service';
import {
  ContractsQueryInput,
  CreateContractInput,
  PostLoadInput,
  TruckOptionsInput,
} from './utils/load-posting.interface';

export class LoadPostingController {
  constructor(
    private readonly postingService: LoadPostingService,
    private readonly lookupService: LoadPostingLookupService,
    private readonly contractService: CustomerContractService,
    private readonly draftService: LoadDraftService,
  ) {}

  post = async (req: Request, res: Response) => {
    const key = req.header('Idempotency-Key')?.trim().slice(0, 100) || undefined;
    const result = await this.postingService.post(
      requireTenantId(req),
      req.user!.id,
      req.user!.role,
      req.body as PostLoadInput,
      key,
    );
    respond(res, result, result.duplicate ? 200 : 201);
  };

  getPosting = async (req: Request, res: Response) =>
    respond(
      res,
      await this.lookupService.getPosting(requireTenantId(req), req.params.postingId as string),
    );

  recentCustomers = async (req: Request, res: Response) =>
    respond(
      res,
      await this.lookupService.recentCustomers(
        requireTenantId(req),
        (req.validatedQuery as { limit: number }).limit,
      ),
    );

  searchCustomers = async (req: Request, res: Response) => {
    const query = req.validatedQuery as { search?: string; limit: number };
    respond(
      res,
      await this.lookupService.searchCustomers(requireTenantId(req), query.search, query.limit),
    );
  };

  quickAddCustomer = async (req: Request, res: Response) =>
    respond(
      res,
      await this.lookupService.quickAddCustomer(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        (req.body as { name: string }).name,
      ),
      201,
    );

  pastLoads = async (req: Request, res: Response) =>
    respond(
      res,
      await this.lookupService.pastLoads(
        requireTenantId(req),
        (req.validatedQuery as { customerId?: string }).customerId,
      ),
    );

  unloadingPoints = async (req: Request, res: Response) =>
    respond(
      res,
      await this.lookupService.unloadingPoints(
        requireTenantId(req),
        req.params.customerId as string,
        (req.validatedQuery as { search?: string }).search,
      ),
    );

  loadingPoints = async (req: Request, res: Response) =>
    respond(
      res,
      await this.lookupService.loadingPoints(
        requireTenantId(req),
        (req.validatedQuery as { search?: string }).search,
      ),
    );

  commodities = async (req: Request, res: Response) =>
    respond(
      res,
      await this.lookupService.commodities(
        requireTenantId(req),
        (req.validatedQuery as { search?: string }).search,
      ),
    );

  transporters = async (req: Request, res: Response) =>
    respond(
      res,
      await this.lookupService.transporters(
        requireTenantId(req),
        (req.validatedQuery as { search?: string }).search,
      ),
    );

  truckOptions = async (req: Request, res: Response) =>
    respond(res, this.lookupService.truckOptions(req.validatedQuery as TruckOptionsInput));

  fleetOptions = async (req: Request, res: Response) =>
    respond(
      res,
      await this.lookupService.fleetOptions(
        requireTenantId(req),
        (req.validatedQuery as { search?: string }).search,
      ),
    );

  availableDrivers = async (req: Request, res: Response) =>
    respond(
      res,
      await this.lookupService.availableDrivers(
        requireTenantId(req),
        (req.validatedQuery as { search?: string }).search,
      ),
    );

  listContracts = async (req: Request, res: Response) =>
    respond(
      res,
      await this.contractService.list(
        requireTenantId(req),
        req.validatedQuery as ContractsQueryInput,
      ),
    );

  createContract = async (req: Request, res: Response) =>
    respond(
      res,
      await this.contractService.create(
        requireTenantId(req),
        req.user!.id,
        req.body as CreateContractInput,
      ),
      201,
    );

  createDraft = async (req: Request, res: Response) =>
    respond(
      res,
      await this.draftService.create(
        requireTenantId(req),
        req.user!.id,
        (req.body as { payload: Record<string, unknown> }).payload,
      ),
      201,
    );

  listDrafts = async (req: Request, res: Response) =>
    respond(res, await this.draftService.list(requireTenantId(req), req.user!.id));

  getDraft = async (req: Request, res: Response) =>
    respond(
      res,
      await this.draftService.get(requireTenantId(req), req.user!.id, req.params.draftId as string),
    );

  updateDraft = async (req: Request, res: Response) =>
    respond(
      res,
      await this.draftService.update(
        requireTenantId(req),
        req.user!.id,
        req.params.draftId as string,
        (req.body as { payload: Record<string, unknown> }).payload,
      ),
    );

  deleteDraft = async (req: Request, res: Response) => {
    await this.draftService.delete(
      requireTenantId(req),
      req.user!.id,
      req.params.draftId as string,
    );
    res.status(204).send();
  };
}
