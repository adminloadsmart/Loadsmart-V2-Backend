import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import {
  AddTruckTypesFromCatalogInput,
  CreateTruckTypeInput,
  ResolveTruckTypeInput,
  TruckTypeParams,
} from './truck-type.interface';
import { TruckTypeService } from './truck-type.service';
import { TruckTypeCatalogService } from '../truck-type-catalog/truck-type-catalog.service';

export class TruckTypeController {
  constructor(
    private readonly truckTypeService: TruckTypeService,
    private readonly truckTypeCatalogService: TruckTypeCatalogService,
  ) {}

  listTruckTypes = async (req: Request, res: Response) => {
    const truckTypes = await this.truckTypeService.listTruckTypes(requireTenantId(req));
    respond(res, truckTypes);
  };

  listTruckTypeCatalog = async (_req: Request, res: Response) => {
    const catalog = await this.truckTypeCatalogService.listCatalog();
    respond(res, catalog);
  };

  addTruckTypesFromCatalog = async (req: Request, res: Response) => {
    const truckTypes = await this.truckTypeService.addFromCatalog(
      requireTenantId(req),
      req.user!.id,
      req.body as AddTruckTypesFromCatalogInput,
    );
    respond(res, truckTypes, 201);
  };

  resolveTruckType = async (req: Request, res: Response) => {
    const truckType = await this.truckTypeService.resolveFromCatalog(
      requireTenantId(req),
      req.user!.id,
      req.body as ResolveTruckTypeInput,
    );
    respond(res, truckType, 200);
  };

  createTruckType = async (req: Request, res: Response) => {
    const truckType = await this.truckTypeService.createTruckType(
      requireTenantId(req),
      req.user!.id,
      req.body as CreateTruckTypeInput,
    );
    respond(res, truckType, 201);
  };

  deleteTruckType = async (req: Request<TruckTypeParams>, res: Response) => {
    await this.truckTypeService.deleteTruckType(
      requireTenantId(req),
      req.user!.id,
      req.params.truckTypeId,
    );
    respond(res, { success: true });
  };
}
