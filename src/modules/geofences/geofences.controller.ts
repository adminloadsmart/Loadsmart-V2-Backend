import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { requireTenantId } from '../../shared/middleware/require-tenant.middleware';
import { GeofenceService } from './geofence.service';
import {
  CreateGeofenceInput,
  GeofenceParams,
  ListGeofencesInput,
  UpdateGeofenceInput,
} from './utils/geofence.interface';

export class GeofencesController {
  constructor(private readonly geofenceService: GeofenceService) {}

  create = async (req: Request, res: Response) => {
    const geofence = await this.geofenceService.create(
      requireTenantId(req),
      req.user!.id,
      req.body as CreateGeofenceInput,
    );
    respond(res, geofence, 201);
  };

  list = async (req: Request, res: Response) => {
    const geofences = await this.geofenceService.list(
      requireTenantId(req),
      req.validatedQuery as ListGeofencesInput,
    );
    respond(res, geofences);
  };

  get = async (req: Request<GeofenceParams>, res: Response) => {
    respond(res, await this.geofenceService.get(requireTenantId(req), req.params.geofenceId));
  };

  update = async (req: Request<GeofenceParams>, res: Response) => {
    const geofence = await this.geofenceService.update(
      requireTenantId(req),
      req.user!.id,
      req.params.geofenceId,
      req.body as UpdateGeofenceInput,
    );
    respond(res, geofence);
  };

  delete = async (req: Request<GeofenceParams>, res: Response) => {
    await this.geofenceService.delete(requireTenantId(req), req.user!.id, req.params.geofenceId);
    respond(res, { success: true });
  };
}
