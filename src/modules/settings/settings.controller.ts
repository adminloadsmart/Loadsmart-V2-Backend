import { Request, Response } from 'express';
import { respond } from '../../shared/responses/respond';
import { SettingsService } from './settings.service';

export class SettingsController {
  constructor(private readonly service: SettingsService) {}

  getCurrent = async (_req: Request, res: Response) =>
    respond(res, await this.service.getCurrent());

  listVersions = async (req: Request, res: Response) => {
    const { limit } = req.validatedQuery as { limit?: number };
    respond(res, await this.service.listVersions(limit));
  };

  getVersion = async (req: Request<{ versionId: string }>, res: Response) =>
    respond(res, await this.service.getVersion(req.params.versionId));

  save = async (req: Request, res: Response) =>
    respond(res, await this.service.save(req.user!.id, req.body), 201);
}
