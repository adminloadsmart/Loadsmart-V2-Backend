import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { CustomerService } from './customer.service';
import { sendCsv } from '../../shared/utils/csv';
import { CustomerParams, DeleteCustomerParams, ListCustomersInput } from './customer.types';

export class CustomerController {
  constructor(private readonly service: CustomerService) {}
  create = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.create(requireTenantId(req), req.user!.id, req.user!.role, req.body),
      201,
    );
  list = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.list(
        requireTenantId(req),
        req.user!.role,
        req.validatedQuery as ListCustomersInput,
      ),
    );
  export = async (req: Request, res: Response) =>
    sendCsv(
      res,
      'customers',
      await this.service.export(
        requireTenantId(req),
        req.user!.role,
        req.validatedQuery as Omit<ListCustomersInput, 'page' | 'limit'>,
      ),
    );
  listLoads = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.listLoads(
        requireTenantId(req),
        req.user!.role,
        (req.params as unknown as CustomerParams).customerId,
        req.validatedQuery as { page: number; limit: number },
      ),
    );
  usage = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.usageOf(
        requireTenantId(req),
        req.user!.role,
        (req.params as unknown as CustomerParams).customerId,
      ),
    );
  get = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.get(
        requireTenantId(req),
        req.user!.role,
        (req.params as unknown as CustomerParams).customerId,
      ),
    );
  update = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.update(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        (req.params as unknown as CustomerParams).customerId,
        req.body,
      ),
    );
  approve = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.approve(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        (req.params as unknown as CustomerParams).customerId,
      ),
    );
  reject = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.reject(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        (req.params as unknown as CustomerParams).customerId,
        (req.body as { reason: string }).reason,
      ),
    );

  updateStatus = async (req: Request, res: Response) =>
    respond(
      res,
      await this.service.updateStatus(
        requireTenantId(req),
        req.user!.id,
        req.user!.role,
        (req.params as unknown as CustomerParams).customerId,
        (req.body as { status: 'active' | 'inactive' }).status,
      ),
    );

  delete = async (req: Request, res: Response) => {
    await this.service.delete(
      requireTenantId(req),
      req.user!.id,
      req.user!.role,
      (req.params as unknown as DeleteCustomerParams).customer_id,
    );
    respond(res, { success: true });
  };
}
