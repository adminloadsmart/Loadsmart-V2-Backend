import { Request, Response } from 'express';
import { respond } from '../../../shared/responses/respond';
import { requireTenantId } from '../../../shared/middleware/require-tenant.middleware';
import {
  CreateLoadingPointInput,
  ListLoadingPointCitiesInput,
  ListLoadingPointsInput,
  UpdateLoadingPointInput,
} from './loading-point.interface';
import { LoadingPointService } from './loading-point.service';

export class LoadingPointController {
  constructor(private readonly loadingPointService: LoadingPointService) {}

  listLoadingPoints = async (req: Request, res: Response) => {
    const loadingPoints = await this.loadingPointService.list(
      requireTenantId(req),
      req.validatedQuery as ListLoadingPointsInput,
    );
    respond(res, loadingPoints);
  };

  listLoadingPointCities = async (req: Request, res: Response) => {
    const cities = await this.loadingPointService.listCities(
      requireTenantId(req),
      req.validatedQuery as ListLoadingPointCitiesInput,
    );
    respond(res, cities);
  };

  getLoadingPoint = async (req: Request, res: Response) => {
    const loadingPoint = await this.loadingPointService.get(
      requireTenantId(req),
      req.params.loadingPointId as string,
    );
    respond(res, loadingPoint);
  };

  createLoadingPoint = async (req: Request, res: Response) => {
    const loadingPoint = await this.loadingPointService.create(
      requireTenantId(req),
      req.user!.id,
      req.user!.role,
      req.body as CreateLoadingPointInput,
    );
    respond(res, loadingPoint, 201);
  };

  updateLoadingPoint = async (req: Request, res: Response) => {
    const loadingPoint = await this.loadingPointService.update(
      requireTenantId(req),
      req.user!.id,
      req.params.loadingPointId as string,
      req.body as UpdateLoadingPointInput,
    );
    respond(res, loadingPoint);
  };

  approveLoadingPoint = async (req: Request, res: Response) => {
    const loadingPoint = await this.loadingPointService.approve(
      requireTenantId(req),
      req.user!.id,
      req.params.loadingPointId as string,
    );
    respond(res, loadingPoint);
  };

  rejectLoadingPoint = async (req: Request, res: Response) => {
    const loadingPoint = await this.loadingPointService.reject(
      requireTenantId(req),
      req.user!.id,
      req.params.loadingPointId as string,
      (req.body as { reason: string }).reason,
    );
    respond(res, loadingPoint);
  };

  deleteLoadingPoint = async (req: Request, res: Response) => {
    await this.loadingPointService.delete(
      requireTenantId(req),
      req.user!.id,
      req.params.loadingPointId as string,
    );
    respond(res, { success: true });
  };
}
